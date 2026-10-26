import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createChecker } from '../app/compose';
import { CheckerError, errorMessage } from '../core/errors';
import { newId } from '../core/ids';
import type { GroundTruth, Result } from '../core/types';
import { buildEvaluationReport, reportToCsv } from '../eval/report';
import { toCsv } from '../export/csv';
import { downloadText } from '../export/download';
import { EXPORT_WARNING, exportFileName, toJson } from '../export/json';
import { parseLinks, type LinkError } from '../links/parse';
import { BatchRunner, emptyState, sleep, withRunnerLock, type BatchRow, type RunnerState } from '../runner/runner';
import { checksStore, type CheckSummary } from '../store/checks';
import { clearQueue, getDayCount, loadQueue, wouldExceedDailyLimit, type SavedQueue } from '../store/local-state';
import { deleteAllData } from '../store/maintenance';
import type { PeerCounts } from '../store/peers';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../store/settings';
import { database, type Account } from '../store/supabase';
import { chromeTabDriver } from '../watch/tabs';
import { initialWatchState, SearchWatcher, type WatchState } from '../watch/watcher';
import { CheckView } from './components/CheckView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DatabaseView } from './components/DatabaseView';
import { EvalView } from './components/EvalView';
import { HistoryView } from './components/HistoryView';
import { ProbeView } from './components/ProbeView';
import { ResultCard } from './components/ResultCard';
import { SettingsView } from './components/SettingsView';
import { WatchView } from './components/WatchView';

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
  | { kind: 'export'; jobIds: string[] | 'all'; format: 'csv' | 'json' }
  | { kind: 'export-report'; csv: boolean }
  | { kind: 'delete-one'; row: CheckSummary }
  | { kind: 'delete-all' };

interface HistoryPage {
  rows: CheckSummary[];
  more: boolean;
  query: string;
  loading: boolean;
}

const storageMessage = (error: unknown) => (error instanceof CheckerError ? error.message : errorMessage('E-STORAGE'));

