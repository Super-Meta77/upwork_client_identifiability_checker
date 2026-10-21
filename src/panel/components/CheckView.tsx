import { useState } from 'preact/hooks';
import { MAX_LINKS_PER_BATCH } from '../../links/parse';
import type { BatchRow, RunnerState } from '../../runner/runner';
import type { SavedQueue } from '../../store/local-state';
import { formatDuration } from '../labels';
import { BatchTable } from './BatchTable';

interface Props {
  state: RunnerState;
  running: boolean;
  resumable: SavedQueue | null;
  parseNote: string | null;
  onCheck: (text: string) => void;
  onStop: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onOpenRow: (row: BatchRow) => void;
}

function Progress({ state }: { state: RunnerState }) {
  const position = Math.min(state.completed + (state.phase === 'running' ? 1 : 0), state.total);
  let line = '';
  if (state.phase === 'paused' && state.stopReason) line = state.stopReason.message;
  else if (state.phase === 'running') line = `Job ${position} of ${state.total}`;
  else if (state.phase === 'waiting') line = `Waiting before job ${state.completed + 1} of ${state.total}`;
  else if (state.phase === 'done') line = `Finished: ${state.total} job${state.total === 1 ? '' : 's'} checked.`;
  else if (state.phase === 'stopped') line = state.stopReason ? `Stopped. ${state.stopReason.message}` : `Stopped after ${state.completed} of ${state.total}.`;
  if (!line) return null;
  const active = state.phase === 'running' || state.phase === 'waiting' || state.phase === 'paused';

  return (
    <div class={`progress ${state.phase === 'stopped' && state.stopReason ? 'notice error' : ''}`} role="status" aria-live="polite">
      <p>{line}</p>
      {active && state.total > 0 && <progress max={state.total} value={state.completed} aria-label="Batch progress" />}
      {state.currentUrl && state.phase === 'running' && <p class="muted break">Checking {state.currentUrl}</p>}
      {active && state.secondsLeft > 0 && <p class="muted">About {formatDuration(state.secondsLeft)} left</p>}
    </div>
  );
}

/** FR-01, FR-02, FR-13, FR-30: link input, Check, Stop, progress and the batch table. */
export function CheckView({ state, running, resumable, parseNote, onCheck, onStop, onResume, onDiscard, onOpenRow }: Props) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!running && text.trim()) onCheck(text);
  };

  return (
    <div>
      {resumable && !running && (
        <div class="notice" role="region" aria-label="Unfinished batch">
          <p>
            An unfinished batch has {resumable.items.length - resumable.nextIndex} of {resumable.items.length} links left.
          </p>
          <div class="row">
            <button type="button" class="primary" onClick={onResume}>
              {state.stopReason ? 'Retry' : 'Resume'} from link {resumable.nextIndex + 1}
            </button>
            <button type="button" onClick={onDiscard}>
              Discard
            </button>
          </div>
        </div>
      )}

      <label for="links">Upwork job links, one per line (up to {MAX_LINKS_PER_BATCH})</label>
      <textarea
        id="links"
        rows={4}
        value={text}
        spellcheck={false}
        placeholder="https://www.upwork.com/jobs/~01…"
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // FR-01: Enter runs a single link; Ctrl/Cmd+Enter runs a batch.
          const single = !text.trim().includes('\n');
          if (e.key === 'Enter' && !e.shiftKey && (single || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <p class="muted small">Enter checks one link. For several links press Ctrl+Enter or the Check button.</p>
      <div class="row">
        <button type="button" class="primary" onClick={submit} disabled={running || !text.trim()}>
          Check
        </button>
        <button type="button" onClick={onStop} disabled={!running}>
          Stop
        </button>
      </div>
      {parseNote && <p class="muted">{parseNote}</p>}

      <Progress state={state} />
      {state.savingDisabled && (
        <p class="notice error" role="alert">
          Could not save results. Export them, then delete old results.
        </p>
      )}
      {state.rows.length > 0 && <BatchTable rows={state.rows} onOpen={onOpenRow} />}
    </div>
  );
}
