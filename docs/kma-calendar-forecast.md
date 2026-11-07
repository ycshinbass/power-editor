# KMA calendar forecast contract

- Source: [KMA public-data service 15084084](https://www.data.go.kr/data/15084084/openapi.do), official `단기예보조회서비스_API활용가이드_261019.docx` (downloaded 2026-11-02). Official [catalog metadata](https://www.data.go.kr/catalog/15084084/openapi.json) identifies the data.go.kr service base URL; guide request specification identifies `serviceKey`. API Hub examples use a different host/authentication, not this connector.
- Route: `/api/local-data?parts=weatherForecast&city=<one selected registered weather point>`; `PUBLIC_DATA_SERVICE_KEY` and existing `LOCAL_OFFICIAL_CONTRACT_VERIFIED` guard. No new keys or subscriptions.
- Upstream: `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst`, one JSON page up to 2,000 rows / existing 1.5 MB body limit. Truncated pages rejected; no pagination fanout. The 2026 guide extends forecasts beyond three days; only today/tomorrow/day-after KST are displayed.
- Base cycles: 02/05/08/11/14/17/20/23 KST, available after :10. Issue time is `forecastIssuedAt`, never an observation timestamp.
- Only `TMN` / `TMX` establish daily min/max. Missing values remain null, especially today's minimum/maximum in later issues; no extra API calls to recover earlier issues or hourly-TMP extrema substitutions.
- POP: maximum probability among supplied hourly forecasts, not probability of rain at any point in the whole day. WSD: maximum supplied hourly forecast m/s, not observation/gust. PCP: largest hourly bucket, preserving original textual range; never daily sum. Numeric legacy PCP follows guide buckets. Missing/sentinel PCP is not zero.
- Icon: any supplied PTY takes precedence (sleet, snow, rain/shower priority); otherwise nearest-to-noon SKY, requiring PTY presence for all returned hours. Unknown values produce unknown. This icon summarizes a day with possible weather changes, not every hour.
- `partial` is true without all 24 complete hourly categories or daily TMN/TMX. `coverage` exposes first/last hour, hours and complete validHours. Today normally covers remaining forecast hours only.
- Shared D1 cache: 60 minutes per nx/ny. CAS lease prevents duplicate refresh; all forecast grids share 100 calls/KST day including failures. Existing observation quota is separate. Maximum one selected-grid fetch per refresh; no calls when storage/credentials are missing.
- Errors retain last good data with stale/reason; KST rollover retains date identity, fills newly absent day with unknown values. No stale values relabeled as another date.
- Tests use synthetic fixtures only. No production credential read or live authenticated API call was performed for this change. Production response verification remains separate.

## Current weather symbol (2026-11-03 KST)

The header uses the original temperature/humidity/wind observations, with fresh observed PTY rain/snow prioritized. SKY is not in the current-observation feed; same-city hourly SKY/PTY from the existing village forecast is preserved separately (max 72 slots). Only a slot within one hour of now from an issue no older than four hours is eligible, with an explicit 예보 label. Wrong-city, stale, missing or distant-hour data never becomes a current condition; no daily icon is reused. Night symbols use a simple KST 18–06 presentation, not a calculated sunset.

No new provider, key, periodic job or per-view upstream call is added. The forecast cache schema changes to weatherForecast:<nx>:<ny>:hourly-v1 once, so one initial rebuild per requested grid may occur. Existing 60-minute cache and shared service 100/day limit remain, including migration calls. Observation cache keeps its existing key and receives PTY at the normal refresh.
