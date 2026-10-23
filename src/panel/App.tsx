import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createChecker } from '../app/compose';
import { errorMessage } from '../core/errors';
import { newId } from '../core/ids';
import type { GroundTruth, Result } from '../core/types';
import { buildEvaluationReport, reportToCsv } from '../eval/report';
import { toCsv } from '../export/csv';
import { downloadText } from '../export/download';
import { EXPORT_WARNING, exportFileName, toJson } from '../export/json';
import { parseLinks, type LinkError } from '../links/parse';
import { BatchRunner, emptyState, withRunnerLock, type BatchRow, type RunnerState } from '../runner/runner';
import { deleteResult, listResults, saveResult, setGroundTruth } from '../store/db';
import { clearQueue, getDayCount, loadQueue, wouldExceedDailyLimit, type SavedQueue } from '../store/local-state';
import { deleteAllData, runRetention } from '../store/maintenance';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../store/settings';
import { CheckView } from './components/CheckView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { EvalView } from './components/EvalView';
import { HistoryView } from './components/HistoryView';
import { ProbeView } from './components/ProbeView';
import { ResultCard } from './components/ResultCard';
import { SettingsView } from './components/SettingsView';

type Tab = 'check' | 'history' | 'evaluation' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'check', label: 'Check' },
  { id: 'history', label: 'History' },
  { id: 'evaluation', label: 'Accuracy' },
  { id: 'settings', label: 'Settings' },
];

const PROBE_ENABLED = import.meta.env.DEV || import.meta.env.VITE_PROBE === '1';

type Pending =
  | { kind: 'limit'; queue: SavedQueue; errors: LinkError[]; count: number }
  | { kind: 'export'; results: Result[]; format: 'csv' | 'json' }
  | { kind: 'export-report'; csv: boolean }
  | { kind: 'delete-one'; result: Result }
  | { kind: 'delete-all' };

