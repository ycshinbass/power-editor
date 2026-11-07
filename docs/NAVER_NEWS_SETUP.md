# NAVER API HUB news setup — 2026-11-02

Application `power-editor-news` is registered for **News only**. Its saved provider limits are **200 calls/day and 5,000 calls/month**. Both credentials are stored as Sites production secrets (`NAVER_NEWS_CLIENT_ID`, `NAVER_NEWS_CLIENT_SECRET`), never in source or browser assets. The server's additional hard ceilings are **100/day and 3,000/month**, KST. Failed attempts count; duplicate attempt IDs, concurrent calls, storage failures and invalid configuration fail closed. There is no automatic HTTP retry. No new scheduler is created.

**Collection is disabled.** `NAVER_NEWS_ENABLED=false` plus a code-level policy gate prevents all requests, even if someone changes the environment flag. No live API/authentication test has run. No NAVER result is collected, cached, displayed in the curated five, or submitted to AI. Normal refresh, regional changes and repeated browser reads do not invoke NAVER. Existing sources and 07:00/16:00 KST workflow remain unchanged. The API therefore has not expanded current news coverage.

## Rights decision and remaining evidence

- NAVER Cloud's AI·NAVER API terms, article 5(1)/(8), do not transfer result rights and restrict unauthorized storage/processing/distribution or third-party provision: https://www.ncloud.com/policy/terms/opapi
- The current NAVER Developers search-specific terms explicitly restrict altered/reordered search display and AI input/use: https://developers.naver.com/products/terms/
- The Developers agreement is **not assumed automatically identical to the HUB agreement**. The applicable HUB permission for our intended durable candidate storage, deduplication, independent top-five selection and AI processing remains unconfirmed. Registration and technical API availability are not permission for those uses.
- Keep NAVER AI disabled. Before collection is enabled, obtain a documented applicable permission/interpretation for the exact non-AI collection, storage and selection workflow, or agree with the user on a compliant independent search display. Do not silently replace the curated five with unmodified search rankings. Do not fetch publisher full text through another route to bypass a restriction. Do not submit support messages without the user's instruction.

## Cost controls and verification boundary

The console/product page currently shows Search at zero KRW within 775,000 monthly calls and a daily console maximum of 25,000. The provider explicitly warns that its configurable limit can overshoot briefly while taking effect. The independent durable server reservation is required before every attempt, with limits far below that allowance. Never share this application key with another service. No paid upgrade is authorized.

The overview describes the service as temporarily free with notice before paid conversion: https://guide.ncloud-docs.com/docs/apihub-overview . Current pricing: https://www.ncloud.com/product/applicationService/naverApiHub#pricing . A quantity cap cannot guarantee future tariffs; the connector requires a new pricing review after 2026-11-30 KST and remains disabled now.

`GET /api/naver-news/status` returns safe configuration metadata only, protected by the existing owner-private updater boundary. It never returns keys or news. `worker/naver-news.mjs` is a dormant server adapter, not an active collection source. Budget tests use a local SQLite CAS store and synthetic inputs; they do not call NAVER or consume quota.

Before any later activation: resolve HUB result-use rights, review pricing, preserve the AI block, implement the permitted display/retention contract, connect only the bounded scheduled collector, and run one bounded live authentication test after all guards pass. Neither an environment flag nor successful registration completes those steps.

Deployment returned the same project's current origin as `https://power-editor-design-1031.ycshinbass.chatgpt.site`. The private updater and push-origin checks now accept that exact origin and the previous `keenibis32` origin, with no wildcard or cross-origin permission. The private editorial workflow points to the current URL. Existing third-party key registrations were not changed.
