import type { Result } from '../../core/types';
import { CONFIDENCE_LABEL, formatDateTime, KIND_LABEL, SOURCE_LABEL, SOURCE_ORDER, VERDICT_LABEL } from '../labels';
import { EvidenceItem } from './EvidenceItem';

export function VerdictBadge({ verdict }: { verdict: Result['verdict'] }) {
  return <span class={`badge verdict-${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

interface Props {
  result: Result;
  onClose?: () => void;
}

/** FR-28: verdict, why, title, link, and the findings by source with their confidence. */
export function ResultCard({ result, onClose }: Props) {
  const strong = result.evidence.filter((e) => e.confidence !== 'low');
  const weak = result.evidence.filter((e) => e.confidence === 'low');
  const best = result.evidence.find((e) => e.id === result.bestEvidenceId);

  return (
    <article class="card" aria-labelledby={`title-${result.jobId}`}>
      <header class="card-head">
        <VerdictBadge verdict={result.verdict} />
        <h2 id={`title-${result.jobId}`}>{result.jobTitle ?? result.jobId}</h2>
        <p class="muted">
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            {result.url}
          </a>
          <br />
          Checked {formatDateTime(result.checkedAt)}
        </p>
        {onClose && (
          <button type="button" class="close" onClick={onClose} aria-label="Close result">
            Close
          </button>
        )}
      </header>

      {result.error && (
        <p class="notice error" role="alert">
          {result.error.code}: {result.error.message}
        </p>
      )}

      {result.verdict === 'has_potential' && best && (
        <p>
          Why: <strong>{best.value}</strong> ({KIND_LABEL[best.kind].toLowerCase()}, {CONFIDENCE_LABEL[best.confidence]} confidence, from{' '}
          {SOURCE_LABEL[best.source].replace(/^\S+ · /, '').toLowerCase()})
          {strong.length > 1 && `, and ${strong.length - 1} more below`}.
        </p>
      )}
      {result.verdict === 'no_potential' && <p>No name, website or email was found at Medium or High confidence.</p>}

      {SOURCE_ORDER.map((source) => {
        const items = strong.filter((e) => e.source === source);
        if (!items.length) return null;
        return (
          <section key={source}>
            <h3>{SOURCE_LABEL[source]}</h3>
            <ul class="plain">
              {items.map((e) => (
                <EvidenceItem key={e.id} e={e} />
              ))}
            </ul>
          </section>
        );
      })}

      {weak.length > 0 && (
        <details class="weak">
          <summary>
            Weak signals ({weak.length}) — Low confidence, not used for the verdict
          </summary>
          <ul class="plain">
            {weak.map((e) => (
              <EvidenceItem key={e.id} e={e} />
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
