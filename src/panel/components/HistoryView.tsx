import { useEffect, useRef, useState } from 'preact/hooks';
import type { CheckSummary } from '../../store/checks';
import { formatDateTime, VERDICT_LABEL } from '../labels';

interface Props {
  rows: readonly CheckSummary[];
  /** More rows exist after the loaded ones. */
  more: boolean;
  loading: boolean;
  onSearch: (query: string) => void;
  onMore: () => void;
  onOpen: (jobId: string) => void;
  onDelete: (row: CheckSummary) => void;
  onExport: (jobIds: string[] | 'all', kind: 'csv' | 'json') => void;
}

/** Waits this long after the last keystroke before searching the database. */
export const SEARCH_DELAY_MS = 300;

/** FR-32, FR-33: history newest first, loaded page by page; search, delete one, export selected or all. */
export function HistoryView({ rows, more, loading, onSearch, onMore, onOpen, onDelete, onExport }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onSearch(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const chosen = rows.filter((r) => selected.has(r.jobId)).map((r) => r.jobId);
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.jobId));
  const target = chosen.length ? `${chosen.length} selected` : query.trim() ? 'all (not only the search)' : 'all';

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
        <button type="button" onClick={() => onExport(chosen.length ? chosen : 'all', 'csv')} disabled={!rows.length}>
          Export {target} as CSV
        </button>
        <button type="button" onClick={() => onExport(chosen.length ? chosen : 'all', 'json')} disabled={!rows.length}>
          Export {target} as JSON
        </button>
      </div>
      <p class="muted small" role="status">
        {loading ? 'Loading…' : `${rows.length} result${rows.length === 1 ? '' : 's'} shown${more ? ', more below' : ''}.`}
      </p>
      {rows.length > 0 && (
        <div class="table-wrap">
          <table class="history">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all shown results"
                    checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r.jobId)))}
                  />
                </th>
                <th scope="col">Job</th>
                <th scope="col">Verdict</th>
                <th scope="col">Best evidence</th>
                <th scope="col">Checked</th>
                <th scope="col">
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.jobId}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.jobTitle || r.jobId}`} checked={selected.has(r.jobId)} onChange={() => toggle(r.jobId)} />
                  </td>
                  <td>
                    <button type="button" class="link" onClick={() => onOpen(r.jobId)}>
                      {r.jobTitle || r.jobId}
                    </button>
                    <div class="muted small">{r.jobId}</div>
                  </td>
                  <td>{VERDICT_LABEL[r.verdict]}</td>
                  <td class="break">{r.bestValue ?? ''}</td>
                  <td class="small">{formatDateTime(r.checkedAt)}</td>
                  <td>
                    <button type="button" class="danger small" onClick={() => onDelete(r)} aria-label={`Delete ${r.jobTitle || r.jobId}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button type="button" onClick={onMore} disabled={loading}>
          Show more
        </button>
      )}
    </div>
  );
}
