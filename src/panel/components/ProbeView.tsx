import { useState } from 'preact/hooks';
import { parseLinks } from '../../links/parse';
import { chromeProbeDeps, probeAttachment, probeFieldAccess, runProbe, type ProbeStep } from '../../upwork/probe';

/** Phase 0 go/no-go probe. Only in dev and `npm run build:probe` builds. */
export function ProbeView() {
  const [links, setLinks] = useState('');
  const [uri, setUri] = useState('');
  const [steps, setSteps] = useState<ProbeStep[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const ids = parseLinks(links).links.map((l) => l.jobId);
    if (!ids.length) return;
    setBusy(true);
    setSteps([]);
    try {
      await runProbe(ids, chromeProbeDeps(), (s) => setSteps((all) => [...all, s]));
    } finally {
      setBusy(false);
    }
  };

  const fieldAccess = async () => {
    const [first] = parseLinks(links).links;
    if (!first) return;
    setBusy(true);
    setSteps([]);
    try {
      await probeFieldAccess(first.jobId, chromeProbeDeps(), (s) => setSteps((all) => [...all, s]));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const step = await probeAttachment(uri.trim(), chromeProbeDeps());
      setSteps((all) => [...all, step]);
    } finally {
      setBusy(false);
    }
  };

  const output = JSON.stringify(steps, null, 2);

  return (
    <section class="probe" aria-labelledby="probe-title">
      <h2 id="probe-title">Phase 0 probe</h2>
      <p class="muted">
        Each run tries every login token in turn (the token you pasted in Settings, the last one that worked, then cookies) against the first job and stops at the first one Upwork
        accepts, then records the error shapes. Requests are 3 s apart. It shows response shapes, which login source a token came from, and error messages, never token values or field
        contents. Paste the output into docs/phase0-report.md.
      </p>
      <label for="probe-links">Up to 3 job links</label>
      <textarea id="probe-links" rows={3} value={links} onInput={(e) => setLinks(e.currentTarget.value)} />
      <div class="row">
        <button type="button" onClick={run} disabled={busy}>
          {busy ? 'Probing…' : 'Run probe'}
        </button>
        <button type="button" onClick={fieldAccess} disabled={busy}>
          Probe field access (first link)
        </button>
      </div>
      <label for="probe-uri">One attachment uri from a job-details response (optional)</label>
      <input id="probe-uri" value={uri} onInput={(e) => setUri(e.currentTarget.value)} />
      <div class="row">
        <button type="button" disabled={busy || !uri.trim()} onClick={download}>
          Download that attachment
        </button>
      </div>
      {steps.length > 0 && (
        <>
          <pre class="probe-output" tabIndex={0}>
            {output}
          </pre>
          <button type="button" onClick={() => void navigator.clipboard.writeText(output)}>
            Copy output
          </button>
        </>
      )}
    </section>
  );
}
