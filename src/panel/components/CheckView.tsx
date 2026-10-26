import type { BatchRow, RunnerState } from '../../runner/runner';
import type { WatchState } from '../../watch/watcher';
import { formatDuration } from '../labels';
import { BatchTable } from './BatchTable';

interface Props {
  watch: WatchState;
  onOpenRow: (row: BatchRow) => void;
}

/** FR-30: progress of the round being checked, including an E-RATE pause. */
function Progress({ state }: { state: RunnerState }) {
  const position = Math.min(state.completed + (state.phase === 'running' ? 1 : 0), state.total);
  let line = '';
  if (state.phase === 'paused' && state.stopReason) line = state.stopReason.message;
  else if (state.phase === 'running') line = `Job ${position} of ${state.total}`;
  else if (state.phase === 'waiting') line = `Waiting before job ${state.completed + 1} of ${state.total}`;
  if (!line) return null;

  return (
    <div class="progress" role="status" aria-live="polite">
      <p>{line}</p>
      {state.total > 0 && <progress max={state.total} value={state.completed} aria-label="Round progress" />}
      {state.currentUrl && state.phase === 'running' && <p class="muted break">Checking {state.currentUrl}</p>}
      {state.secondsLeft > 0 && <p class="muted">About {formatDuration(state.secondsLeft)} left</p>}
    </div>
  );
}

/** FR-29, FR-30: the jobs checked since the panel opened, and the progress of the current round. */
export function CheckView({ watch, onOpenRow }: Props) {
  return (
    <div>
      {watch.phase === 'checking' && <Progress state={watch.batch} />}
      {watch.batch.savingDisabled && (
        <p class="notice error" role="alert">
          Could not save results, even in this browser. They are shown here but are lost when the panel closes.
        </p>
      )}
      {watch.rows.length > 0 && <BatchTable rows={watch.rows} onOpen={onOpenRow} />}
    </div>
  );
}
