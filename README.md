# Queuest

> Life is a queue of quests.

개인 프로젝트를 원정(프로젝트) → 스테이지(마일스톤) → 퀘스트(태스크)로 관리하는 macOS 메뉴바 앱입니다.

현재 레포는 `Tauri 2 + React + TypeScript + SQLite` 기반의 로컬 MVP입니다. 앱은 SQLite 인박스를 먼저 열고, 사용자가 프로젝트를 선택하거나 만들 때만 워크스페이스·프로젝트·마일스톤·태스크 그래프를 불러옵니다. 워크스페이스와 프로젝트·마일스톤·태스크 CRUD, 보드 상태 이동은 로컬 SQLite에 즉시 저장되고, 태스크 댓글·캐릭터·프로젝트 장비 설정도 재실행 시 복원할 수 있는 저장 경계를 갖습니다. 메뉴바 팝오버는 포커스와 핀 상태를 반영하며 도구 상태를 확인합니다. 외부 연동은 `@queuest/plugin-contracts`의 버전 있는 프로토콜과 [플러그인 아키텍처](./docs/plugin-architecture.md)를 기준으로 확장합니다.

## 미리보기

macOS 메뉴바에서 Queuest 아이콘을 클릭하면 아이콘 바로 아래에 팝오버가 열립니다. 우클릭 메뉴로 열어도 같은 위치를 사용하며, 화면 좌우 경계를 넘지 않도록 배치합니다.

- 상단의 **할 일 / 프로젝트 / 캐릭터 / 플러그인** 메뉴는 스크롤해도 유지됩니다.
- 캐릭터 이름과 직업은 프로젝트 없이 편집할 수 있습니다. 프로젝트를 연 상태의 캐릭터 화면에서는 해당 프로젝트의 경험치·스킬·장비도 확인합니다.
- 플러그인 화면에서 로컬 도구의 설치·인증 상태를 다시 확인할 수 있습니다. 서비스 커넥터 목록도 표시하지만, 앱 내 연결·권한 설정은 아직 준비 중입니다.
- 420px 창에서는 퀘스트 상태 보드를 세로로 표시합니다. 고정 버튼을 누르면 다른 앱으로 이동해도 창이 유지됩니다.

아래 이미지는 초기 디자인 미리보기로, 현재 화면 전환 메뉴와는 차이가 있습니다.

![Queuest macOS 메뉴바 팝오버 미리보기](./docs/images/queuest-menu-preview.png)

## 구조

```text
apps/desktop              Tauri 셸과 React UI
packages/domain           순수 도메인 모델과 계산 규칙
packages/ports            저장소·에이전트 포트
packages/plugin-contracts 외부 플러그인 manifest·프로토콜·정규화 타입
packages/plugin-sdk       외부 프로세스 플러그인용 JSON 프로토콜 SDK
packages/plugin-manager  플러그인 발견·검증·수명주기·stdio 전송 런타임
packages/plugin-permissions 권한 정규화·승인 브로커·Credential Store 경계
packages/plugin-github   GitHub API 읽기 전용 process connector
packages/plugin-jira     Jira Cloud API 읽기 전용 process connector
packages/plugin-calendar Google Calendar 읽기 전용 process connector
packages/plugin-eventkit 공통 Swift EventKit native helper와 JSONL 경계
packages/plugin-apple-calendar Apple Calendar EventKit 읽기 전용 process connector
packages/plugin-apple-reminders Apple Reminders EventKit 읽기 전용 process connector
packages/adapter-sqlite   Tauri SQL 기반 로컬 SQLite 어댑터
packages/adapter-claude   claude -p 실행 어댑터
packages/adapter-github   기존 GitHub 경계 어댑터 (UI 흐름 전환 예정)
```

## 시작

```bash
npm install
npm run dev
```

Tauri 앱까지 실행하려면 다음을 사용합니다.

```bash
npm run tauri -- dev
```

검증 명령은 다음과 같습니다.

```bash
npm run check
```

기능 구현 순서는 [ROADMAP.md](./ROADMAP.md)에 기록되어 있습니다.

## 범위 메모

- 엔티티 ID는 UUID 문자열을 사용합니다.
- 상태는 `todo → doing → review → done` 네 가지입니다. `blocked`는 플래그입니다.
- XP·레벨·스킬은 저장하지 않고 태스크와 마일스톤에서 계산합니다.
- AI 실행 결과는 `review`로 돌아오며 `done` 처리는 사람의 몫입니다.
- 외부 연동은 플러그인에서 앱으로 가져오는 단방향 흐름부터 둡니다.
- GitHub connector는 `com.queuest.github` plugin namespace와 `connectionId`를 조합한
  Credential Store 항목을 읽고, GitHub REST GET만 수행합니다. UI에서 외부 이슈를 로컬
  Task로 가져오거나 GitHub에 쓰는 흐름은 아직 연결하지 않습니다.
