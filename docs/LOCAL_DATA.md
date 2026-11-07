# Official data integration — 2026-11-02

The active integration credentials are stored only in Sites secret environment variables: PUBLIC_DATA_SERVICE_KEY, KMA_API_HUB_KEY, VWORLD_API_KEY. No secret is in this checkout. Owner-only audience is preserved; no notifications or dispatch are part of validation.

## Verified upstream contracts

- KPX current supply: data.go.kr/15158704, resultCode 00. Reference 2026-11-02 08:35 KST. Official supply/capacity/reserve are MW; reserve percentage comes from suppReserveRate. Unit reference: https://www.data.go.kr/data/15099819/fileData.do and https://www.kpx.or.kr/powerinfoSubmain.es?mid=a10404030000 . Capacity, demand, and generation output remain separate.
- KPX generation: data.go.kr/15113384, resultCode 00. YYYYMMDD baseDate was ignored by the live service. Both requests returned the same descending archive page, totalCount 376133. The latest 1000 rows reached 2026-10-29 21:10, covering today's 102 rows and yesterday's 288 rows. The collector now requests one bounded window, proves it reaches previous-day midnight, and filters by actual timestamps. It does not download the full archive or mistake totalCount for the daily count. The nine signed fuel fields reconcile with fuelPwrTot within rounding tolerance for both days. Negative fuelPwr5 values are retained and drawn below zero; total includes them. MW is instantaneous output, not accumulated MWh. Missing/future intervals remain blank.
- KMA ultra-short observations: data.go.kr/15084084, eight categories validated. Region grids and administrative codes come from the official 2610 workbook. Suncheon is (70,70), Gwangyang (73,70). Each observation is explicitly a representative grid, not a region-wide measurement. Old Gwangju/Jeonnam aliases are not silently mapped to the merged administrative unit in the latest workbook.
- AirKorea: data.go.kr/15073861, nationwide observation response 673 stations. Missing timestamps and quality-flagged concentrations remain null. Sido codes are used as returned; city-to-station mapping is not guessed. City selections can report region_unmatched; the UI offers a nationwide station view. All stations are returned in the API; the detail table shows the first 100.
- KMA weather warning: data.go.kr/15000415, today's announcement list. This includes releases/cancellations and is not a count of active warnings. The existing active-warning collector remains separate.
- KMA API Hub earthquake: https://apihub.kma.go.kr/apiList.do?seqApi=7 . eqk_now.php, disp=2; EUC-KR text. The actual format combines occurrence seconds and fraction in one column. Latest domestic/overseas announcement is shown without claiming local damage or counting today's earthquakes.
- VWorld: official administrative GetFeature returned status OK and one district for Suncheon's representative point. Server-side lookup shows its official name/code. Event-area boundary rendering is not implemented and is explicitly labeled incomplete.

## Runtime boundaries

POWER_SUPPLY_CONTRACT_VERIFIED / POWER_GENERATION_CONTRACT_VERIFIED require MW and validated fuel mapping. LOCAL_OFFICIAL_CONTRACT_VERIFIED gates the local collectors. All credential-bearing fetches use fixed HTTPS origins and manual redirects. Shared D1 CAS caching reserves calls before fetching, max 100/day/cache key; weather grid choices are allowlisted. Supply/local refresh interval is 15 minutes; generation 30 minutes. Authentication/restriction failures back off for 24 hours. Errors never echo URLs, keys, or raw provider bodies. D1 stores normalized public observations, never credentials.

GET /api/local-data supports city, regions and parts. Province matching and representative-point observation are distinct. GET /api/power-flow uses the current KST date; historical archive UI is not implemented. Production contains no synthetic data. Existing MET model forecast is separate from KMA observations.

## Validation

Offline regression suite includes signed pumping, archive coverage, quality flags, region mismatches, source timestamps, and no-fetch behavior without shared storage. Actual upstream probe summaries are saved outside the repository in the user's local task directory. Deployment and browser verification are recorded there separately.

Network interruption repair: provider work is registered with Worker waitUntil. Empty abandoned leases expire after 45 seconds while daily usage stays consumed. A cancelled browser request cannot leave a 15/30-minute empty cache.

## 2026-11-02 관심지역 대기질 연결

