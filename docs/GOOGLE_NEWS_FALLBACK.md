# Google RSS fallback — prepared, not yet activated

Latest user agreement (2026-11-06 KST): Sites is the primary collector. Use the separate Cloudflare collector only if primary collection fails AND no matching primary success from the previous 12 hours can be used. This replaces the proposed daily Worker rotation.

## Request flow

1. Visits, reloads and refreshes of a visible page share server snapshots. No unattended Google schedule.
2. A success younger than 2 hours is reused, including a verified empty RSS result. Empty results are not failures.
3. After 2 hours, try Sites first, subject to its existing shared cooldown/lease. On failure, keep the original Sites success for at most 12 hours; do not call the fallback during that grace period.
4. Without usable primary data, call the authenticated Cloudflare fallback. Cache success for 2 hours only, including in browser display caches. After 2 hours, test Sites first again; use fallback only if primary still cannot supply data.
5. Failed requests never become 0 news/success, never renew checkedAt, and never erase or reset either route's cooldown. Retry-After is honored. Simultaneous visitors share category/feed leases.
6. Same rules cover the focused KEPCO/power/outage endpoints AND the older regional/international integrated briefing path.

## Deployment and secrets

- Worker name: `power-editor-news-fallback`.
- Source: `cloudflare-news-fallback/worker.mjs`; Cloudflare configuration: `cloudflare-news-fallback/wrangler.jsonc`.
- Cloudflare secret: `COLLECTOR_TOKEN` (random 32+ character credential, never committed).
- Sites secret: `GOOGLE_NEWS_FALLBACK_TOKEN`, identical value.
- Sites setting: `GOOGLE_NEWS_FALLBACK_URL=https://power-editor-news-fallback.suncheon-ops.workers.dev/rss`.
- Missing or different endpoint/secret leaves fallback disabled. Existing primary collection remains available.
- Worker accepts authenticated POST `/rss` only, targets `https://news.google.com/rss/search` with the approved locales, limits input/output sizes, and follows no redirects. GET `/health` returns configuration presence only. No cron, AI calls, article pages or user private data.
- Durable snapshots and both route cooldowns stay in the existing Sites D1 storage. The new Worker is a transport, not a second independent scheduler/cache database.
- Sites retains its old `google-rss:transport:v1` rejection state. Secondary uses `google-rss:transport:cloudflare-fallback:v1`. Deployment does not clear either.

## Files and verification

- `worker/google-rss-fallback.mjs`: primary/fallback transport selection and age policy.
- `worker/focused-news.mjs`, `worker/feed.mjs`, `worker/runtime.mjs`: per-category/region selection, persistence, on-demand entry points.
- `frontend/app.js`, `frontend/last-good.js`: enforce response `validUntil` and fallback 2-hour display limit.
- `tests/google-fallback.test.mjs`: source precedence, boundaries, simultaneous requests, primary recovery, both failures, authentication, arbitrary URL/redirect rejection, and browser expiration.
- Current implementation is prepared locally; no assertion of live fallback success or deployment. Google may still return a challenge because Sites also uses Cloudflare infrastructure. Independent hostnames do not prove distinct egress IPs.

## Activation check

Configure the Worker, verify health and unauthenticated denial, then connect the exact Sites URL/token and deploy the matching Sites build. Use the public app endpoints once, reporting only status/count/timestamps/path/failure metadata. Do not force/reset a provider cooldown or repeatedly probe after a rejection. Verify a real fallback success before claiming recovery. If it fails, preserve evidence and report the failure; do not rotate networks or dates automatically.
