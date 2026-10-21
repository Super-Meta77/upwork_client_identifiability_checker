# Decisions

Changes to *Upwork Client Identifiability Checker — Project Requirements* (Oct 21, 2026). Each decision says what it replaces in the PDF. The spec says any change to the data boundary needs a written decision first; none of these changes that boundary.

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
| D-12 | New code **E-BLOCKED**: HTTP 403 with a non-JSON body (a bot-protection page). The batch stops with "Upwork showed a check page. Open upwork.com in a tab, complete it, then press Retry." | A 403 challenge misread as a login problem (E-AUTH) |
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
| D-24 | Retention cleanup runs on browser start and on panel open. There are no timers. | "No background polling" |
| D-25 | `navigator.locks` keeps one runner across all side-panel windows. | Two panels would break "one request in flight" |
| D-26 | Office and EXIF properties are read with a small XML tag reader, not DOMParser, so parsing is pure and runs in tests. | — |
| D-27 | FR-10 (capturing the page's token) is built **only if** Phase 0 shows the cookie token is refused for scope. If so, the panel adds a temporary `webRequest` listener, captures one token, removes the listener, and `webRequest` is added to the manifest and NFR-09. **Not built in this version.** | NFR-09 vs FR-10 |
| D-28 | Batch work is in Phase 1. The Phase 1 gate reads "the S1 extractor ran", found or not. The plan is about 5.5 weeks. | Phase balance; gate wording |

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
| Token cookie name | `src/upwork/config.ts` `TOKEN_COOKIE_NAME` | `oauth2_global_js_token` |
| Query shape and arguments | `src/upwork/query.ts` | `jobAuthDetails(id: $id)` with the spec's fields |
| Job ID variable format | `src/upwork/config.ts` `toQueryId` | the ID with its `~` |
| Attachment host and auth | `config.ts` `ALLOWED_HOSTS`, `ATTACHMENTS_NEED_TOKEN`, manifest | `www.upwork.com`, bearer token + cookies |
| Placeholder company names | `src/extract/lists/placeholders.ts` | common placeholders and shape rules |
| Smallest company-size bucket | `src/extract/lists/company-sizes.ts` | `1`, "individual", "just me"… |
| GraphQL error messages | `src/upwork/classify.ts` patterns, `test/fixtures/errors/` | common GraphQL wording |
| Review field with the freelancer's comment about the client | `src/extract/s5.ts` (both are scanned) | both `feedback` and `feedbackToClient` |
| Extra link path patterns | `src/links/parse.ts` `JOB_PATHS` | the five FR-03 patterns |

## Requirement traceability

| Requirements | Code | Tests |
| --- | --- | --- |
| FR-01–06 | `src/links/parse.ts`, `CheckView` | `src/links/parse.test.ts` (39 cases), `panel.test.tsx` |
| FR-07–09, FR-11 | `src/upwork/token.ts`, `client.ts` | `src/upwork/client.test.ts` |
| FR-12–15 | `src/upwork/*`, `src/runner/runner.ts`, `src/pipeline/check.ts` | `client.test.ts`, `runner.test.ts`, `pipeline.test.ts`, `test/integration.test.ts` |
| FR-16–21 | `src/extract/*` | `extractors.test.ts`, `s2text.test.ts`, `props/parse.test.ts` |
| FR-22 | `src/store/peers.ts`, `ResultCard` | `store.test.ts` |
| FR-23–26 | `src/verdict/*` | `verdict.test.ts`, `pipeline.test.ts` |
| FR-27–30 | `src/panel/*` | `panel.test.tsx`, `runner.test.ts` |
| FR-32–34 | `src/store/*`, `src/export/*`, `HistoryView`, `SettingsView` | `store.test.ts`, `export.test.ts`, `panel.test.tsx` |
| FR-35–36 | `src/eval/*`, `EvalView` | `eval.test.ts`, `panel.test.tsx` |
| NFR-01, 05, 07, 08 | runner, gate, `hosts.ts`, `log.ts` | `test/integration.test.ts`, `core.test.ts` |
| NFR-02 | `src/store/local-state.ts`, `App` | `store.test.ts`, integration test |
| NFR-03, 04 | pipeline, parsers | timing tests in `pipeline.test.ts`, `props/parse.test.ts` |
| NFR-09 | `manifest.config.ts` | manifest review (see README) |
| NFR-10, 12, FR-24 | ESLint rules in `eslint.config.js` | `npm run lint`; `panel.test.tsx` renders hostile text |
| NFR-11 | `src/store/maintenance.ts`, `sw.ts` | `store.test.ts` |
| NFR-13 | `vitest.config.ts` thresholds | `npm run coverage` |
| NFR-06, 14, 15 | panel | manual checklist (README) |
