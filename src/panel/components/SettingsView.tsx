import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../../store/settings';
import { clearToken, hasToken, isTokenShaped, setToken } from '../../upwork';

interface Props {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onDeleteAll: () => void;
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** FR-34: the Upwork token, auto-refresh interval, delay, daily limit, word lists, delete all. */
export function SettingsView({ settings, onSave, onDeleteAll }: Props) {
  const [draft, setDraft] = useState(settings);
  const [sites, setSites] = useState(settings.extraGenericSites.join('\n'));
  const [endings, setEndings] = useState(settings.extraLegalEndings.join('\n'));
  const [status, setStatus] = useState<string | null>(null);
  const [tokenSet, setTokenSet] = useState<boolean | undefined>(undefined);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenStatus, setTokenStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setSites(settings.extraGenericSites.join('\n'));
    setEndings(settings.extraLegalEndings.join('\n'));
  }, [settings]);

  // Whether a token is set — never the token itself (NFR-08).
  const refreshTokenSet = () => {
    void hasToken()
      .then(setTokenSet)
      .catch(() => setTokenSet(false));
  };
  useEffect(refreshTokenSet, []);

  const saveToken = async () => {
    const value = tokenInput.trim();
    if (!isTokenShaped(value)) {
      setTokenStatus('That does not look like an Upwork token (it should start with "oauth2v2_" or "eyJ").');
      return;
    }
    await setToken(value);
    setTokenInput('');
    setTokenStatus('Token saved for this browser session.');
    refreshTokenSet();
  };

  const removeToken = async () => {
    await clearToken();
    setTokenInput('');
    setTokenStatus('Token cleared.');
    refreshTokenSet();
  };

  const num = (key: 'delaySeconds' | 'dailyLimit' | 'watchIntervalSeconds') => (e: Event) =>
    setDraft((d) => ({ ...d, [key]: Number((e.currentTarget as HTMLInputElement).value) }));

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
      {tokenSet !== undefined && (
        <p class={`notice${tokenSet ? '' : ' error'}`} role="status">
          {tokenSet ? 'Upwork token set for this browser session.' : 'No Upwork token set. Paste one below.'}
        </p>
      )}

      <fieldset>
        <legend>Upwork access token</legend>
        <p class="muted small">
          On www.upwork.com open a job, then in DevTools → Network find the <code>jobAuthDetails</code> request and copy the value of its <code>authorization</code> header after
          "Bearer ". Paste it here. It is kept in memory only, never saved to disk, sent to the database or exported, and is cleared when you close the browser or when
          Upwork says it has expired.
        </p>
        <label for="manual-token">Bearer token</label>
        <input
          id="manual-token"
          type="password"
          autocomplete="off"
          spellcheck={false}
          placeholder="oauth2v2_…"
          value={tokenInput}
          onInput={(e) => setTokenInput(e.currentTarget.value)}
        />
        <div class="row">
          <button type="button" class="primary" onClick={() => void saveToken()} disabled={!tokenInput.trim()}>
            Save token
          </button>
          <button type="button" onClick={() => void removeToken()}>
            Clear token
          </button>
          {tokenStatus && (
            <span role="status" class="muted">
              {tokenStatus}
            </span>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Watching the job search page</legend>
        <label for="watch-interval">Auto-refresh: seconds between refreshes (30 to 3600)</label>
        <input id="watch-interval" type="number" min={30} max={3600} required value={draft.watchIntervalSeconds} onInput={num('watchIntervalSeconds')} />
        <label for="delay">Delay between jobs (seconds, 3 to 30)</label>
        <input id="delay" type="number" min={3} max={30} required value={draft.delaySeconds} onInput={num('delaySeconds')} />
        <label for="daily">Daily limit: stop watching after this many jobs in a day</label>
        <input id="daily" type="number" min={1} max={1000} required value={draft.dailyLimit} onInput={num('dailyLimit')} />
      </fieldset>

      <details>
        <summary>Advanced: word lists</summary>
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
      <p class="muted">Removes every saved result from the database, and the daily count, the Upwork token and your settings from this browser. You stay signed in.</p>
      <button type="button" class="danger" onClick={onDeleteAll}>
        Delete all data
      </button>
    </form>
  );
}
