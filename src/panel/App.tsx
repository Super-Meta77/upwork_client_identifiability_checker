import { useEffect, useRef, useState } from 'preact/hooks';
import { createChecker } from '../app/compose';
import { CheckerError, errorMessage } from '../core/errors';
import type { Result } from '../core/types';
import { toCsv } from '../export/csv';
import { downloadText } from '../export/download';
import { EXPORT_WARNING, exportFileName, toJson } from '../export/json';
import { BatchRunner, sleep, withRunnerLock, type BatchRow } from '../runner/runner';
import { checksStore, type CheckSummary } from '../store/checks';
import { getDayCount } from '../store/local-state';
import { deleteAllData } from '../store/maintenance';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../store/settings';
import { database, type Account } from '../store/supabase';
import { chromeTabDriver } from '../watch/tabs';
import { initialWatchState, SearchWatcher, type WatchState } from '../watch/watcher';
import { CheckView } from './components/CheckView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DatabaseView } from './components/DatabaseView';
import { HistoryView } from './components/HistoryView';
import { ResultCard } from './components/ResultCard';
import { SettingsView } from './components/SettingsView';
import { WatchView } from './components/WatchView';

type Tab = 'check' | 'history' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'check', label: 'Check' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

type Pending = { kind: 'export'; jobIds: string[] | 'all'; format: 'csv' | 'json' } | { kind: 'delete-one'; row: CheckSummary } | { kind: 'delete-all' };

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
  const [watch, setWatch] = useState<WatchState>(initialWatchState());
  const [history, setHistory] = useState<HistoryPage>({ rows: [], more: false, query: '', loading: false });
  const [open, setOpen] = useState<Result | null>(null);
  const [uploads, setUploads] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const watcher = useRef<SearchWatcher | null>(null);
  /** The watch run in progress, so Delete all can wait for it (FR-13). */
  const active = useRef<Promise<void> | null>(null);

  /** D-32: send results that wait in the outbox. */
  const upload = async () => {
    try {
      await checks.flush();
    } catch (error) {
      setNotice(storageMessage(error));
    }
    setUploads(await checks.pending());
  };

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings());
      const signedIn = await db.account();
      setAccount(signedIn);
      if (signedIn) await upload();
    })();
  }, []);

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

  // D-31: one watcher per panel, so jobs already met and the rows checked so far are kept between runs.
  const getWatcher = () =>
    (watcher.current ??= new SearchWatcher({
      tabs: chromeTabDriver(),
      checkedIds: (jobIds) => checks.checkedIds(jobIds),
      dayCount: () => getDayCount(new Date()),
      sleep,
      now: () => Date.now(),
      onChange: setWatch,
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
    setOpen(null);
    setNotice(null);
    // D-25: one watcher across all panel windows.
    const job = withRunnerLock(async () => {
      await w.run({
        createRunner: (onChange) => new BatchRunner({ ...checker.runnerDeps(onChange), save: saveCheck }),
        dailyLimit: current.dailyLimit,
        intervalMs: current.watchIntervalSeconds * 1000,
      });
    });
    active.current = job.then(
      () => undefined,
      () => undefined,
    );
    try {
      if (!(await job)) {
        w.setAuto(false);
        setNotice('Another Chrome window is already watching. Stop it there first.');
      }
    } finally {
      active.current = null;
      setUploads(await checks.pending());
    }
  };

  const onAuto = (on: boolean) => {
    const w = getWatcher();
    w.setAuto(on);
    if (on && !w.isActive()) void startWatch();
  };

  const stop = () => watcher.current?.stop();

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

  const selectTab = (id: Tab) => {
    setTab(id);
    setOpen(null);
    if (id === 'history') void loadHistory('');
  };

  const openJob = async (jobId: string) => {
    try {
      setOpen(await checks.get(jobId));
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
        case 'export': {
          const results = await checks.fetch(p.jobIds);
          if (p.format === 'csv') downloadText(exportFileName('csv', now), toCsv(results), 'text/csv');
          else downloadText(exportFileName('json', now), toJson(results, now), 'application/json');
          break;
        }
        case 'delete-one':
          await checks.remove(p.row.jobId);
          if (open?.jobId === p.row.jobId) setOpen(null);
          await loadHistory(history.query);
          break;
        case 'delete-all':
          // The job in flight finishes first, so nothing is saved after the delete.
          stop();
          await active.current;
          await deleteAllData(checks);
          setSettings(await loadSettings());
          setOpen(null);
          setHistory({ rows: [], more: false, query: '', loading: false });
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
          <ResultCard result={open} onClose={() => setOpen(null)} />
        ) : tab === 'check' ? (
          <>
            {uploads > 0 && (
              <div class="notice row wrap" role="status">
                <span>
                  {uploads} result{uploads === 1 ? ' is' : 's are'} waiting to be uploaded to the database.
                </span>
                <button type="button" class="small" onClick={() => void upload()}>
                  Upload now
                </button>
              </div>
            )}
            <WatchView watch={watch} intervalSeconds={settings.watchIntervalSeconds} onRun={() => void startWatch()} onAuto={onAuto} onStop={stop} />
            <CheckView watch={watch} onOpenRow={openRow} />
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
                await upload();
                return null;
              }}
              onSignOut={() => {
                stop();
                void db.signOut().then(() => setAccount(null));
              }}
            />
            <SettingsView settings={settings} onSave={async (patch) => setSettings(await saveSettings(patch))} onDeleteAll={() => setPending({ kind: 'delete-all' })} />
          </>
        )}
      </main>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'delete-one' ? 'Delete this result?' : pending?.kind === 'delete-all' ? 'Delete all data?' : 'Exports contain personal data'}
        confirmLabel={pending?.kind === 'export' ? 'Export' : 'Delete'}
        danger={pending?.kind !== 'export'}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'export' && <p>{EXPORT_WARNING}</p>}
        {pending?.kind === 'delete-one' && <p>{pending.row.jobTitle || pending.row.jobId} will be removed from your history.</p>}
        {pending?.kind === 'delete-all' && (
          <p>Every saved result in the database, and the daily count, the Upwork token and your settings in this browser will be removed. This cannot be undone.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