export function App() {
  const db = database();
  const checks = checksStore();
  const [tab, setTab] = useState<Tab>('check');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [run, setRun] = useState<RunnerState>(emptyState());
  const [running, setRunning] = useState(false);
  const [watch, setWatch] = useState<WatchState>(initialWatchState());
  const [history, setHistory] = useState<HistoryPage>({ rows: [], more: false, query: '', loading: false });
  const [known, setKnown] = useState<Result[]>([]);
  const [open, setOpen] = useState<Result | null>(null);
  const [peers, setPeers] = useState<PeerCounts | null>(null);
  const [uploads, setUploads] = useState(0);
  const [resumable, setResumable] = useState<SavedQueue | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const runner = useRef<BatchRunner | null>(null);
  const watcher = useRef<SearchWatcher | null>(null);
  /** The batch or watch in progress, so Delete all can wait for it (FR-13). */
  const active = useRef<Promise<void> | null>(null);

  const refreshQueue = useCallback(async () => {
    const q = await loadQueue();
    setResumable(q && q.nextIndex < q.items.length ? q : null);
  }, []);

  /** D-32: after sign-in, move the old browser history up once and send what waits in the outbox. */
  const syncHistory = async () => {
    try {
      const moved = await checks.moveLegacyHistory();
      if (moved) setNotice(`${moved} saved result${moved === 1 ? ' was' : 's were'} moved from this browser to the database.`);
      await checks.flush();
    } catch (error) {
      setNotice(storageMessage(error));
    }
    setUploads(await checks.pending());
  };

  // NFR-06: on open, offer to resume an unfinished batch.
  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings());
      await refreshQueue();
      const signedIn = await db.account();
      setAccount(signedIn);
      if (signedIn) await syncHistory();
    })();
  }, [refreshQueue]);

  // FR-22: peer counts for the open card come from the database.
  useEffect(() => {
    setPeers(null);
    if (!open || !account) return;
    let live = true;
    checks
      .peers(open.jobId)
      .then((p) => live && setPeers(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open?.jobId, account]);

  /** Checks need the database: results that cannot be saved would be lost. */
  const ready = (): boolean => {
    if (account) return true;
    setNotice(db.configured ? 'Sign in to the results database in Settings before checking jobs.' : 'Set up the results database first (see Settings).');
    return false;
  };

  const saveCheck = async (r: Result) => {
    await checks.save(r);
    setUploads(await checks.pending());
  };

  /** D-25: a batch and a watch share one lock, so only one runs across all panel windows. */
  const exclusive = async (work: () => Promise<void>): Promise<boolean> => {
    setResumable(null);
    setOpen(null);
    setNotice(null);
    setRunning(true);
    const job = withRunnerLock(work);
    active.current = job.then(
      () => undefined,
      () => undefined,
    );
    try {
      const acquired = await job;
      if (!acquired) setNotice('A batch is already running in another Chrome window. Stop it there or wait for it to finish.');
      return acquired;
    } finally {
      active.current = null;
      setRunning(false);
      runner.current = null;
      await refreshQueue();
      setUploads(await checks.pending());
    }
  };

  const start = async (queue: SavedQueue, errors: LinkError[]) => {
    if (!ready()) return;
    const current = await loadSettings();
    setSettings(current);
    const batch = new BatchRunner({ ...createChecker(current).runnerDeps(setRun), save: saveCheck });
    runner.current = batch;
    await exclusive(async () => {
      const final = await batch.run(queue, errors);
      // UC-1: a single link shows its card straight away.
      const rows = final.rows.filter((r) => r.jobId);
      if (rows.length === 1 && rows[0]?.result) setOpen(rows[0].result);
    });
  };

  // D-31: one watcher per panel, so jobs already met and the rows checked so far are kept between runs.
  const getWatcher = () =>
    (watcher.current ??= new SearchWatcher({
      tabs: chromeTabDriver(),
      checkedIds: (jobIds) => checks.checkedIds(jobIds),
      dayCount: () => getDayCount(new Date()),
      sleep,
      now: () => Date.now(),
      newId,
      onChange: (w) => {
        setWatch(w);
        // The table lists every round; the progress line only shows while a round is checking.
        setRun({ ...w.batch, rows: w.rows, phase: w.phase === 'checking' ? w.batch.phase : 'idle' });
      },
    }));

  /** Run: one refresh now. While auto-refresh waits, it starts the next round early. */
  const startWatch = async () => {
    const w = getWatcher();
    if (w.refreshNow() || w.isActive()) return;
    if (!ready()) {
      w.setAuto(false);
      return;
    }
    const current = await loadSettings();
    setSettings(current);
    const checker = createChecker(current);
    setParseNote(null);
    const acquired = await exclusive(async () => {
      await w.run({
        createRunner: (onChange) => new BatchRunner({ ...checker.runnerDeps(onChange), save: saveCheck }),
        dailyLimit: current.dailyLimit,
        intervalMs: current.watchIntervalSeconds * 1000,
      });
    });
    if (!acquired) w.setAuto(false);
  };

  const onAuto = (on: boolean) => {
    const w = getWatcher();
    w.setAuto(on);
    if (on && !w.isActive()) void startWatch();
  };

  const stopAll = () => {
    watcher.current?.stop();
    runner.current?.stop();
  };

  const onCheck = async (text: string) => {
    if (!ready()) return;
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

  const loadHistory = async (query: string, offset = 0) => {
    setHistory((h) => ({ ...h, query, loading: true }));
    try {
      const page = await checks.list(query, offset);
      setHistory((h) => ({ query, loading: false, more: page.more, rows: offset ? [...h.rows, ...page.rows] : page.rows }));
    } catch (error) {
      setHistory((h) => ({ ...h, loading: false }));
      setNotice(storageMessage(error));
    }
  };

  const loadKnown = async () => {
    try {
      setKnown(await checks.withKnownClient());
    } catch (error) {
      setNotice(storageMessage(error));
    }
  };

  const selectTab = (id: Tab) => {
    setTab(id);
    setOpen(null);
    if (id === 'history') void loadHistory('');
    if (id === 'evaluation') void loadKnown();
  };

  const openJob = async (jobId: string) => {
    try {
      setOpen(await checks.get(jobId));
    } catch (error) {
      setNotice(storageMessage(error));
    }
  };

  const onGroundTruth = async (gt: GroundTruth | null) => {
    if (!open) return;
    try {
      const updated = await checks.setKnownClient(open.jobId, gt);
      if (updated) setOpen(updated);
      else setNotice('This result is still waiting to be uploaded. Add the known name once it is in the database.');
    } catch (error) {
      setNotice(storageMessage(error));
    }
  };

  const confirmPending = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    const now = new Date();
    try {
      switch (p.kind) {
        case 'limit':
          await start(p.queue, p.errors);
          break;
        case 'export': {
          const results = await checks.fetch(p.jobIds);
          if (p.format === 'csv') downloadText(exportFileName('csv', now), toCsv(results), 'text/csv');
          else downloadText(exportFileName('json', now), toJson(results, now), 'application/json');
          break;
        }
        case 'export-report': {
          const report = buildEvaluationReport(await checks.withKnownClient(), now);
          if (p.csv) downloadText(exportFileName('csv', now, 'accuracy-report'), reportToCsv(report), 'text/csv');
          else downloadText(exportFileName('json', now, 'accuracy-report'), JSON.stringify(report, null, 2), 'application/json');
          break;
        }
        case 'delete-one':
          await checks.remove(p.row.jobId);
          if (open?.jobId === p.row.jobId) setOpen(null);
          await loadHistory(history.query);
          break;
        case 'delete-all':
          // The job in flight finishes first, so nothing is saved after the delete.
          stopAll();
          await active.current;
          await deleteAllData(checks);
          setSettings(await loadSettings());
          setOpen(null);
          setRun(emptyState());
          setResumable(null);
          setHistory({ rows: [], more: false, query: '', loading: false });
          setKnown([]);
          setUploads(0);
          setNotice('All data was deleted.');
          break;
      }
    } catch (error) {
      setNotice(storageMessage(error));
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
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = TABS.findIndex((x) => x.id === tab);
                const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
                selectTab(next.id);
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
          <ResultCard result={open} peers={peers} onClose={() => setOpen(null)} onGroundTruth={onGroundTruth} />
        ) : tab === 'check' ? (
          <>
            {uploads > 0 && (
              <div class="notice row wrap" role="status">
                <span>
                  {uploads} result{uploads === 1 ? ' is' : 's are'} waiting to be uploaded to the database.
                </span>
                <button type="button" class="small" onClick={() => void syncHistory()}>
                  Upload now
                </button>
              </div>
            )}
            <WatchView
              watch={watch}
              busy={running && watch.phase === 'idle'}
              intervalSeconds={settings.watchIntervalSeconds}
              onRun={() => void startWatch()}
              onAuto={onAuto}
              onStop={stopAll}
            />
            <CheckView
              state={run}
              running={running}
              resumable={resumable}
              parseNote={parseNote}
              onCheck={(text) => void onCheck(text)}
              onStop={stopAll}
              onResume={() => resumable && void start(resumable, [])}
              onDiscard={async () => {
                await clearQueue();
                setResumable(null);
              }}
              onOpenUpwork={() => {
                // Open the next unchecked job on Upwork so the user can copy a fresh token from its
                // job-details request (D-30), paste it in Settings, then press Retry.
                const next = resumable?.items[resumable.nextIndex]?.url;
                if (next) window.open(next, '_blank', 'noopener');
              }}
              onOpenRow={openRow}
            />
          </>
        ) : tab === 'history' ? (
          <HistoryView
            rows={history.rows}
            more={history.more}
            loading={history.loading}
            onSearch={(query) => void loadHistory(query)}
            onMore={() => void loadHistory(history.query, history.rows.length)}
            onOpen={(jobId) => void openJob(jobId)}
            onDelete={(row) => setPending({ kind: 'delete-one', row })}
            onExport={(jobIds, format) => setPending({ kind: 'export', jobIds, format })}
          />
        ) : tab === 'evaluation' ? (
          <EvalView saved={known} onExport={(csv) => setPending({ kind: 'export-report', csv })} />
        ) : (
          <>
            <DatabaseView
              configured={db.configured}
              account={account}
              onSignIn={async (email, password) => {
                const error = await db.signIn(email, password);
                if (error) return error;
                setAccount(await db.account());
                setNotice(null);
                await syncHistory();
                return null;
              }}
              onSignOut={() => {
                stopAll();
                void db.signOut().then(() => setAccount(null));
              }}
            />
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
        {pending?.kind === 'delete-one' && <p>{pending.row.jobTitle || pending.row.jobId} will be removed from your history.</p>}
        {pending?.kind === 'delete-all' && (
          <p>Every saved result in the database, and the unfinished batch, the daily count and your settings in this browser will be removed. This cannot be undone.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
