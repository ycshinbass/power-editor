# 전력에디터 개인 안드로이드 뉴스 수집기 v1

이 프로그램은 Termux에서 실행하는 Python 수집기다. 별도 APK가 아니며 전력에디터 이용자 전체가 설치하는 앱도 아니다. 운영자 휴대폰 한 대에서 실행한다. 현재 노트북에는 Android SDK/JDK가 없어 APK 빌드 대신 실행 가능한 Python 방식으로 제공한다.

## 동작
휴대폰의 Android JobScheduler가 약 1시간마다 짧게 실행 → 서버에 수집 필요 여부 확인 → 최근 1시간에 방문 기록이 있으면 정상 뉴스가 2시간 이상 지난 분류를, 방문 기록이 없으면 20시간 이상 지난 분류를 RSS 수집 → 인증된 HTTPS로 기존 서버에 전달 → 서버가 기존 제목 선별 규칙으로 검증해 공개 화면에 제공한다.

접속자가 없어도 정상 수집 후 20시간부터 보관 만료 전 갱신을 시도한다. 정상자료가 없는 분류도 수집 대상이다. 24시간 만료까지 4시간의 여유를 두지만, 휴대폰 오프라인·절전·수집 실패 시 갱신 성공을 보장하지는 않는다. 작업당 최대 3개 RSS, 정상 수신 후 2시간 재사용, 실패 시 정상자료 최대 24시간 보존. 휴대폰 실패도 2시간 뒤 재검사하며 즉시 반복하지 않는다. 사용자가 새로 접속한 직후에는 다음 휴대폰 작업까지 기다릴 수 있다. 첫 접속 때 즉시 폰을 깨우려면 별도 푸시 체계가 필요하며 이번 버전은 포함하지 않는다. 기존 Sites/Cloudflare 수집 경로도 유지된다.

SMS·위치·연락처·뉴스 본문에 접근하지 않는다. AI 호출이 없고 RSS는 메모리에서 처리 후 버린다. 잠금 파일로 중복 실행 방지, 마지막 상태 파일 한 개만 저장한다. 모바일 데이터를 쓰는 경우 통신요금제의 데이터가 소모된다. 최대 RSS 본문량은 1회 약 2.25MB이며 실제 전송에는 HTTPS 등 추가 트래픽이 있다.

## 설치 (사용자 휴대폰에서 진행)
1. 공식 배포처에서 **Termux와 Termux:API를 동일 배포처 서명으로** 설치한다. F-Droid의 두 앱 사용 권장. 이미 설치한 다른 서명 버전과 혼합하지 않는다.
   - https://f-droid.org/packages/com.termux/
   - https://f-droid.org/packages/com.termux.api/
   - 공식 설치 안내: https://github.com/termux/termux-app#installation
2. 이 폴더의 파일들을 폰으로 옮긴다. 압축을 푼 폴더에서 Termux를 열고 `pkg install python termux-api` 실행. 다운로드 폴더 접근이 필요하면 폰에서 직접 `termux-setup-storage`를 실행하고 표시된 권한을 확인한다.
3. 해당 폴더에서 `bash install.sh`. 별도로 보관된 운영자 연결키를 입력한다. 키는 입력 중 표시되지 않으며 앱 전용 디렉터리의 config.json에 보관된다. 공개 뉴스 화면이나 동료에게 전달하지 않는다.
4. `python ~/.power-editor-collector/collector.py --once` 실행. status가 idle이면 최근 방문/수집 필요가 없는 상태, ok면 Google 수집과 서버 전송 성공이다. http_503이면 이 휴대폰 회선에서도 실패한 것으로 판단한다. 화면 브라우저로 요청하거나 CAPTCHA를 우회하지 않는다.
5. 성공을 확인하면 `bash start.sh` 실행. 중지 `bash stop.sh`. 상태 조회 `cat ~/.power-editor-collector/status.json`. 예약 조회 `termux-job-scheduler --pending`.

재부팅 후 pending과 첫 수집 결과를 확인한다. Android/삼성 절전 정책·강제종료·배터리 부족·오프라인이면 작업이 늦어지거나 실행되지 않을 수 있다. 항상 켜진 폰도 상시 서버와 같은 시간 보장을 하지는 않는다. 실제 Fold4 Android16/OneUI8.0에서 화면 꺼짐·재부팅·Wi-Fi/모바일 전환과 배터리 사용량 검증이 필요하다. 설정 변경은 사용자가 결과를 보고 판단한다. 화면 상시 켜기/무한 루프/상시 wake lock은 사용하지 않는다.

## 서버 및 유지보수
- `/api/mobile-news/claim` 및 `/result`: POST, 운영자 전용 Bearer 키 인증. 키의 SHA256만 서버 비밀 설정 MOBILE_NEWS_TOKEN_HASH에 저장. 키 교체 시 서버 해시 갱신·배포 후 폰 configure 재실행.
- 작업 임대 10분, 분류/만료/중복 검증, XML 최대 750KB, 서버 시각 사용. 임의 URL이나 임의 DB 키 입력 불가.
- 웹 방문은 5분 단위로 모아서 기록한다. 원래 수집시각과 공유 캐시를 유지하며 기존 Google 차단 대기 상태를 초기화하지 않는다.
- 구현/자동시험 완료와 실제 휴대폰 수신 성공은 구분한다. 이 파일 작성 시점에는 폰 설치/연결/절전 시험 미실행.
- 설치 과정에 새 인증 허용/앱 설치가 필요하며 원격으로 실행하지 않았다.

Android 예약 원칙: https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
Termux API 명령 구현: https://github.com/termux/termux-api-package/blob/master/scripts/termux-job-scheduler.in
