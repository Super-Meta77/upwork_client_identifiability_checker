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

## Token strategy built after probe run 1 (2026-10-23, D-29 / D-30)

The scope refusal above is the FR-10 condition D-27 set, so FR-10 is now built, following the sibling job-watcher extension's approach but without its risks (no token on disk, no page injection, no unbounded request volume).

- **A check tries an ordered list of tokens, not one cookie** (`src/upwork/token.ts`, `client.ts`): last token that worked → token captured from the page's own request → cookies `UniversalSearchNuxt_vt`, `oauth2v2_token`, `oauth2_global_js_token` (across their paths) → any other token-shaped `*.upwork.com` cookie; `visitor_gql_token` is skipped. E-AUTH **and E-SCOPE** fall through to the next token; the first that works is kept for the session. At most 6 tokens per check.
- **The page token is captured read-only** (`src/upwork/capture.ts`, registered in `background/sw.ts`): a `webRequest.onSendHeaders` listener reads the bearer of GraphQL requests the Upwork page itself makes. It is kept in session memory, never logged or written to disk.
- The request URL now carries `?alias=gql-query-get-auth-job-details-v2` and refuses redirects (`redirect: 'error'`); attachment downloads refuse redirects too.
- Settings shows which login source is in use (name only). A check that stops on E-AUTH/E-SCOPE/E-BLOCKED offers **Open a job on Upwork**.

### Manual step still required (the build does not yet carry the new permissions)

`manifest.config.ts` must gain `webRequest` and host `https://*.upwork.com/*`. An automated-safety check blocked this one edit, so apply it by hand:

```ts
permissions: ['storage', 'cookies', 'sidePanel', 'webRequest'],
host_permissions: ['https://www.upwork.com/*', 'https://*.upwork.com/*'],
```

Until then `registerTokenCapture()` safely no-ops (it guards on `chrome.webRequest`), so the capture source is simply unavailable and only the cookie/session tokens are tried.

## Still to do (Phase 0 close-out)

1. **Run the probe (v2)** from a probe build, logged in: it now tries every login source and reports which one Upwork accepts. Put that source first in `TOKEN_COOKIE_NAMES` if it is a cookie.
2. **Field-access probe** with the accepted token, to confirm it reads the buyer stats, jobs and reviews groups.
3. **Unknown-job shape**: with an accepted token the probe finally sees the real not-found response; refine `classify.ts`/fixtures if it differs.
4. **Attachment host**: use the attachment probe on one `uri`; add the host to `ALLOWED_HOSTS` and the manifest only if it differs.
5. Export ~30 jobs for fixtures, then `phase0:anonymise` and `phase0:leak-check`.

## Gate

The job-details request works with one cookie token and the required fields are present: **open**. The query is valid; the cookie token tried so far lacks scopes, so the captured page token (D-30) now supplies them.
