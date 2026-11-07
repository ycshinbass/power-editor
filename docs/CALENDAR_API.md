# Annual official calendar metadata

`GET /api/calendar?year=YYYY` augments only the annual calendar. It does not write `/api/events`, revive attention signals, send push, scrape articles, or call AI.

## Contract

- `year`, `yearRange: {min,max}`: current KST year ±1; malformed, repeated or out-of-range years and unexpected query parameters return HTTP 400. Omitted year means current KST year.
- `status`: `ok` if every operation is current, `partial` if any operation has last-good data but another is failed/stale, otherwise `unavailable`.
- `items[]`: `id`, `date` (validated YYYY-MM-DD), `title`, `type`, `types[]`, `sourceIds[]`, `isHoliday`, `source` (`kasi`/`nec`), `publisher`, `sourceUrl`, `checkedAt`.
- `sources[]`: `id`, `publisher`, `sourceUrl`, `status` (`ok`/`stale`/`unavailable`), `checkedAt` (last success or null), `lastAttemptAt`, `nextFetchAt`, optional `failureCode`, `notice`, `refreshing`.
- HTTP 200 can contain unavailable or partial status; never interpret an empty list on failure as “no events”. Dates in the past are retained. Ended display is frontend-derived, not cancellation.

## Official providers

한국천문연구원 [특일 정보](https://www.data.go.kr/data/15012690/openapi.do): `getHoliDeInfo` (national_holiday), `getRestDeInfo` (public_holiday), `getAnniversaryInfo` (commemoration) on `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/`. One annual `solYear` query per operation, no monthly fan-out. Same provider/date/title duplicates merge types/holiday flags, distinct same-day events remain distinct. Weekends alone are not events.

중앙선거관리위원회 [코드 정보](https://www.data.go.kr/data/15000897/openapi.do): `https://apis.data.go.kr/9760000/CommonCodeService/getCommonSgCodeList`; reads `sgVotedate` and `sgName`, not a guessed date from election ID. The documented endpoint has no year filter: collect its complete bounded list once and filter locally. Its cache is shared by all supported years. A 500-record/pagination cap produces `pagination_limit`, not a complete empty calendar. Existing editorial election history stays independently available.

Only the existing server-side `PUBLIC_DATA_SERVICE_KEY` is used (raw or once-percent-encoded accepted). Both requests use documented `ServiceKey` spelling, `pageNo`, `numOfRows=100`. No key is exposed in errors, source URLs, logs, files, or frontend assets. Each API can require separate utilization approval; this change creates no registrations or credentials.

## Bounds and freshness

Existing D1 `editor_snapshots` table, fixed `public:calendar:v1:` keys, compare-and-swap leases (60 seconds). Four operation caches with a shared all-year NEC key; no migrations or client-selectable cache key. Successful data lasts 24 hours; failure retains last good with original `checkedAt`. Auth/HTTP 403/429 failure waits 24 hours, other failures 6 hours before one later normal GET may try again. No immediate retries or force-refresh route. Pending calls coalesce per isolate, leases coalesce across isolates. D1 read/lease failures do not issue provider calls; missing D1 uses process memory only and is not durable.

Each operation allows at most 5 pages / 500 records, 300 KB per response, 12 seconds total; redirects rejected, response result codes validated (KASI `00`, NEC `INFO-00`), XML entities decoded without DTD/entity expansion. Fixed official API endpoints only. Error details are fixed allowlisted codes, never raw provider responses/URLs/exceptions.

## Verification

`node --test tests/calendar.test.mjs` covers XML/JSON, auth errors, missing key, malformed dates, duplicate merging, historical/future filtering, pagination limits, encoded key handling, redirect rejection, durable cache reuse, stale last-good retention, and concurrency. Fixture credentials only; actual utilization approval/provider response must be verified by a normal request to the deployed private Site. Provider API calls were not made during implementation.
