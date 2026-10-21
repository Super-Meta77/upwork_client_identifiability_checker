import type { Evidence } from '../../core/types';
import { REASON_TEXT } from '../../verdict';
import { CONFIDENCE_LABEL, KIND_LABEL } from '../labels';

/** Splits the snippet around the value so it can be highlighted without innerHTML (NFR-10). */
function Snippet({ text, value }: { text: string; value: string }) {
  const at = text.toLowerCase().indexOf(value.toLowerCase());
  if (!value || at < 0) return <q class="snippet">{text}</q>;
  return (
    <q class="snippet">
      {text.slice(0, at)}
      <mark>{text.slice(at, at + value.length)}</mark>
      {text.slice(at + value.length)}
    </q>
  );
}

/** FR-25: how each finding was found and why Upwork exposes it. */
export function EvidenceItem({ e }: { e: Evidence }) {
  return (
    <li class="evidence">
      <div class="evidence-head">
        <strong class="value">{e.value}</strong>
        <span class="tag">{KIND_LABEL[e.kind]}</span>
        <span class={`tag conf-${e.confidence}`}>{CONFIDENCE_LABEL[e.confidence]} confidence</span>
        {e.mentions > 1 && <span class="tag">{e.mentions} mentions</span>}
      </div>
      <dl class="how-why">
        <dt>How</dt>
        <dd>
          <code>{e.location}</code>
          {e.snippet && e.snippet !== e.value && (
            <>
              <br />
              <Snippet text={e.snippet} value={e.value} />
            </>
          )}
        </dd>
        <dt>Why</dt>
        <dd>{REASON_TEXT[e.reasonId]}</dd>
        {e.agreesWith.length > 0 && e.confidence !== e.baseConfidence && (
          <>
            <dt>Agreement</dt>
            <dd>
              Matches {e.agreesWith.length} finding{e.agreesWith.length > 1 ? 's' : ''} from another source, so confidence was raised from{' '}
              {CONFIDENCE_LABEL[e.baseConfidence]} to {CONFIDENCE_LABEL[e.confidence]}.
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
