# Phase 0 report

`npm run phase0:analyze` will add the HAR findings above this section: cookie names, the page's own request, fill rates, size buckets and the attachment host. It never writes token values or client data here.

## Probe run 1 — 2026-10-22

Request probe from the extension, logged in, 3 live jobs (IDs start with `~02`).

| Step | Result | Meaning |
| --- | --- | --- |
| Cookie `oauth2_global_js_token` | Present, 45 characters | The guessed cookie name exists |
| Job details ×3, cookie token | HTTP 200, `data: null`, one error, classification `ExecutionAborted`: "The client or authentication token doesn't have enough oauth2 permissions/scopes to access: [BuyerAssignmentsStats.feedbackCount, BuyerAssignmentsStats.totalAssignments, BuyerAssignmentsStats.totalCharges, BuyerJobs.openJobs, BuyerJobs.postedCount, BuyerWorkHistoryFeedback.comment, BuyerWorkHistoryI…" (cut at 300 characters by the first probe) | **E-SCOPE.** The query parses and validates, but this token may not read the buyer stats, buyer jobs and work-history fields, so Upwork aborts the whole request |
| Unknown job ID | Same scope error | The scope check runs before the job is looked up, so the not-found shape is still unknown |
| No token (cookies only) | HTTP 401, JSON, `data: null` | E-AUTH, as handled |
| Invalid token | HTTP 403, `text/html`, 345 KB page | An invalid token gets an HTML page, not JSON. This changed D-12 (see decisions.md) |
| Misspelled field | HTTP 200, `ValidationError`: "Validation error (FieldUndefined@[jobAuthDetails/buyer/workHistory/contractorInfo/contractorNamee]) …" | E-FORMAT, as handled. It also confirms that every other field in our query exists in Upwork's schema |

### Conclusions

- **The query is right.** `jobAuthDetails(id: $id)` and all the field paths in `src/upwork/query.ts` validate against Upwork's schema. The `~02…` IDs are accepted as variables, though the job lookup itself is not yet confirmed.
- **The cookie token is scope-limited.** It cannot read the fields that S3 (spend, hires, jobs) and S5 (reviews) need. FR-10 / D-27 applies: find the token the job page itself uses.
- **Gate status: open, not failed.** It passes if the page's token is stored in a cookie: then FR-08 still holds and only the cookie name changes. If the token exists only in page memory, FR-10 (a `webRequest` capture) is needed, and that changes NFR-09's permissions.

### Code changes made after this run

- An HTTP 403 HTML page now counts as E-AUTH unless it carries Cloudflare challenge markers (D-12). Before, a stale token stopped the batch with E-BLOCKED instead of falling back to the cookie token.
- E-FORMAT now names the field path from Upwork's "FieldUndefined@[…]" message.
- The real error bodies are saved as `test/fixtures/errors/probe-2026-10-22-*.json`.
- The probe now keeps full error messages and records an HTML page's title and its Cloudflare headers. It also has a **field access** mode that asks for each field group on its own.

### Still to do

1. **Probe field access** with one job link. This shows which field groups the cookie token may read.
2. **HAR capture**, with sensitive data enabled in DevTools, of the job page's own GraphQL requests. This shows which token the page sends for the buyer stats and work history, and whether that token is also stored in a cookie.

## Probe run 2 — 2026-10-23 (field access)

Field-access probe (each buyer field group on its own). Result: **every group REFUSED (scope)**, including the job-post group (`Job.title`, `description`, attachments, questions) — not just buyer fields — classification `ExecutionAborted`, message "doesn't have enough oauth2 permissions/scopes". Two of the eight requests returned a **Cloudflare challenge** (HTTP 403, `cf-mitigated: challenge`, title "Challenge - Upwork") → E-BLOCKED, handled correctly. The unknown-job request also returned the scope refusal, so Upwork's real not-found shape is still unseen.

Conclusion: no cookie, and no token the page auto-fires that a `webRequest` listener could isolate by URL, carried the needed scopes. The job page makes many GraphQL calls and the scoped `jobAuthDetails` request can only be told apart by its POST body (`scripts/phase0/lib.ts` `isJobDetailsRequest`), which `webRequest` can't read.

## Token strategy built after run 2 (D-29 / D-30) — manual entry

FR-10 is built as **manual token entry**, not page capture (an earlier `webRequest` capture was written then reverted). Modelled on the sibling job-watcher extension's "try several tokens" idea, without its risks (no token on disk, no page injection, no `webRequest`, no wider hosts, no unbounded request volume).

- **A check tries an ordered token list** (`src/upwork/token.ts`, `client.ts`): the manually entered token → last token that worked (session) → cookies `UniversalSearchNuxt_vt`, `oauth2v2_token`, `oauth2_global_js_token` (across their paths) → any other token-shaped cookie; `visitor_gql_token` is skipped. E-AUTH **and E-SCOPE** fall through to the next; the first that works is kept for the session. At most 6 tokens per check.
- **The scoped token is pasted in Settings** (`panel/components/SettingsView.tsx`): kept in `chrome.storage.session` (memory), masked, validated as token-shaped, tried first, and cleared automatically when Upwork refuses it. Never logged, saved to disk or exported (NFR-08).
- The request URL carries `?alias=gql-query-get-auth-job-details-v2` and refuses redirects (`redirect: 'error'`); attachment downloads refuse redirects too.
- Settings shows which login source is in use (name only). A check that stops on E-AUTH/E-SCOPE/E-BLOCKED offers **Open a job on Upwork** (to copy a fresh token).
- Manifest unchanged: `storage, cookies, sidePanel` + `www.upwork.com` only.

Trade-off: Upwork access tokens expire (hours), so the paste is per browser session, not once.

## Still to do (Phase 0 close-out)

1. **Confirm a pasted token works.** Copy the bearer from a logged-in `jobAuthDetails` request into Settings, then check one job. If it reads the client fields, the gate passes.
2. **Field-access probe** with that token (now candidate #1), to confirm it reads the buyer stats, jobs and reviews groups.
3. **Unknown-job shape** with a scoped token — the first real not-found response; refine `classify.ts`/fixtures if it differs.
4. **Attachment host** via the attachment probe on one `uri`; add to `ALLOWED_HOSTS` + manifest only if it differs.
5. **HAR + `phase0:analyze`** to learn whether the scoped token is cookie-backed (`cookieNamesForToken`). If it is, reorder `TOKEN_COOKIE_NAMES` and the paste becomes unnecessary.
6. Export ~30 jobs for fixtures, then `phase0:anonymise` and `phase0:leak-check`.

## Gate

The query and field paths are valid, but no automatically available token has the scopes, and Cloudflare intermittently challenges requests. The gate **passes once a pasted token reads the buyer fields** (step 1); until then it is held open.
