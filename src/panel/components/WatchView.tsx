import type { WatchState } from '../../watch/watcher';
import { formatDuration } from '../labels';

interface Props {
  watch: WatchState;
  /** A pasted-links batch is running, here or in another window. */
  busy: boolean;
  intervalSeconds: number;
  onRun: () => void;
  onAuto: (on: boolean) => void;
  onStop: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { timeStyle: 'medium' });

function statusLine(w: WatchState): string | null {
  const how = w.lastSearch ? ` (searched "${w.lastSearch.query}"${w.lastSearch.reloaded ? ', page reloaded' : ''})` : '';
  const found = `${plural(w.onPage, 'job')} on the page, ${w.fresh} new`;
  switch (w.phase) {
    case 'refreshing':
      return 'Refreshing the search page…';
    case 'checking':
      return `Checking ${plural(w.fresh, 'new job')}…`;
    case 'waiting':
      return `${found}${how}. Next refresh at ${w.nextRoundAt ? clock(w.nextRoundAt) : ''}.`;
    case 'idle':
      return w.lastRoundAt ? `Last refresh at ${clock(w.lastRoundAt)}: ${found}${how}.` : null;
  }
}

/** D-31: Run refreshes the Upwork search tab once; Auto-refresh repeats it every interval. */
export function WatchView({ watch, busy, intervalSeconds, onRun, onAuto, onStop }: Props) {
  const active = watch.phase !== 'idle';
  const inRound = watch.phase === 'refreshing' || watch.phase === 'checking';
  const line = statusLine(watch);
  return (
    <section class="watch" aria-labelledby="watch-title">
      <h2 id="watch-title">Watch the job search page</h2>
      <p class="muted small">
        Open Upwork's job search in this window. Run searches again (one more "/" in the search box) and checks each job not checked before. Keep this panel
        open: closing it stops auto-refresh.
      </p>
      <div class="row wrap">
        <button type="button" class="primary" onClick={onRun} disabled={busy || inRound}>
          Run
        </button>
        <label class="check">
          <input type="checkbox" checked={watch.auto} disabled={busy} onChange={(e) => onAuto(e.currentTarget.checked)} />
          Auto-refresh every {formatDuration(intervalSeconds)}
        </label>
        {active && (
          <button type="button" onClick={onStop}>
            Stop watching
          </button>
        )}
      </div>
      {line && (
        <p class="muted" role="status" aria-live="polite">
          {line}
          {watch.checked > 0 && ` ${plural(watch.checked, 'job')} checked since the panel opened.`}
        </p>
      )}
      {watch.stopReason && (
        <p class="notice error" role="alert">
          {watch.stopReason.message}
        </p>
      )}
    </section>
  );
}
