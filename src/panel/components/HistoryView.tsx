import { useMemo, useState } from 'preact/hooks';
import type { Result } from '../../core/types';
import { searchResults } from '../../store/db';
import { formatDateTime, VERDICT_LABEL } from '../labels';

interface Props {
  saved: readonly Result[];
  onOpen: (r: Result) => void;
  onDelete: (r: Result) => void;
  onExport: (results: Result[], kind: 'csv' | 'json') => void;
}

/** FR-32, FR-33: history newest first, search, delete one, export selected or all. */
export function HistoryView({ saved, onOpen, onDelete, onExport }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const shown = useMemo(() => searchResults(saved, query), [saved, query]);
  const chosen = saved.filter((r) => selected.has(r.jobId));
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.jobId));

  const toggle = (jobId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });

  return (
    <div>
      <label for="history-search">Search by job ID, title or verdict</label>
      <input id="history-search" type="search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      <div class="row wrap">
        <button type="button" onClick={() => onExport(chosen.length ? chosen : [...saved], 'csv')} disabled={!saved.length}>
          Export {chosen.length ? `${chosen.length} selected` : 'all'} as CSV
        </button>
        <button type="button" onClick={() => onExport(chosen.length ? chosen : [...saved], 'json')} disabled={!saved.length}>
          Export {chosen.length ? `${chosen.length} selected` : 'all'} as JSON
        </button>
      </div>
      <p class="muted small">
        {saved.length} saved result{saved.length === 1 ? '' : 's'}
        {query && `, ${shown.length} shown`}.
      </p>
      {shown.length > 0 && (
        <div class="table-wrap">
          <table class="history">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all shown results"
                    checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.jobId)))}
                  />
                </th>
                <th scope="col">Job</th>
                <th scope="col">Verdict</th>
                <th scope="col">Checked</th>
                <th scope="col">
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.jobId}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.jobTitle ?? r.jobId}`} checked={selected.has(r.jobId)} onChange={() => toggle(r.jobId)} />
                  </td>
                  <td>
                    <button type="button" class="link" onClick={() => onOpen(r)}>
                      {r.jobTitle ?? r.jobId}
                    </button>
                    <div class="muted small">{r.jobId}</div>
                  </td>
                  <td>{VERDICT_LABEL[r.verdict]}</td>
                  <td class="small">{formatDateTime(r.checkedAt)}</td>
                  <td>
                    <button type="button" class="danger small" onClick={() => onDelete(r)} aria-label={`Delete ${r.jobTitle ?? r.jobId}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
