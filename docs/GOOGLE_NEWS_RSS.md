# Google News RSS — current news workflow

2026-11-02 user instruction: use Google RSS, remove AI editor picks, preserve the existing public Site. This replaces the NAVER setup as the active news approach. Google delivery was verified before deleting the NAVER `power-editor-news` application (provider usage 0) and removing all five `NAVER_NEWS_*` runtime settings; deployment applied environment revision 10.

## Content and scope

- Fetch RSS metadata only: original publisher headline, publisher name, date and Google-provided article link. Never fetch full articles, descriptions, images or decode Google's links. No news metadata is sent to an LLM.
- Domestic electricity, KEPCO and overseas electricity queries always run; The original six regions 여수·순천·광양·구례·보성·고흥 are always included alongside any saved operational regions, in batches of five (at most six regional queries). This repairs the previous single-region collection setting. Nationwide coverage is search coverage, not an exhaustive media index.
- Deduplicate URL and normalized headline; similar-headline rules reduce, but do not guarantee removal of every report of one event. Reserve candidates by feed before truncating to 100.
- Show up to five fresh relevant headlines. Reserve at least two explicit local items (except nationwide) and one KEPCO item when available, with overlap permitted. Remaining places use electricity impact and topic diversity rather than filling every place with KEPCO. Never pad quotas with older/unrelated stories; show shortage.
- RSS query region is not article evidence. Only unambiguous bounded geographic names in the headline count as `headline_location`, separately labeled as unreviewed body. Province-only reports do not satisfy a city quota. No generated lesson, translation, summary or editor-pick wording remains on cards.
- Source-level personal-use feeds (including direct KEPCO and prior press RSS) remain in history/config but are omitted from public collection. Public institution feeds continue without AI.

## Cost, cadence and access

- KST 07:00/16:00 workflow retained. A durable CAS reservation permits one collection attempt per edition across requests/isolates. Failure does not enable unlimited retries; same request ID can read back its result. RSS request timeout 6.5 seconds; response size <=750 KB; no redirects, article crawling or automatic retries.
- Browser reload, region changes and more-news reads use the central snapshot. Public browser region settings are local to the device and do not overwrite the shared operational collection preference. Region selection can filter a candidate pool without guaranteeing two local articles exist.
- All news AI is disabled, including formerly permitted official sources. `/api/editorial` returns 410; stored historical memos are preserved but stripped from reads and never rendered. Automation summaries redact all news identities/content and provide no AI candidates.
- The Site is public by explicit user choice. Existing private-only writer assumptions are insufficient: `SITE_PUBLIC_ACCESS=true` requires a server-verified `X-Editor-Updater` service token on operator routes. `EDITOR_UPDATER_TOKEN_SHA256` stores only the digest as a secret. The operator obtains the existing Site service token through `get_site` and sends it only to this exact Site in the platform header and application updater header. No token is created or rotated for this work. If that token later changes, updates fail closed until the digest is deliberately updated.
- Authenticated scheduled maintenance preserves existing event rules and notification hold. Do not invoke `/api/dispatch` or test notifications.

## Rights limitation

Google's feed copyright field expressly limits the feed to personal, noncommercial RSS-reader use. Team/public use has not been confirmed as licensed. The user's instruction to proceed publicly is not Google permission; technical success must not be described as rights clearance. Feed source: https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko .

## Validation

Use synthetic tests for classification, quotas, ambiguous geography, link validation, duplicate handling, no-AI enforcement, public writer authorization and cross-isolate edition limits. `scripts/check-google-rss.mjs` prints only source status/counts and quota counts; it never prints article content. Actual live coverage can be insufficient for the local minimum and must remain honestly labeled.

## Selection correction 2026-11-03 KST

Program-only audit of the current stored six-region pool found three overseas outage headlines among five main articles, including a planned outage; no local articles were available. Topic priority treated every outage as important and a KEPCO mention alone satisfied its floor. The stored operator region was Suncheon only, despite six browser regions.

Main cards now require explicit power-work relevance. Sports, stock tips and ceremonial PR without a concrete scaled deployment are excluded; routine overseas outages and overseas reports lacking substantial system/equipment change cannot enter the main list. Domestic system/policy/equipment changes outrank routine incidents; meaningful large foreign outages and equipment advances remain eligible. KEPCO/local floors apply only to eligible fresh articles. If two incidents already occupy slots, another eligible topic is preferred. The candidate cap now prioritizes useful material before freshness and reserves feeds. AI remains off.

Re-ranking existing stored articles makes no new provider or AI calls. Expanded six-region collection applies at the next authorized 07/16 KST run, with at most one extra regional RSS request versus the incorrect single-region setting. No collection-budget reset or artificial local quota fill occurs.
