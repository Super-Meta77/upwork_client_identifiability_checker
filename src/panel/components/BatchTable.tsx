import { useMemo, useState } from 'preact/hooks';
import type { BatchRow } from '../../runner/runner';
import { CONFIDENCE_RANK } from '../../verdict';
import { CONFIDENCE_LABEL, STATUS_LABEL, VERDICT_LABEL } from '../labels';

type SortKey = 'order' | 'title' | 'verdict' | 'best' | 'confidence' | 's3' | 'status';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Job title' },
  { key: 'verdict', label: 'Verdict' },
  { key: 'best', label: 'Best evidence' },
  { key: 'confidence', label: 'Confidence' },
  { key: 's3', label: 'S3' },
  { key: 'status', label: 'Status' },
];

function bestOf(row: BatchRow) {
  return row.result?.evidence.find((e) => e.id === row.result?.bestEvidenceId) ?? null;
}

function sortValue(row: BatchRow, key: SortKey, index: number): string | number {
  switch (key) {
    case 'order':
      return index;
    case 'title':
      return (row.result?.jobTitle ?? row.input).toLowerCase();
    case 'verdict':
      return row.result ? VERDICT_LABEL[row.result.verdict] : '';
    case 'best':
      return (bestOf(row)?.value ?? '').toLowerCase();
    case 'confidence': {
      const best = bestOf(row);
      return best ? CONFIDENCE_RANK[best.confidence] : -1;
    }
    case 's3':
      return row.result?.distinctiveness?.score ?? -1;
    case 'status':
      return STATUS_LABEL[row.status];
  }
}

interface Props {
  rows: readonly BatchRow[];
  onOpen: (row: BatchRow) => void;
}

/** FR-29: one row per link; sortable; a row opens its card. */
export function BatchTable({ rows, onOpen }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'order', dir: 1 });
  const sorted = useMemo(() => {
    const indexed = rows.map((row, i) => ({ row, i }));
    return indexed.sort((a, b) => {
      const x = sortValue(a.row, sort.key, a.i);
      const y = sortValue(b.row, sort.key, b.i);
      return (x < y ? -1 : x > y ? 1 : a.i - b.i) * sort.dir;
    });
  }, [rows, sort]);

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <div class="table-wrap">
      <table class="batch">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" class="sort" onClick={() => toggle(c.key)}>
                  {c.label}
                  <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row }) => {
            const best = bestOf(row);
            return (
              <tr key={row.key} class={row.status === 'running' ? 'running' : ''}>
                <td>
                  {row.result ? (
                    <button type="button" class="link" onClick={() => onOpen(row)}>
                      {row.result.jobTitle ?? row.jobId}
                    </button>
                  ) : (
                    <span class="muted break">{row.input}</span>
                  )}
                </td>
                <td>{row.result ? VERDICT_LABEL[row.result.verdict] : row.error ? 'Error' : ''}</td>
                <td class="break">{best?.value ?? ''}</td>
                <td>{best ? CONFIDENCE_LABEL[best.confidence] : ''}</td>
                <td>{row.result?.distinctiveness?.score ?? ''}</td>
                <td>
                  {STATUS_LABEL[row.status]}
                  {row.error && <span class="muted"> · {row.error.code}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
