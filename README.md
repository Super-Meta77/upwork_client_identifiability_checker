# Upwork Client Identifiability Checker

A Chrome extension that answers one question per Upwork job link: **can the client be identified before any contact, and from what evidence?**

For each link it reads the job data Upwork already sends to you while you are logged in, looks for names, websites and emails in it, and gives a verdict:

- Identified before contact
- Partially identified
- Narrowable
- Not identifiable before contact
- Error

Every finding shows **how** it was found (the field or file, with surrounding text) and **why** Upwork exposes it.

The extension contacts no host except `www.upwork.com`. It never looks anything up elsewhere: no search engines, LinkedIn, company registers or WHOIS. There is no server; everything stays in your browser.

> **Status:** the code is complete and tested offline against invented fixtures. Several Upwork details (the token cookie name, the exact query shape, the attachment host) are still guesses, until **Phase 0** below confirms them against your own logged-in browser. Until then a live check may fail with E-AUTH, E-SCOPE or E-FORMAT.

## Install

Requires Node 22.12+ and Chrome 120+.

```sh
npm ci
npm run build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the `dist/` folder. Click the extension's toolbar icon to open the side panel.

For development, `npm run dev` serves a build that reloads on save. Load `dist/` the same way.

## Permissions and why each is needed

| Permission | Why |
| --- | --- |
| `storage` | Saves your settings, the unfinished-batch queue and the daily job count (`chrome.storage.local`). Keeps the Upwork token in memory only (`chrome.storage.session`). |
| `cookies` | Reads the Upwork login cookies that may hold the token for the job-details request. Your password is never asked for, stored or sent. |
| `sidePanel` | Shows the checker in Chrome's side panel. |
| Host access to `https://www.upwork.com/*` | Sends the job-details request and downloads the job's own attachments. No other host is allowed (NFR-07). |

If the login cookie is not accepted, you paste the job-details token into **Settings** (see below). That token is kept in memory only (`chrome.storage.session`) and is never logged, saved to disk or exported; it is cleared when you close the browser.

No content scripts and no page injection (unlike some other Upwork extensions), no remote code, and the default Manifest V3 content security policy (NFR-09).

## Use

**Check one job.** Paste a job link into the box and press **Enter** or **Check**. The result card shows:
- the verdict as text;
- the findings grouped by source, each with its confidence and its How and Why;
- Low-confidence "weak signals", kept separate;
- the S3 distinctiveness estimate, with how many of your saved clients share each detail.

**Check a batch.** Paste up to 50 links, one per line, and press **Check** or Ctrl+Enter.
- Jobs run one at a time, at least 3 s apart (configurable in Settings, 3–30 s).
- **Stop** ends the batch after the current job.
- Invalid links show as error rows and don't stop the batch.
- The table sorts by any column, and a row opens its card.
- If you close the panel mid-batch, reopening it offers **Resume** from the next unchecked link.
- A warning appears before a batch would take today's total past your daily limit (default 200 jobs).

**History.** Every result is saved, newest first, and is searchable by job ID, title or verdict. You can delete one result there, or export selected or all results as CSV or JSON. Exports contain personal data; the extension warns before writing one.

**Accuracy.** On results for your own past clients, open the card and enter the known person, company or website under "Known client name". The Accuracy tab then reports, per source, how many jobs produced evidence (hit rate) and how much of that evidence matched the name (precision), with counts.

**Settings:**
- **Upwork access token**: if a check fails with E-AUTH or E-SCOPE, the login cookie was not accepted. On upwork.com open a job, then in DevTools → Network find the `jobAuthDetails` request and copy its `authorization` header value after "Bearer "; paste it here. It is kept in memory only and cleared when the browser closes, so paste it again each session;
- delay between jobs;
- attachment analysis on or off (default on: at most 5 files per job, 10 MB each, PDF, DOCX, XLSX, PPTX, JPEG);
- retention period;
- daily limit;
- S3 points and the Narrowable threshold;
- extra websites to ignore and extra legal endings;
- **Delete all data**.

### Errors

| Code | Meaning | What happens |
| --- | --- | --- |
| E-LINK | Not an Upwork job link | That line is skipped |
| E-AUTH | No valid login token | The batch stops. Log in to Upwork in this Chrome profile, then press Retry |
| E-SCOPE | Upwork refused the request with this login | The batch stops |
| E-BLOCKED | Upwork showed a check page | The batch stops. Open upwork.com in a tab, complete it, then Retry |
| E-NOTFOUND | Job removed, private or invite-only | The link is marked and the batch continues |
| E-RATE | HTTP 429, or 3 server errors in a row | The batch pauses 1, 2, 5, then 10 minutes, then stops |
| E-FORMAT | Upwork's data format changed | The batch stops. The extension needs an update |
| E-ATTACH | One attachment could not be analysed | Noted on the card; the job continues |
| E-NETWORK | No connection or a 20 s timeout | Retried once after 10 s, then the link is marked failed |
| E-STORAGE | Results could not be saved | Results stay on screen; export them and delete old ones |

