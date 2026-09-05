# Admin Cloudflare usage dashboard

Route: `/usage`; endpoint: `GET /api/admin/cloudflare-usage`.

Both the navigation and page require an admin account. The endpoint independently checks the authenticated principal and returns 401/403 before any analytics requests. Responses use `Cache-Control: no-store`.

## Setup

- `CLOUDFLARE_ACCOUNT_ID`: account ID in `wrangler.jsonc` (preserved with `--keep-vars`).
- `CLOUDFLARE_USAGE_API_TOKEN`: optional Worker Secret, with **Account → Account Analytics → Read**, scoped only to the configured account. Never put the token in a `VITE_` variable, source code, or chat transcript. It is deliberately not a required deployment secret, so an unconfigured dashboard does not break the existing application.
- Create the token in Cloudflare, then use Worker Settings → Variables and Secrets or `npx wrangler secret put CLOUDFLARE_USAGE_API_TOKEN` to enter it privately.
- A missing/invalid account ID or missing token displays setup instructions; it does not display zero consumption.

## Semantics and overhead

The page compares account-wide Workers requests and D1 rows read/written against **Workers Free daily limits**, with seven UTC dates including today. Limits reset at 00:00 UTC / 08:00 China time. D1 storage is the sum of each database's reported daily maximum, not a real-time inventory or GB-month billing measurement. Missing storage reports show unavailable rather than zero. The query rejects potentially truncated storage results.

The current plan, subscription renewal date and invoice amount are not connected. Exceeding a free daily baseline does not prove a paid-plan overage. Workers analytics may involve sampling and differ from billing. Other Cloudflare services and OpenRouter are outside this dashboard. Links point to Cloudflare billing and official pricing.

Three independent, read-only Analytics GraphQL requests run on demand, with 15-second timeouts and no retries. Completed snapshots (including failures) are cached for five minutes per Worker isolate. UTC rollover and credential changes invalidate the cache. In-flight I/O promises are not shared across requests. The browser has no polling timer, guards duplicate clicks, and aborts requests when leaving the page. No D1 usage-history table, scheduled job, or database scan is introduced. Cache is best effort across isolates; it is not an account-global rate limiter.

## Verification (2026-09-04)

- `node scripts/test-cloudflare-usage.mjs`: quota thresholds, UTC date boundary, missing/invalid data, partial GraphQL failures, 429, cache, token redaction and serialized endpoint authentication.
- `node scripts/test-cloudflare-usage-ui.mjs` with Playwright runtime: actual component at desktop/mobile widths, over-limit/setup/error states, no polling, non-admin guard. Screenshots in `artifacts/cloudflare-usage-*.png` contain **fixture data**, not billing evidence.
- `npm run build` and subsequent `npx tsc --noEmit`: pass. Run build after standalone route generation to regenerate TanStack Start's route type augmentation.
- Actual server collector verified against Cloudflare via the locally authorized Wrangler OAuth session, without saving that OAuth credential into the Worker: Workers and both D1 datasets returned successfully; two databases reported storage. Production still needs a separate read-only token.
- Deployed version: `4943d617-3c0e-4b8b-bbe4-e7ab267b7395`. Live admin page displays the setup state; unauthenticated API returns 401.

## Official sources

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/observability/metrics-analytics/
- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
- https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/
