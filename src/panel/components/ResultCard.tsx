import { useMemo, useState } from 'preact/hooks';
import type { GroundTruth, Result } from '../../core/types';
import { withMatches } from '../../eval/match';
import { peerCounts, PEER_FIELDS, type PeerField } from '../../store/peers';
import { REASON_TEXT } from '../../verdict';
import { formatDateTime, S3_LABEL, SOURCE_LABEL, SOURCE_ORDER, VERDICT_LABEL } from '../labels';
import { EvidenceItem } from './EvidenceItem';

const PEER_LABEL: Record<PeerField, string> = {
  country: 'country',
  city: 'city',
  industry: 'industry',
  size: 'company size',
  memberSinceYear: 'member-since year',
};

export function VerdictBadge({ verdict }: { verdict: Result['verdict'] }) {
  return <span class={`badge verdict-${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

function S3Panel({ result, saved }: { result: Result; saved: readonly Result[] }) {
  const s3 = result.distinctiveness;
  const peers = useMemo(() => peerCounts(result, saved), [result, saved]);
  if (!s3) return null;
  return (
    <section class="s3" aria-labelledby={`s3-${result.jobId}`}>
      <h3 id={`s3-${result.jobId}`}>{SOURCE_LABEL.S3}</h3>
      <p>
        Distinctiveness <strong>{s3.score} / 100</strong> <span class="muted">(an estimate, not a measurement)</span>
      </p>
      {s3.details.length > 0 ? (
        <ul class="plain">
          {s3.details.map((d) => (
            <li key={d.attribute}>
              {S3_LABEL[d.attribute]}: {d.value} <span class="muted">+{d.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No trust details were shown for this client.</p>
      )}
      {result.profile && (
        <p class="muted">
          In your saved results:{' '}
          {PEER_FIELDS.filter((f) => peers[f] !== null)
            .map((f) => `${peers[f]} other client${peers[f] === 1 ? '' : 's'} share this ${PEER_LABEL[f]}`)
            .join('; ') || 'no comparable clients yet'}
          .
        </p>
      )}
      <p class="why">{REASON_TEXT['R-S3']}</p>
    </section>
  );
}

function GroundTruthEditor({ result, onSave }: { result: Result; onSave: (gt: GroundTruth | null) => void }) {
  const [person, setPerson] = useState(result.groundTruth?.personName ?? '');
  const [company, setCompany] = useState(result.groundTruth?.companyName ?? '');
  const [website, setWebsite] = useState(result.groundTruth?.website ?? '');
  const id = (name: string) => `gt-${name}-${result.jobId}`;
  const matched = result.groundTruth?.matchedEvidenceIds.length ?? 0;

  return (
    <details class="ground-truth">
      <summary>Known client name (for your own past clients)</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const empty = !person.trim() && !company.trim() && !website.trim();
          onSave(empty ? null : withMatches(result, { personName: person, companyName: company, website }));
        }}
      >
        <label for={id('person')}>Person name</label>
        <input id={id('person')} value={person} onInput={(e) => setPerson(e.currentTarget.value)} autocomplete="off" />
        <label for={id('company')}>Company name</label>
        <input id={id('company')} value={company} onInput={(e) => setCompany(e.currentTarget.value)} autocomplete="off" />
        <label for={id('website')}>Website</label>
        <input id={id('website')} value={website} onInput={(e) => setWebsite(e.currentTarget.value)} autocomplete="off" />
        <div class="row">
          <button type="submit">Save known name</button>
          {result.groundTruth && <span class="muted">{matched} finding{matched === 1 ? '' : 's'} match it.</span>}
        </div>
      </form>
    </details>
  );
}

interface Props {
  result: Result;
  saved: readonly Result[];
  onClose?: () => void;
  onGroundTruth?: (gt: GroundTruth | null) => void;
}

/** FR-28: verdict, title, link, evidence by source with confidence, S3 score, checked time. */
export function ResultCard({ result, saved, onClose, onGroundTruth }: Props) {
  const strong = result.evidence.filter((e) => e.confidence !== 'low' && e.source !== 'S3');
  const weak = result.evidence.filter((e) => e.confidence === 'low' && e.source !== 'S3');
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

      {best && (
        <p>
          Best evidence: <strong>{best.value}</strong>
        </p>
      )}

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

      {!result.error && !strong.length && <p class="muted">No name, website or email was found at Medium or High confidence.</p>}

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

      <S3Panel result={result} saved={saved} />

      {result.attachmentNotes.length > 0 && (
        <section>
          <h3>Attachments not analysed</h3>
          <ul class="plain">
            {result.attachmentNotes.map((n) => (
              <li key={n.fileName}>{n.message}</li>
            ))}
          </ul>
        </section>
      )}

      {onGroundTruth && result.verdict !== 'error' && <GroundTruthEditor result={result} onSave={onGroundTruth} />}
    </article>
  );
}
