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

## Gate

The job-details request works with one cookie token and the required fields are present: **open**. The query is valid; the cookie token tried so far lacks scopes.