- 실시간 측정값은 기존 에어코리아 API에서 수신하며, 공식 측정소정보 API `https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList`의 원문 주소로 시·군을 별도 연결한다. 사용 키·권한은 기존 서버 설정만 사용한다. 별도 활용승인이 없으면 오류를 숨기지 않는다.
- 측정소정보는 한 번에 최대 1,000개를 요청하고 `totalCount`와 실제 개수가 같을 때만 완전목록으로 인정한다. 자동 페이지 추가 호출은 하지 않는다. 성공·실패 모두 하루 캐시, 인증 오류도 재시도하지 않는다. 완전목록 주소는 확인 후 7일을 넘으면 지역연결에 사용하지 않는다.
- 전체 API 목록이 불가하면 2026-11-02 확인한 AirKorea 공식 공개 도시대기 목록의 7개 지원 시·군 23개 측정소를 제한적으로 사용한다. 원문 이름·주소는 그대로 보존했다. 출처 https://www.airkorea.or.kr/web/stationInfo?pMENU_NO=93, 공공누리 제3유형(출처표시·변경금지). 페이지 해시 및 확인시각은 `AIR_STATION_FALLBACK`에 기록한다. 이 목록은 비완전하며 30일 후 사용 중단한다. 누락을 측정소 없음·0건으로 해석하지 않는다.
- 현재 시·군 선택 지원은 순천·여수·광양·구례·보성·고흥·나주다. 시·도/전국은 기존 응답 시·도 기준을 유지한다. 원문 이름+시·도+단일 주소가 일치할 때만 연결하고 중복 이름/이름 변경은 추측하지 않는다. `여천동(여수)`와 `여천동`은 임의로 합치지 않는다.
- 여러 관심지역은 지역별 측정소·시각·PM10·PM2.5·상태를 나눠 표시한다. 지역 평균이나 인접 지역 대체값을 만들지 않는다. 공식 목록 부재, 측정자료 미연결, 점검/통신장애/결측, 시각 지연을 구분한다. 주소 확인시각과 실제 측정시각은 별도다.

### 현재 위치 기준 대기질
- 위치는 첫 화면의 `현재 위치 사용` 또는 상세 버튼을 누른 때만 브라우저가 요청한다. 거부/시간 초과/미지원 시 관심지역 표시를 유지하며 반복 팝업을 띄우지 않는다.
- GPS 좌표는 브라우저 메모리에만 보관한다. 서버 요청, 저장소, 로그에 보내지 않고 `watchPosition`을 사용하지 않는다. 화면을 닫거나 상세의 위치 사용 종료 시 해제된다.
- 공식 좌표가 있는 측정소끼리 직선거리로 정렬한다. 가장 가까운 측정소가 결측이면 결측 그대로 표시하고 다음 측정소는 상세에서 확인한다. 좌표 목록이 부분적이면 `좌표 확인 측정소 중 가까운 곳`으로 표시한다.
- 연결된 측정소가 50km 이내에 없으면 첫 화면은 관심지역 자료를 유지한다. 이는 표시 범위이고 오염 영향 범위나 안전 기준이 아니다.
- OpenAPI `getMsrstnList` 기본 명세의 `dmX`는 위도 예시 37.572025, `dmY`는 경도 예시 127.005028이다. 다른 공개 지도 응답의 대문자 `DM_X/DM_Y`와 혼용하지 않는다. 주소 중심점으로 측정소 좌표를 추정하지 않는다.
- 제한 목록 23곳의 좌표는 2026-11-02 AirKorea 첫 화면에서 연결된 공개 응답 `https://www.airkorea.or.kr/web/mRealAirInfoAjax?itemCode=10008`의 원래 좌표를 이름·주소로 대조해 연결했다. 대문자 `DM_X`는 경도, `DM_Y`는 위도다. 별도 공식 지도와 일부 지점에서 차이가 있어 측량 정확도나 최신 물리 위치를 보장하지 않는다. 거리는 근사 직선거리로 표시하고 기기 정확도가 100m를 넘으면 기기가 제공한 오차도 표시한다.

## Retired optional integrations — 2026-11-02
CCTV road weather and historical flood maps have been removed from UI and collectors at the owner’s request. Legacy parts and roadId/flood query parameters return HTTP 410 before provider or storage access; they never fall back to collecting other services. Existing shared credentials and VWorld administrative lookup are unchanged. Historical cache records are left unused; no deletion or cache invalidation is performed. No portal application or server secret was modified.
