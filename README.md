# 전력에디터

전력수급, 지역 날씨와 특보·재난, 전력 뉴스를 모아 보는 개인 제작 웹앱입니다. 안드로이드 Termux 뉴스 수집기가 포함돼 있습니다.

- 운영 사이트 https://power.suncheon-ops.workers.dev/
- 공개 소스 기준 v134
- 운영 원본 커밋 dd178486128d16422a4ff180b3b832de3188754e
- 해당 버전 배포 완료 2026년 11월 7일 18시 47분 KST

한전 공식 서비스가 아니며, 실제 설비 조작이나 보호 기능 변경을 수행하지 않습니다.

## 구성

- frontend — HTML, CSS, JavaScript, PWA 화면
- worker — 공개 데이터 수집, 뉴스 선별, 캐시, API
- android-collector — Termux 설치·실행·중지 스크립트와 Python 수집기
- cloudflare-news-fallback — Google RSS 보조 수집 Worker
- db, drizzle — D1 스키마와 마이그레이션
- scripts — 로컬 실행과 Worker 조립·빌드
- tests — 기존 회귀 검사
- docs — 이전 개발 과정의 기능별 기록. 과거 운영 상태가 포함돼 있으므로 현행 동작은 코드를 기준으로 확인합니다.

## 로컬 실행과 빌드

Node.js가 필요하며 외부 npm 의존 패키지는 없습니다.

```sh
npm run dev
npm run build
npm run validate
```

기존 검사는 필요할 때 npm test로 실행합니다. worker/index.js와 dist는 조립·빌드 산출물이므로 공개본에서 제외했습니다. npm run build로 생성할 수 있습니다.

## 서버 설정

운영 자료를 가져오려면 제공자별 이용 승인, API 키, D1 바인딩과 스키마가 필요합니다. 주요 환경변수는 다음과 같습니다.

- PUBLIC_DATA_SERVICE_KEY, KMA_API_HUB_KEY, VWORLD_API_KEY
- NAVER_NEWS_CLIENT_ID, NAVER_NEWS_CLIENT_SECRET
- MOBILE_NEWS_TOKEN_HASH
- EDITOR_UPDATER_TOKEN_SHA256
- GOOGLE_NEWS_FALLBACK_TOKEN

실제 키와 Termux 연결키는 서버 비밀 설정 또는 별도 기기 설정에 등록합니다. 저장소의 예시·검사용 값은 운영 인증값이 아닙니다. .openai/hosting.json은 원본 Sites 프로젝트의 배포 식별자이며, 다른 환경에 배포할 때는 본인의 프로젝트와 DB를 지정해야 합니다.

## Termux 뉴스 수집

설치와 실행 절차는 android-collector/README.md를 참고하세요. 휴대폰이 서버의 작업을 확인한 뒤 필요한 분류의 RSS 제목·링크를 받아 서버로 보냅니다. 수집 성공 자료는 2시간 재사용하며 실패 시 기존 정상 목록의 원래 수집 시각부터 최대 12시간까지 활용합니다. 안드로이드 절전과 네트워크 상태에 따라 예약 실행이 지연될 수 있습니다.

## 공개 범위

운영 v134 소스의 현재 상태를 별도 공개 저장소로 등록했습니다. 운영 Git 이력, 개인 경로가 포함된 인계 파일, 중복 빌드 산출물과 과거 검수 스크린샷은 공개본에서 제외했습니다. 서버 환경변수, 휴대폰 연결키, 실행 DB와 사용자 데이터는 포함하지 않습니다. 소스 안의 공개 뉴스 스냅샷은 과거 임시 복구용 자료이며 원래 수집 시각과 만료 조건을 따릅니다.

이번 공개 등록에서는 코드에 대한 패턴 검사와 파일 구성을 확인했습니다. 기능 테스트와 새 배포는 수행하지 않았습니다. 라이선스는 별도로 지정하지 않았습니다.