## How data is stored and deleted

| Data | Where | Kept for |
| --- | --- | --- |
| Upwork token | `chrome.storage.session` (memory only) | Until the browser closes |
| Settings, batch queue, daily count | `chrome.storage.local` | Until changed or deleted |
| Results and evidence | IndexedDB in the extension | The retention period (default 30 days), then deleted automatically when the browser starts or the panel opens |
| Attachments | Memory only | Until that job's analysis ends |

The token never appears in results, exports, logs or error messages; an automated test checks this (NFR-08). **Delete all data** in Settings empties IndexedDB, the session storage and local storage, apart from the default settings. Removing the extension deletes everything.

There is no analytics, telemetry or crash reporting.

**Upwork's Terms restrict automated access.** You run this tool on your own account at your own risk. The one-at-a-time pacing, the 3 s minimum delay and the daily limit keep volumes low. There is no background activity: every request comes from a check you started.

Saved results contain personal data about real clients, for example names in reviews. Keep exports private and delete them when done.

## Phase 0: confirm Upwork's details (do this first)

The spec makes Phase 0 a go/no-go gate. You need your logged-in Chrome profile for it.

1. **Links.** Save 30 or more real job links from different places (search, the find-work feed, saved jobs, proposals, emails) to `phase0/raw/links.txt`, one per line.
2. **Captures.** In Chrome, open DevTools → Network and tick **Preserve log**. Open each job page; include jobs with attachments, with reviews, enterprise clients, new clients, and 3 of your past clients' closed jobs. Right-click the request list and choose **Save all as HAR with content**, saving into `phase0/raw/`.
   - These files contain your tokens and cookies. `phase0/raw/` is gitignored; delete it after Phase 0.
3. **Analyse.** Run `npm run phase0:analyze`. It writes `docs/phase0-report.md`, which holds only names, counts, hosts and shapes and is safe to commit. Into `phase0/raw/` (private) it writes:
   - trimmed responses;
   - the company names and review samples;
   - the query Upwork's own page sends.
4. **Fixtures.**
   - Run `npm run phase0:anonymise` to write `test/fixtures/jobs/anonymised-*.json`.
   - Run `npm run phase0:leak-check`.
   - Read each fixture once by eye before committing.
5. **Probe from the extension.** Build with `npm run build:probe`, reload the extension, open **Settings**, scroll to **Phase 0 probe** and run it with 3 job links.
   - It tries each login source in turn (session, the captured page request, then the cookies) and reports which one Upwork accepts, then records the error shapes for an unknown job, no token, a bad token and a misspelled field. Use **Probe field access** to confirm the accepted token reads the buyer stats, jobs and reviews.
   - Requests are 3 s apart. Paste the output into the report.
6. **Update the provisional values** listed in `docs/decisions.md` ("Values Phase 0 must confirm") — in particular put the accepted source first in `TOKEN_COOKIE_NAMES` — then run `npm run ci`.
7. **Gate.** If no login source reads the needed fields, stop and revise the requirements before going further.

## Development

```sh
npm run typecheck   # TypeScript strict
npm run lint        # ESLint, including rules that enforce the spec (below)
npm test            # Vitest, offline
npm run coverage    # with the NFR-13 thresholds (≥ 80% for links, extractors, verdict)
npm run ci          # all three
npm run make:attachments   # writes the synthetic test attachments to test/fixtures/files/
```

The lint rules enforce parts of the spec:
- only `src/upwork/` may call `fetch` or read cookies (NFR-07, NFR-12);
- only `src/verdict/` may set a confidence (FR-24);
- `innerHTML` is banned (NFR-10);
- console output goes through a redacting logger (NFR-08).

### Layout

```
src/links      link parser (FR-01–06)
src/upwork     everything Upwork-specific: token, query, fetch, schema, mapper, attachments, probe
src/extract    pure extractors S1, S2 text, S2 file names, S2 properties, S3, S5; attachment parsers
src/verdict    confidence table, agreement rule, verdict and best evidence — the only place they are set
src/pipeline   one check: fetch, attachments, analysis
src/runner     batch orchestration (runs in the side panel)
src/store      IndexedDB results, settings, queue, daily count, retention, peer counts
src/export     CSV and JSON exports
src/eval       ground-truth matching and the accuracy report
src/panel      Preact side-panel UI
src/background service worker: opens the panel, retention on start
scripts/phase0 HAR analysis, anonymiser, leak check
docs           decisions (spec changes) and the Phase 0 report
```

### Manual checks before v1

These aren't automated:
- 10 live jobs, each showing its card within 5 s;
- a 50-link live batch with one bad link, watching DevTools Network for the spacing and hosts;
- close and reopen the panel mid-batch, then Resume;
- Delete all, then inspect IndexedDB and storage in DevTools;
- keyboard-only use and contrast in light and dark mode (NFR-15);
- ground truth for 20 or more past-client jobs, then the accuracy report.