- Jira Cloud connector는 `com.queuest.jira` plugin namespace와 `connectionId`로 Credential
  Store 항목을 읽고, 다음 JSON credential을 사용합니다. `siteUrl`은 `baseUrl`로 대체할 수
  있으며 둘 다 있으면 같은 값이어야 합니다.

  ```json
  {"siteUrl":"https://<tenant>.atlassian.net","email":"account@example.com","apiToken":"<token>"}
  ```

  기본 macOS Keychain namespace는 service
  `com.yoonhogo.queuest.credentials.plugin.com.queuest.jira`, account
  `com.yoonhogo.queuest.credentials.plugin.com.queuest.jira.<connectionId>`입니다. HTTPS
  Atlassian Cloud subdomain(`*.atlassian.net`) origin만 허용하며 path·port·query·fragment·
  userinfo나 임의 host는 거부합니다. manifest의 `network: ["*.atlassian.net"]`와
  `secrets: ["jira"]`를 모두 승인한 뒤에만 credential/API를 사용하고, email과 API token으로
  Basic auth를 구성해 `/rest/api/3/search/jql`(POST)과 `/rest/api/3/myself`(GET)만 호출합니다.
  project JQL과 bounded opaque `nextPageToken` pagination을 사용해 Jira issue를
  `ExternalWorkItem`으로 매핑하며, ADF 또는 문자열 description·labels·updatedAt·status
  category·browse URL을 보존합니다. `health.check`는 초기화·권한만 확인하고 credential/API를
  읽지 않으며, credential/auth/not-found/rate-limit/HTTP/malformed/network 실패는 token을
  노출하지 않는 typed error와 connection state로 전달합니다. UI import와 local Task 저장,
  `externalRef` deduplication, provider write, OAuth/3LO, self-hosted Jira/Data Center 지원은
  아직 연결하지 않습니다.
- Google Calendar connector는 `com.queuest.calendar` plugin namespace와 `connectionId`를
  조합한 Credential Store 항목을 읽고, 다음 JSON credential의 `accessToken`만 사용합니다.

  ```json
  {"accessToken":"<oauth-access-token>"}
  ```

  기본 macOS Keychain namespace는 service
  `com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar`, account
  `com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar.<connectionId>`입니다.
  manifest는 `network: ["www.googleapis.com"]`와 `secrets: ["calendar"]`만 선언하며
  filesystem 권한은 없습니다. 두 권한을 모두 승인한 뒤에만 credential/API를 사용하고,
  고정된 Google Calendar API에서 기간·캘린더별 일정 목록을 GET으로 조회합니다. timed/all-day
  event와 `confirmed`·`tentative`·`cancelled` 상태, 원본 URL·수정 시각을
  `ExternalCalendarEvent`로 매핑하며 `maxResults=2500`과 bounded opaque page cursor를 사용합니다.
  `health.check`는 초기화·권한만 확인하고 credential/API를 읽지 않으며,
  `connection.status`만 credential을 읽어 primary calendar를 확인합니다. credential/auth/
  not-found/rate-limit/HTTP/malformed/network 실패는 token을 노출하지 않는 typed error와
  connection state로 전달합니다. OAuth 동의·authorization code 교환·token refresh와
  `accessToken`을 Credential Store에 넣는 provisioning은 Host/UI 경계이며 이 read-only
  connector에 포함하지 않습니다. 일정 쓰기, UI import, CalendarEvent 저장과 Task 변환도
  아직 연결하지 않습니다.
- Apple EventKit connector는 `com.queuest.apple-calendar`와
  `com.queuest.apple-reminders` 두 개의 process plugin으로 제공됩니다. 각각
  `source.calendar-events` 또는 `source.work-items` capability와
  `macos.eventkit.calendar` 또는 `macos.eventkit.reminders` platform permission만
  선언하며, network·secret·filesystem 권한과 OAuth credential을 요구하지 않습니다.
  Host의 Permission Broker 승인이 process spawn보다 먼저 필요하고, 그 다음에도 macOS의
  EventKit TCC 사용자 승인이 별도로 필요합니다.

  EventKit은 읽기 전용 권한을 제공하지 않으므로 일정과 미리알림 목록을 읽으려면
  macOS 14 이상에서 각각 full access를 허용해야 합니다. Swift helper는
  `requestFullAccessToEvents`/`requestFullAccessToReminders`를 사용하고, 구버전 macOS에서는
  호환용 `requestAccess`로 폴백합니다. TCC 요청은 `tcc.request-access`에서만 수행하며,
  `health.check`는 권한을 자동으로 요청하지 않습니다. 앱과 helper에는
  `NSCalendarsFullAccessUsageDescription`·`NSRemindersFullAccessUsageDescription`가
  포함되고, 샌드박스/하드닝 배포에는 Calendar entitlement와 사용자 승인이 함께 필요합니다.

  native helper는 [packages/plugin-eventkit/native/build.sh](./packages/plugin-eventkit/native/build.sh)가
  EventKit 프레임워크와 usage-description Info.plist를 함께 빌드하고 로컬에서는 ad-hoc
  서명합니다. Tauri bundle은 `Contents/Resources/eventkit/queuest-eventkit`으로 helper를
  포함합니다. 배포용 서명은 앱과 같은 Team ID의 Developer ID identity를 지정해야 합니다.

  ```bash
  npm run build:native --workspace @queuest/plugin-eventkit
  QUEUEST_EVENTKIT_CODESIGN_IDENTITY="Developer ID Application: <name> (<team-id>)" \
    npm run build:native --workspace @queuest/plugin-eventkit
  npm run tauri -- build
  ```

  현재 EventKit plugin은 로컬 EventKit 데이터의 목록 조회와 연결/TCC 상태 확인만
  구현합니다. OAuth 동의·authorization code·refresh token·Keychain provisioning은
  필요하지 않으며, 일정/미리알림 UI, CalendarEvent·Task 저장과 중복 제거, 외부 데이터
  생성·수정·삭제(write)는 아직 Host/UI 범위에 연결하지 않았습니다.
- 커밋·푸시·클라우드 동기화·팀 공유는 이 초기화 범위에 포함하지 않습니다.
