import { useEffect, useState } from 'preact/hooks';
import type { S3Attribute } from '../../core/types';
import type { Settings } from '../../store/settings';
import { S3_LABEL } from '../labels';

interface Props {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onDeleteAll: () => void;
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** FR-34: delay, attachments, retention, daily limit, S3 calibration, list additions, delete all. */
export function SettingsView({ settings, onSave, onDeleteAll }: Props) {
  const [draft, setDraft] = useState(settings);
  const [sites, setSites] = useState(settings.extraGenericSites.join('\n'));
  const [endings, setEndings] = useState(settings.extraLegalEndings.join('\n'));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setSites(settings.extraGenericSites.join('\n'));
    setEndings(settings.extraLegalEndings.join('\n'));
  }, [settings]);

  const num = (key: 'delaySeconds' | 'retentionDays' | 'dailyLimit' | 's3Threshold') => (e: Event) =>
    setDraft((d) => ({ ...d, [key]: Number((e.currentTarget as HTMLInputElement).value) }));

  const point = (key: S3Attribute) => (e: Event) =>
    setDraft((d) => ({ ...d, s3Points: { ...d.s3Points, [key]: Number((e.currentTarget as HTMLInputElement).value) } }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSave({ ...draft, extraGenericSites: lines(sites), extraLegalEndings: lines(endings) });
          setStatus('Settings saved.');
        } catch {
          setStatus('Not saved: check that every value is within its range.');
        }
      }}
    >
      <label for="delay">Delay between jobs (seconds, 3 to 30)</label>
      <input id="delay" type="number" min={3} max={30} required value={draft.delaySeconds} onInput={num('delaySeconds')} />

      <label class="check">
        <input type="checkbox" checked={draft.attachmentsEnabled} onChange={(e) => setDraft((d) => ({ ...d, attachmentsEnabled: e.currentTarget.checked }))} />
        Analyse attachment properties (downloads up to 5 files per job, 10 MB each)
      </label>

      <label for="retention">Delete results automatically after (days)</label>
      <input id="retention" type="number" min={1} max={365} required value={draft.retentionDays} onInput={num('retentionDays')} />

      <label for="daily">Warn when a batch would take today's total past (jobs)</label>
      <input id="daily" type="number" min={1} max={1000} required value={draft.dailyLimit} onInput={num('dailyLimit')} />

      <details>
        <summary>Advanced: S3 score and word lists</summary>
        <label for="threshold">Narrowable when the S3 score is at least</label>
        <input id="threshold" type="number" min={0} max={100} required value={draft.s3Threshold} onInput={num('s3Threshold')} />
        <fieldset>
          <legend>Points per trust detail</legend>
          {(Object.keys(S3_LABEL) as S3Attribute[]).map((key) => (
            <div class="inline-field" key={key}>
              <label for={`pts-${key}`}>{S3_LABEL[key]}</label>
              <input id={`pts-${key}`} type="number" min={0} max={100} required value={draft.s3Points[key]} onInput={point(key)} />
            </div>
          ))}
        </fieldset>
        <label for="sites">Extra generic websites to ignore (one per line)</label>
        <textarea id="sites" rows={3} value={sites} onInput={(e) => setSites(e.currentTarget.value)} />
        <label for="endings">Extra legal endings (one per line, e.g. Sàrl)</label>
        <textarea id="endings" rows={3} value={endings} onInput={(e) => setEndings(e.currentTarget.value)} />
      </details>

      <div class="row">
        <button type="submit" class="primary">
          Save settings
        </button>
        {status && (
          <span role="status" class="muted">
            {status}
          </span>
        )}
      </div>

      <hr />
      <h2>Delete data</h2>
      <p class="muted">Removes every saved result, the unfinished batch, the daily count and your settings. The extension then starts fresh.</p>
      <button type="button" class="danger" onClick={onDeleteAll}>
        Delete all data
      </button>
    </form>
  );
}