export function App() {
  const [tab, setTab] = useState<Tab>('check');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [run, setRun] = useState<RunnerState>(emptyState());
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<Result[]>([]);
  const [open, setOpen] = useState<Result | null>(null);
  const [resumable, setResumable] = useState<SavedQueue | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const runner = useRef<BatchRunner | null>(null);

  const refreshSaved = useCallback(async () => {
    try {
      setSaved(await listResults());
    } catch {
      setNotice(errorMessage('E-STORAGE'));
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    const q = await loadQueue();
    setResumable(q && q.nextIndex < q.items.length ? q : null);
  }, []);

  // NFR-06 and D-24: on open, apply retention and offer to resume an unfinished batch.
  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings());
      try {
        await runRetention();
      } catch {
        /* reported when the history is read */
      }
      await refreshSaved();
      await refreshQueue();
    })();
  }, [refreshSaved, refreshQueue]);

  const start = async (queue: SavedQueue, errors: LinkError[]) => {
    const current = await loadSettings();
    setSettings(current);
    const deps = createChecker(current).runnerDeps(setRun);
    const batch = new BatchRunner({
      ...deps,
      save: async (r) => {
        await saveResult(r);
        void refreshSaved();
      },
    });
    runner.current = batch;
    setResumable(null);
    setOpen(null);
    setNotice(null);
    setRunning(true);
    try {
      const acquired = await withRunnerLock(async () => {
        const final = await batch.run(queue, errors);
        // UC-1: a single link shows its card straight away.
        const rows = final.rows.filter((r) => r.jobId);
        if (rows.length === 1 && rows[0]?.result) setOpen(rows[0].result);
      });
      if (!acquired) setNotice('A batch is already running in another Chrome window. Stop it there or wait for it to finish.');
    } finally {
      setRunning(false);
      runner.current = null;
      await refreshQueue();
      await refreshSaved();
    }
  };

  const onCheck = async (text: string) => {
    const parsed = parseLinks(text);
    const notes = [
      parsed.duplicates ? `${parsed.duplicates} duplicate link${parsed.duplicates > 1 ? 's were' : ' was'} removed.` : '',
      parsed.overLimit ? `${parsed.overLimit} link${parsed.overLimit > 1 ? 's' : ''} over the limit of 50 ${parsed.overLimit > 1 ? 'were' : 'was'} not added.` : '',
    ].filter(Boolean);
    setParseNote(notes.join(' ') || null);
    const queue: SavedQueue = { id: newId(), createdAt: new Date().toISOString(), items: parsed.links.map(({ jobId, url }) => ({ jobId, url })), nextIndex: 0 };
    const count = await getDayCount(new Date());
    // NFR-02: warn before a batch would take the day's total past the limit.
    if (queue.items.length && wouldExceedDailyLimit(count, queue.items.length, settings.dailyLimit)) {
      setPending({ kind: 'limit', queue, errors: parsed.errors, count });
      return;
    }
    await start(queue, parsed.errors);
  };

  const onGroundTruth = async (gt: GroundTruth | null) => {
    if (!open) return;
    const updated = await setGroundTruth(open.jobId, gt);
    if (updated) setOpen(updated);
    await refreshSaved();
  };

  const confirmPending = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    const now = new Date();
    switch (p.kind) {
      case 'limit':
        await start(p.queue, p.errors);
        break;
      case 'export':
        if (p.format === 'csv') downloadText(exportFileName('csv', now), toCsv(p.results), 'text/csv');
        else downloadText(exportFileName('json', now), toJson(p.results, now), 'application/json');
        break;
      case 'export-report': {
        const report = buildEvaluationReport(saved, now);
        if (p.csv) downloadText(exportFileName('csv', now, 'accuracy-report'), reportToCsv(report), 'text/csv');
        else downloadText(exportFileName('json', now, 'accuracy-report'), JSON.stringify(report, null, 2), 'application/json');
        break;
      }
      case 'delete-one':
        await deleteResult(p.result.jobId);
        if (open?.jobId === p.result.jobId) setOpen(null);
        await refreshSaved();
        break;
      case 'delete-all':
        runner.current?.stop();
        await deleteAllData();
        setSettings(await loadSettings());
        setOpen(null);
        setRun(emptyState());
        setResumable(null);
        await refreshSaved();
        setNotice('All data was deleted.');
        break;
    }
  };

  const openRow = (row: BatchRow) => row.result && setOpen(row.result);

  return (
    <div class="app">
      <header class="top">
        <h1>Client Identifiability Checker</h1>
        <nav role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => {
                setTab(t.id);
                setOpen(null);
                if (t.id !== 'check') void refreshSaved();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = TABS.findIndex((x) => x.id === tab);
                const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
                setTab(next.id);
                setOpen(null);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {notice && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {open ? (
          <ResultCard result={open} saved={saved} onClose={() => setOpen(null)} onGroundTruth={onGroundTruth} />
        ) : tab === 'check' ? (
          <CheckView
            state={run}
            running={running}
            resumable={resumable}
            parseNote={parseNote}
            onCheck={(text) => void onCheck(text)}
            onStop={() => runner.current?.stop()}
            onResume={() => resumable && void start(resumable, [])}
            onDiscard={async () => {
              await clearQueue();
              setResumable(null);
            }}
            onOpenUpwork={() => {
              // Open the next unchecked job on Upwork so the page refreshes the login and its token is
              // captured (D-30). The user then presses Retry.
              const next = resumable?.items[resumable.nextIndex]?.url;
              if (next) window.open(next, '_blank', 'noopener');
            }}
            onOpenRow={openRow}
          />
        ) : tab === 'history' ? (
          <HistoryView
            saved={saved}
            onOpen={setOpen}
            onDelete={(result) => setPending({ kind: 'delete-one', result })}
            onExport={(results, format) => setPending({ kind: 'export', results, format })}
          />
        ) : tab === 'evaluation' ? (
          <EvalView saved={saved} onExport={(csv) => setPending({ kind: 'export-report', csv })} />
        ) : (
          <>
            <SettingsView
              settings={settings}
              onSave={async (patch) => setSettings(await saveSettings(patch))}
              onDeleteAll={() => setPending({ kind: 'delete-all' })}
            />
            {PROBE_ENABLED && <ProbeView />}
          </>
        )}
      </main>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'limit'
            ? 'Daily limit'
            : pending?.kind === 'delete-one'
              ? 'Delete this result?'
              : pending?.kind === 'delete-all'
                ? 'Delete all data?'
                : 'Exports contain personal data'
        }
        confirmLabel={pending?.kind === 'limit' ? 'Check anyway' : pending?.kind?.startsWith('delete') ? 'Delete' : 'Export'}
        danger={pending?.kind === 'delete-one' || pending?.kind === 'delete-all'}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'limit' && (
          <p>
            You have checked {pending.count} jobs today. This batch adds {pending.queue.items.length}, which goes past your limit of {settings.dailyLimit}. Upwork restricts
            automated access; keeping volumes low protects your account.
          </p>
        )}
        {(pending?.kind === 'export' || pending?.kind === 'export-report') && <p>{EXPORT_WARNING}</p>}
        {pending?.kind === 'delete-one' && <p>{pending.result.jobTitle ?? pending.result.jobId} will be removed from your history.</p>}
        {pending?.kind === 'delete-all' && <p>Every saved result, the unfinished batch, the daily count and your settings will be removed. This cannot be undone.</p>}
      </ConfirmDialog>
    </div>
  );
}
