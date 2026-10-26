# Decisions

Changes to *Upwork Client Identifiability Checker — Project Requirements* (Oct 21, 2026). Each decision says what it replaces in the PDF. The spec says any change to the data boundary needs a written decision first; only D-32 (the history in the user's own Supabase project, requested by the user) changes it.

## Spec changes

| ID | Decision | Replaces / fixes |
| --- | --- | --- |
| D-01 | The batch orchestrator runs in the side-panel page. The service worker only opens the panel and runs retention cleanup on browser start. | Architecture diagram. Chrome stops an idle service worker after about 30 s, which would lose the 1–10 minute E-RATE pauses. |
| D-02 | Verdict rule 3 (Partially identified) needs at least one name, website or email finding at **Medium or higher**. Low findings are shown on the card as "Weak signals" and do not change the verdict. | Rule 3 vs the risk table's "Low confidence for single mentions" |
| D-03 | Agreement counts only across different `source` values. S1, S2-text, S2-file, S2-props and S5 are all distinct. A finding is raised **at most one level**, from its starting confidence. A first name matches a full name with the same first word. FR-26 reads "Identified = a High company or full name after agreement". | FR-26 vs the agreement rule |
| D-04 | S2-text websites and legal-ending company names are Medium only when an ownership phrase is within 60 characters ("our website", "we are", "our company", "at X, we", "on behalf of", "founder of", "I work for"…); otherwise Low. | Third-party mentions such as "like rivalbookings.com" |
| D-05 | "we are X": X must start with a capitalised word that is not on the stop list (looking, hiring, excited, US-based…). At most 4 capitalised words plus an optional legal ending are captured. | "We are looking for…" |
| D-06 | Emails stay Medium. Free-mail domains (gmail.com, outlook.com…) are not recorded as websites. | Email → website rule |
| D-07 | New confidence rows: S2-text self-introductions and sign-offs; S2-props Title; EXIF Copyright; S5 full names. Office **Manager** is treated as a person, not a company. | Gaps in the confidence table |
| D-08 | Best-evidence tie-break: confidence, then the spec's source order, then kind (company, full name, website, email, first name), then most mentions, then the earliest finding. A job with only Low findings still names its best Low finding. | Tie-break undefined |
| D-09 | S1 placeholder filter = list + shapes: no letters, 2 characters or fewer, N/A, private, individual, self, freelance… | Placeholder list from 30 responses only |
| D-10 | The schema requires only `opening.job.info.title` and the `buyer` object. Everything else may be null or missing. | FR-14 did not list required fields |
| D-11 | GraphQL `errors[]` are classified **before** schema validation. A permission error on one field gives E-SCOPE, never "no evidence". "Cannot query field" or a validation error gives E-FORMAT. | Errors returned with HTTP 200 |
| D-12 | New code **E-BLOCKED**: HTTP 403 with a Cloudflare challenge page (`cf-mitigated: challenge`, `/cdn-cgi/challenge-platform/`, or a "Just a moment" / "Attention Required" title). The batch stops with "Upwork showed a check page. Open upwork.com in a tab, complete it, then press Retry." Any other 403 is E-AUTH. *Revised 2026-10-22: the Phase 0 probe showed Upwork answers an invalid token with a plain 403 HTML page.* | A 403 challenge misread as a login problem (E-AUTH), and vice versa |
| D-13 | FR-12 reads "one job-details request per attempt, at most two attempts". Every Upwork request, attachments included, passes one serial gate (`src/upwork/gate.ts`). | FR-12 vs the E-NETWORK and FR-10 retries |
| D-14 | Attachment downloads happen in `src/upwork/`; the parsers only receive bytes. | NFR-12 vs the diagram |
| D-15 | Attachment hardening: the type comes from the file's first bytes; the 10 MB cap is enforced while downloading; **fflate replaces JSZip**, with a small central-directory reader that unpacks only `docProps/*` and stops any entry past 1 MB; pdf-lib with `ignoreEncryption`, and encrypted PDFs give E-ATTACH; 3 s parse timeout. | Zip bombs, untrusted `.length`, encrypted PDFs |
| D-16 | CSV cells that start with `= + - @`, a tab or a carriage return get a leading `'`. | Client-written text running as formulas in spreadsheets |
| D-17 | Links on `upwork.com` without `www`, and `http://` links, are accepted and normalised. IDs are lowercased. The `~01` prefix is not assumed (`~02…` IDs exist). | FR-04 strictness |
| D-18 | A re-check overwrites the saved result (key = job ID) but keeps its ground truth. | Undefined |
| D-19 | `groundTruth = { personName?, companyName?, website?, matchedEvidenceIds }`. The CSV column `ground_truth_name` holds the company name, else the person name. | One `name` cannot score every evidence kind |
| D-20 | `companyId` is used only for FR-22 peer counts. Findings are never pooled across a client's jobs. | Undefined |
| D-21 | FR-35 and FR-36 are **Must**, because the Definition of done needs the evaluation report. FR-22 is in v1 because S3 calibration needs it. | DoD vs priorities |
| D-22 | S3 calibration target (Phase 4): set the Narrowable threshold so that 20% or fewer of saved jobs without name findings qualify (80th percentile). The card shows peer counts next to the score. | The score counts which details are present, not how rare they are |
| D-23 | New stored data in `chrome.storage.local`: the batch queue (job links and the next index) and the daily job count (local calendar day). Neither holds personal data. | Missing from the Storage table |
| D-24 | Retention cleanup runs on browser start and on panel open. There are no timers. **Superseded by D-32 (2026-10-26): the history is kept until the user deletes it, so there is no retention cleanup.** | "No background polling" |
| D-25 | `navigator.locks` keeps one runner across all side-panel windows. | Two panels would break "one request in flight" |
| D-26 | Office and EXIF properties are read with a small XML tag reader, not DOMParser, so parsing is pure and runs in tests. | — |
| D-27 | FR-10 (capturing the page's token) is built **only if** Phase 0 shows the cookie token is refused for scope. If so, the panel adds a temporary `webRequest` listener, captures one token, removes the listener, and `webRequest` is added to the manifest and NFR-09. **Not built in this version.** | NFR-09 vs FR-10 |
| D-28 | Batch work is in Phase 1. The Phase 1 gate reads "the S1 extractor ran", found or not. The plan is about 5.5 weeks. | Phase balance; gate wording |
| D-29 | **A check tries an ordered list of login tokens, not one cookie.** Order: the manually entered token (D-30), the last token that worked (session), then the login cookies `UniversalSearchNuxt_vt`, `oauth2v2_token`, `oauth2_global_js_token` (across the paths they are set on), then any other token-shaped (`oauth2v2_`/`eyJ`) cookie, skipping `visitor_gql_token`. A token refused for login (E-AUTH) **or scope (E-SCOPE)** falls through to the next; any other error stops the check. At most `MAX_TOKEN_ATTEMPTS` (6) tokens per check; the first that works is kept for the session. The request URL gains `?alias=gql-query-get-auth-job-details-v2` and refuses redirects. | Phase 0 2026-10-22/23: every cookie **and** the auto-captured token were scope-limited. Replaces the single-cookie FR-08 lookup and the "stop on E-SCOPE" path in `client.ts`. |
| D-30 | **FR-10 is built as manual token entry, not page capture.** Phase 0 run 2 (2026-10-23) showed no cookie, and no token the page auto-fires, had the needed scopes from a `webRequest` capture (the job page makes many GraphQL calls; the scoped `jobAuthDetails` one can't be isolated by URL alone). So the user pastes the bearer token from a logged-in `jobAuthDetails` request into **Settings**; it is kept in `chrome.storage.session` (memory), tried first, never logged/saved/exported (NFR-08), and cleared automatically when Upwork refuses it. **No `webRequest`, no content script, no page injection, no host widening** — the manifest stays at `storage, cookies, sidePanel` + `www.upwork.com`. Trade-off: Upwork tokens expire (hours), so the paste must be repeated per session; auto-capture was rejected (chosen 2026-10-23) because it could not reliably grab the scoped token. | Supersedes D-27 and the earlier (reverted) `webRequest` capture; NFR-09 vs FR-10. |
| D-31 | **Watch mode: the panel refreshes the user's Upwork job-search tab and checks new jobs** (requested 2026-10-25, revised 2026-10-26). On the Check tab, **Run** does one round now and **Auto-refresh** repeats rounds every `watchIntervalSeconds` (default 60, minimum 30); Run during the wait starts the next round early. A round: (1) types one more "/" than the current search into the page's search box (`[data-test~="SearchForm"] input[type="search"]`) and presses Enter, because Upwork re-runs the search only when the text changes; at 50 characters, or when typing does not start a search within 5 s, it loads the same search by reloading the tab (q=…, page 1, other filters and sort kept); (2) reads the job links (`readSearchPage`); (3) checks every job not met this panel session and not already in the history, through the normal `BatchRunner`, so FR-12/13, NFR-01/02/05 and saving are unchanged. Both page functions run with `chrome.scripting.executeScript` in the isolated world, only during a round. Watching stops, and auto-refresh switches off, on Stop, at the daily limit (no confirm dialog, since nobody is there to answer), on a Cloudflare page or a stopping error, or when the tab closes or leaves the search page. It runs in the side panel (D-01) and holds the D-25 runner lock for each run. **Adds the `scripting` permission**; no content script, no web-accessible resource, no MAIN-world injection, no `webRequest`. **Data boundary unchanged:** the page is only used to run the user's own search and read job links. | NFR-09 permission list; D-24 "no timers" and D-30 "no page injection" for this user-started mode; FR-01 (links can come from the search tab as well as from pasting). |
| D-32 | **The history is kept in the user's own Supabase project, not in the browser** (requested 2026-10-26). One table, `job_checks` (`supabase/migrations/`), one row per user and job, holding only what the panel shows or uses: job ID, title, check time, verdict, best value, S3 score and details, the client's company ID, country, city, industry, size and member-since year (FR-22), the findings (source, kind, value, confidence, `raised_from` when agreement raised it, location, snippet, mentions; best first) and the known client name (FR-35). **Not stored:** failed checks, the job URL, finding IDs, reason and rule IDs, the S3 attribute list, matched-evidence IDs (worked out again on load, which also fixes the stale count after a re-check) and attachment notes. A re-check overwrites the row but keeps the known name (D-18). Peer counts are counted in the database (`peer_counts`). The history list loads 100 rows at a time and searches in the database. **Access:** email/password sign-in (Supabase Auth, public sign-ups off); row-level security lets each user read and write only their own rows, so the public anon key built into the extension reads nothing alone; the service-role key is never used. The sign-in session is kept in `chrome.storage.local`. Only `src/store/supabase.ts` calls the database, only at the `https://<project>.supabase.co` from `.env.local`, without supabase-js. **Offline:** a result that cannot be uploaded waits in a local outbox and goes with the next save or **Upload now**. **Kept forever** until the user deletes it (one row, or Delete all), so retention (D-24, NFR-11) is removed. Results from earlier versions are uploaded once after the first sign-in, then the old IndexedDB is deleted. The Upwork token never reaches the database (NFR-08). | **Changes the data boundary:** client names and review snippets now leave the browser for the user's own database. NFR-07 (a second host), NFR-11 (retention), FR-32 (storage), D-24. |

## Confidence table

`src/verdict/rules.ts` is the only code that assigns confidence (FR-24, enforced by ESLint).

| Rule | Source | Finding | Kind | Confidence |
| --- | --- | --- | --- | --- |
| C-S1 | S1 | Company field, not a placeholder | company_name | High |
| C-S2T-CO | S2-text | "we are X", or a legal-ending name with an ownership phrase | company_name | Medium |
| C-S2T-CO-NC | S2-text | Legal-ending name without an ownership phrase | company_name | Low |
| C-S2T-WEB | S2-text | Website with an ownership phrase | website | Medium |
| C-S2T-WEB-NC | S2-text | Website without an ownership phrase | website | Low |
| C-S2T-EMAIL | S2-text | Email (and its domain as a website, unless free mail) | email / website | Medium |
| C-S2T-PERSON | S2-text | "My name is", "I'm" + a known first name, or a sign-off: 2+ words / 1 word | full / first name | Medium / Low |
| C-S2P-CO | S2-props | Office Company | company_name | Medium |
| C-S2P-PERSON | S2-props | Author, creator, lastModifiedBy, Manager or EXIF Artist: 2+ words or legal ending / 1 word | full name or company / first name | Medium / Low |
| C-S2P-COPY | S2-props | EXIF Copyright, cleaned: same split as above | company or person | Medium / Low |
| C-S2P-TITLE | S2-props | Website, email or company name inside a PDF or Office title | any | Low |
| C-S2F | S2-file | File name contains a website or an unusual capitalised word | website / company_name | Low |
| C-S5-FIRST | S5 | First name in 2+ reviews / 1 review | person_first_name | Medium / Low |
| C-S5-FULL | S5 | Full name in 2+ reviews / 1 review | person_full_name | Medium / Low |

**Verdict, first match wins:**
1. error;
2. identified: a High company_name or person_full_name;
3. partial: a Medium or higher name, website or email finding;
4. narrowable: S3 score ≥ threshold (default 70);
5. not_identifiable.

## Values Phase 0 must confirm

Each value below is a guess until `docs/phase0-report.md` says otherwise. Update this table and the code together.

| Value | Where | Current guess |
| --- | --- | --- |
| Which login token works | `src/upwork/config.ts` `TOKEN_COOKIE_NAMES` order; manual entry (D-30) | **Probe 2026-10-22/23: every cookie and the auto-captured token lack the scopes for buyer stats, jobs, work history — even `Job.title` (E-SCOPE); 2 requests also hit a Cloudflare challenge (E-BLOCKED).** D-30: the user pastes the scoped token from a `jobAuthDetails` request. Confirm it reads everything with the field-access probe; a HAR still needed to learn whether that token is cookie-backed (then it could be read automatically) |
| Query shape and arguments | `src/upwork/query.ts` | **Confirmed by probe 2026-10-22:** `jobAuthDetails(id: $id)` and all field paths validate. Request URL now carries `?alias=gql-query-get-auth-job-details-v2` (D-29) |
| Job ID variable format | `src/upwork/config.ts` `toQueryId` | The ID with its `~`. It is accepted as a variable; the lookup is not yet confirmed |
| Attachment host and auth | `config.ts` `ALLOWED_HOSTS`, `ATTACHMENTS_NEED_TOKEN`, manifest | `www.upwork.com`, bearer token + cookies |
| Placeholder company names | `src/extract/lists/placeholders.ts` | common placeholders and shape rules |
| Smallest company-size bucket | `src/extract/lists/company-sizes.ts` | `1`, "individual", "just me"… |
| GraphQL error messages | `src/upwork/classify.ts` patterns, `test/fixtures/errors/` | common GraphQL wording |
| Review field with the freelancer's comment about the client | `src/extract/s5.ts` (both are scanned) | both `feedback` and `feedbackToClient` |
| Extra link path patterns | `src/links/parse.ts` `JOB_PATHS` | the five FR-03 patterns |
| Search page path, search-box selector and job-tile links (D-31) | `src/watch/search-page.ts`, `page-scan.ts` | `/nx/search/jobs`; the box is `[data-test="SearchBar SearchForm"] input[type="search"]` (from the live page, 2026-10-26); typing + Enter runs the search; job tiles link to `/jobs/…_~ID` |

## Requirement traceability

| Requirements | Code | Tests |
| --- | --- | --- |
| FR-01–06 | `src/links/parse.ts`, `CheckView` | `src/links/parse.test.ts` (39 cases), `panel.test.tsx` |
| FR-07–09, FR-11 | `src/upwork/token.ts`, `client.ts` | `src/upwork/client.test.ts`, `token.test.ts` |
| FR-10 (D-29, D-30) | `src/upwork/token.ts`, `client.ts`, `panel/components/SettingsView.tsx` | `client.test.ts`, `token.test.ts` |
| FR-12–15 | `src/upwork/*`, `src/runner/runner.ts`, `src/pipeline/check.ts` | `client.test.ts`, `runner.test.ts`, `pipeline.test.ts`, `test/integration.test.ts` |
| FR-16–21 | `src/extract/*` | `extractors.test.ts`, `s2text.test.ts`, `props/parse.test.ts` |
| FR-22 | `peer_counts` (supabase/migrations), `src/store/checks.ts`, `ResultCard` | `checks.test.ts`, `panel.test.tsx` (the SQL itself is not run in CI) |
| FR-23–26 | `src/verdict/*` | `verdict.test.ts`, `pipeline.test.ts` |
| FR-27–30 | `src/panel/*` | `panel.test.tsx`, `runner.test.ts` |
| FR-32–34 | `src/store/*`, `src/export/*`, `HistoryView`, `SettingsView`, `DatabaseView` | `checks.test.ts`, `supabase.test.ts`, `store.test.ts`, `export.test.ts`, `panel.test.tsx` |
| FR-35–36 | `src/eval/*`, `EvalView` | `eval.test.ts`, `panel.test.tsx` |
| Watch mode (D-31) | `src/watch/*`, `WatchView`, `App` | `watcher.test.ts`, `tabs.test.ts`, `page-scan.test.ts`, `search-page.test.ts`, `panel.test.tsx` |
| NFR-01, 05, 07, 08 | runner, gate, `hosts.ts`, `log.ts` | `test/integration.test.ts`, `core.test.ts` |
| NFR-02 | `src/store/local-state.ts`, `App` | `store.test.ts`, integration test |
| NFR-03, 04 | pipeline, parsers | timing tests in `pipeline.test.ts`, `props/parse.test.ts` |
| NFR-09 | `manifest.config.ts` (storage, cookies, sidePanel, scripting (D-31); host `www.upwork.com` only; the Supabase API needs no permission, D-32) | manifest review (see README) |
| NFR-10, 12, FR-24 | ESLint rules in `eslint.config.js` | `npm run lint`; `panel.test.tsx` renders hostile text |
| NFR-11 | Removed by D-32: the history is kept until the user deletes it | — |
| NFR-13 | `vitest.config.ts` thresholds | `npm run coverage` |
| NFR-06, 14, 15 | panel | manual checklist (README) |
