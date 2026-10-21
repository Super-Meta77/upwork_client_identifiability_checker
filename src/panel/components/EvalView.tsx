import { useMemo } from 'preact/hooks';
import type { Result } from '../../core/types';
import { buildEvaluationReport, formatShare } from '../../eval/report';
import { CONFIDENCE_LABEL, SOURCE_LABEL } from '../labels';

interface Props {
  saved: readonly Result[];
  onExport: (csv: boolean) => void;
}

/** FR-36: hit rate and precision per source, from results with a known client name. */
export function EvalView({ saved, onExport }: Props) {
  const report = useMemo(() => buildEvaluationReport(saved, new Date()), [saved]);

  return (
    <div>
      <p>
        Enter the known client name on results for your own past clients (open a result, then "Known client name"). This report compares the findings with those names.
      </p>
      <p>
        <strong>{report.groundTruthJobs}</strong> job{report.groundTruthJobs === 1 ? '' : 's'} with a known name
        {report.groundTruthJobs < 20 && <span class="muted"> (the v1 evaluation needs at least 20)</span>}.
      </p>
      <div class="table-wrap">
        <table>
          <caption>Per source</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Hit rate</th>
              <th scope="col">Precision</th>
            </tr>
          </thead>
          <tbody>
            {report.sources.map((s) => (
              <tr key={s.source}>
                <th scope="row">{SOURCE_LABEL[s.source]}</th>
                <td>
                  {formatShare(s.hitRate)} <span class="muted small">({s.jobsWithEvidence}/{s.jobs} jobs)</span>
                </td>
                <td>
                  {formatShare(s.precision)} <span class="muted small">({s.matched}/{s.evidence} findings)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="table-wrap">
        <table>
          <caption>Per confidence level</caption>
          <thead>
            <tr>
              <th scope="col">Confidence</th>
              <th scope="col">Precision</th>
            </tr>
          </thead>
          <tbody>
            {report.levels.map((l) => (
              <tr key={l.level}>
                <th scope="row">{CONFIDENCE_LABEL[l.level]}</th>
                <td>
                  {formatShare(l.precision)} <span class="muted small">({l.matched}/{l.evidence} findings)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul class="muted small">
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div class="row">
        <button type="button" onClick={() => onExport(true)} disabled={!report.groundTruthJobs}>
          Export report as CSV
        </button>
        <button type="button" onClick={() => onExport(false)} disabled={!report.groundTruthJobs}>
          Export report as JSON
        </button>
      </div>
    </div>
  );
}
