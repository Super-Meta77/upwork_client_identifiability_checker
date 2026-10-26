# Upwork Client Identifiability Checker

A Chrome extension that watches your Upwork job search and tells you, for each new posting, whether it **has potential**: whether the client can be identified before any contact, and why.

For each job it reads the job data Upwork already sends to you while you are logged in, and looks for the client's name, company, website or email. The verdict is:

- **Has potential**: a name, website or email was found at Medium or High confidence. The card says which one and where it came from.
- **No potential**: nothing was found at Medium or High confidence. Weaker hints are still listed as "weak signals".

Every finding shows **how** it was found (the field, with surrounding text), **why** Upwork shows it, and its confidence (High, Medium or Low).

The extension contacts only `www.upwork.com` and your own Supabase project, which keeps the history (see [Results database](#results-database)). It never looks anything up elsewhere: no search engines, LinkedIn, company registers or WHOIS.

## Install

Requires Node 22.12+, Chrome 120+ and a Supabase project for the history. Set up the database and `.env.local` first (see [Results database](#results-database)); the build reads them.

```sh
npm ci
npm run build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the `dist/` folder. Click the extension's toolbar icon to open the side panel.

For development, `npm run dev` serves a build that reloads on save. Load `dist/` the same way.

## Permissions and why each is needed

| Permission | Why |
| --- | --- |
| `storage` | Saves your settings, the daily job count, your database sign-in and results waiting to upload (`chrome.storage.local`). Keeps the Upwork token in memory only (`chrome.storage.session`). |
| `sidePanel` | Shows the checker in Chrome's side panel. |
| `scripting` | During a refresh only: types the search into your Upwork search tab's search box, presses Enter, and reads the job links. It runs in the extension's own isolated context and cannot see the page's scripts or tokens. |
| Host access to `https://www.upwork.com/*` | Sends the job-details request and lets the extension use your search tab. |

The Supabase project needs no permission: its API accepts requests from any origin. In code, only `src/store/supabase.ts` may contact it, and only at the `https://<project>.supabase.co` address from `.env.local` (NFR-07).

No cookies are read, no content scripts, no hooks into the page's own scripts, no remote code, and the default Manifest V3 content security policy (NFR-09). Nothing runs on an Upwork page except during a refresh you started (D-31).

## Use

1. **Paste your Upwork token** in **Settings** (once per browser session). On www.upwork.com open a job, then in DevTools → Network find the `jobAuthDetails` request and copy its `authorization` header value after "Bearer ". It is kept in memory only and cleared when the browser closes or when Upwork says it has expired; paste a fresh one then.
2. **Open Upwork's job search** (`www.upwork.com/nx/search/jobs`) in a tab of the same window. Set **Sort by: Most Recent** and any filters you want.
3. On the **Check** tab:
   - **Run** refreshes the list once, now.
   - **Auto-refresh every …** repeats that every interval (default 60 s, at least 30 s) until you untick it or press **Stop watching**.

Each refresh, called a round:
- **Searches again.** Upwork re-runs the search only when the text changes, so each round types one more `/` into the search box (`/`, `//`, `///`, …) and presses Enter. At 50 characters the page is reloaded with `/` instead. If typing doesn't start a search, the round reloads the page with that search; the status line then says "page reloaded".
- **Checks the new jobs.** It reads the job links on the page and checks every job not checked before, one at a time, at least 3 s apart (Settings, 3–30 s). Jobs already in your history are skipped.
- **Lists them.** The table shows every job checked since the panel opened, newest round first. It sorts by any column, and a row opens its card.

Watching stops by itself, and auto-refresh switches off, when:
- today's checks reach the daily limit (default 200);
- Upwork shows a check page, or a check stops on E-AUTH, E-SCOPE, E-FORMAT or lasting E-RATE;
- the tab is closed or leaves the search page.

Keep the side panel open: closing it stops auto-refresh. The search box changes each round, so use a tab you aren't working in.

**History.** Every checked job is saved to your Supabase project, newest first, and is searchable by job ID, title or verdict ("has potential", "no potential"). The list loads 100 results at a time (**Show more** loads the next 100). You can open a result, delete one, or export selected or all results as CSV or JSON. Exports contain personal data; the extension warns before writing one. Failed checks are shown in the table but are not saved.

**Settings:**
- **Results database**: sign in to your Supabase project. Checks start only once you are signed in;
- **Upwork access token** (see above);
- seconds between auto-refreshes, delay between jobs, daily limit;
- extra websites to ignore and extra legal endings (under **Advanced**);
- **Delete all data**.

### Errors

| Code | Meaning | What happens |
| --- | --- | --- |
| E-AUTH | No token, or it expired | Watching stops. Paste a fresh token in Settings, then press Run |
| E-SCOPE | Upwork refused the request with this token | Watching stops. Paste the token from a `jobAuthDetails` request |
| E-BLOCKED | Upwork showed a check page | Watching stops. Complete it in the Upwork tab, then press Run |
| E-NOTFOUND | Job removed, private or invite-only | The job is marked and the round continues |
| E-RATE | HTTP 429, or 3 server errors in a row | Pauses 1, 2, 5, then 10 minutes, then watching stops |
| E-FORMAT | Upwork's data format changed | Watching stops. The extension needs an update |
| E-NETWORK | No connection or a 20 s timeout | Retried once after 10 s, then the job is marked failed |
| E-STORAGE | The results database could not be used (offline, signed out, or a database error) | A result that cannot be uploaded waits in this browser and is sent with the next save; the Check tab shows how many wait, with **Upload now** |

## Results database

The history is kept in your own [Supabase](https://supabase.com) project, in one table, `job_checks`: one row per checked job, holding the job ID, title, check time, verdict and the findings (each with source, kind, value, confidence, where it was found and a snippet; the best one first). The link and the "why" texts are rebuilt when a result is opened, so they are not stored. The structure is in [`supabase/migrations/20261025000000_job_checks.sql`](supabase/migrations/20261025000000_job_checks.sql).

Set it up once:
1. **Create a project** at supabase.com (the free plan is enough: about 1 KB per check). Free projects pause after a week without use; open the dashboard to resume one.
2. **Create the table.** In **SQL Editor**, paste and run the migration file. It creates the table and an access rule that lets each signed-in user see only their own rows.
3. **Create your user.** In **Authentication → Users → Add user**, create the user with an email and password. Then, under **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**, so nobody else can create an account.
4. **Configure the extension.** In **Project Settings → API**, copy the project URL and the `anon` public key into `.env.local` (gitignored) in this folder (`.env.example` shows the format):
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```
   Never use the `service_role` key here: anyone can unpack an extension and read it.
5. **Build and sign in.** Run `npm run build`, reload the extension, and sign in under **Settings → Results database**.

## How data is stored and deleted

| Data | Where | Kept for |
| --- | --- | --- |
| Upwork token | `chrome.storage.session` (memory only) | Until the browser closes, or Upwork says it expired |
| Checked jobs and findings | Your Supabase project, table `job_checks` | Until you delete them (one, or **Delete all data**) |
| Results waiting to upload | `chrome.storage.local` | Until they are uploaded |
| Database sign-in | `chrome.storage.local` | Until you sign out |
| Settings, daily count | `chrome.storage.local` | Until changed or deleted |

The Upwork token never appears in results, the database, exports or error messages, and the extension writes nothing to the console; an automated test checks this (NFR-08). **Delete all data** in Settings deletes your rows in the database, and empties the session storage and local storage apart from the default settings and your database sign-in.

There is no analytics, telemetry or crash reporting.

**Upwork's Terms restrict automated access.** You run this tool on your own account at your own risk. The one-at-a-time pacing, the 3 s minimum delay and the daily limit keep volumes low. There is no background activity: every request comes from Run, or from auto-refresh while you have it on with the panel open. Auto-refresh searches again every round, so keep the interval long and the filters narrow.

Saved results contain personal data about real clients, for example names and review snippets, and they are stored in your Supabase project. Keep the project private, keep exports private, and delete what you no longer need.

## Development

```sh
npm run typecheck   # TypeScript strict
npm run lint        # ESLint, including rules that enforce the spec (below)
npm test            # Vitest, offline
npm run coverage    # with the NFR-13 thresholds (≥ 80% for links, extractors, verdict)
npm run ci          # all three
```

The lint rules enforce parts of the spec:
- only `src/upwork/` may call `fetch`, except `src/store/supabase.ts`, which talks to the history database; nothing reads cookies (NFR-07, NFR-12, D-32, D-33);
- only `src/verdict/` may set a confidence (FR-24);
- `innerHTML` is banned (NFR-10);
- no console output (NFR-08).

### Layout

```
src/links      job links -> job IDs
src/upwork     everything Upwork-specific: token, query, fetch, schema, mapper
src/extract    pure extractors: S1 company field, S2 job text, S2 attachment file names, S5 reviews
src/verdict    confidence table, agreement rule, verdict and best evidence — the only place they are set
src/pipeline   one check: fetch, then analysis
src/runner     checks a round's jobs one at a time (runs in the side panel)
src/watch      search the tab again (type one more "/"), read its job links, check the new ones
src/store      Supabase history (sign-in, rows, outbox), settings, daily count
src/export     CSV and JSON exports
src/panel      Preact side-panel UI
src/background service worker: opens the panel, writes default settings on install
docs           decisions (spec changes)
supabase       the database migration (table, access rule)
```

### Manual checks

These aren't automated:
- Run, then auto-refresh, on a live search tab for three rounds: the search box gains one "/" per round without a page reload, new jobs are checked once, each card opens within 5 s, and Stop watching ends it;
- watch DevTools Network for the spacing between requests and the hosts contacted;
- sign in, check a job, find its row in Supabase's Table Editor; then Delete all, and check the table and DevTools storage are empty;
- keyboard-only use and contrast in light and dark mode (NFR-15).
