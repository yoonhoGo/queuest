# Queuest 플러그인 아키텍처

## 목표

Queuest는 앞으로 추가될 외부 연동을 앱 본체의 구현과 분리한다.
GitHub·Jira·Google Calendar·Apple EventKit은 첫 번째 플러그인이며, 향후 어떤 제공자도
같은 Host 계약으로 설치·활성화·비활성화·업데이트·삭제할 수 있어야 한다.

플러그인은 Queuest의 React 화면, SQLite, 내부 도메인 타입을 직접 가져오지 않는다.
Queuest Host와 플러그인 사이에는 버전이 있는 JSON 기반 프로토콜만 둔다.

## 실행 모델

```text
Queuest Host
├── Plugin Manager       manifest 검증, 설치, 수명주기
├── Permission Broker    manifest 권한과 사용자 승인 관리
├── Credential Store     Keychain 연결과 토큰 보관
├── Data Mapper          외부 레코드 → Queuest 도메인 변환
└── Plugin Process       stdio JSON 프로토콜로 실행
    ├── GitHub API
    ├── Jira API
    ├── Google Calendar API
    ├── Apple Calendar adapter
    ├── Apple Reminders adapter
    └── Swift EventKit helper (nested signed native process)
```

현재 계약은 `@queuest/plugin-contracts`에 있다. 첫 버전은 프로세스 플러그인을
대상으로 하지만, 계약 자체는 특정 언어·런타임에 종속되지 않는다.

최소 수직 슬라이스의 Host 런타임은 `@queuest/plugin-manager`와
`@queuest/plugin-permissions`에 있다. `PluginManager`는 설정된 내장·사용자 플러그인
루트(또는 명시된 패키지 디렉터리)를 발견하고, 각 `manifest.json`을
`parsePluginManifest`로 검증한 뒤 Host API 호환 여부와 수명주기 상태를 제공한다.
`PluginTransport`는 활성화된 process entry를 플러그인 디렉터리를 기준으로 실행하고,
`JsonPluginStateStore`는 활성화 메타데이터만 원자적으로 저장한다. 설치·삭제는 이
단계에서 디렉터리를 복사하거나 지우지 않고 reversible state flag만 변경한다.

`PermissionBroker`는 manifest의 network domain, named secret, filesystem path/access
요청을 정규화하고, 현재 requested/granted/missing 상태를 계산한다. 기본 동작은
자동 승인이 아니며, `PluginManager.activatePlugin`은 permissioned manifest의 누락 또는
새 권한을 명시적으로 선택 승인하기 전에는 typed approval-required error를 반환하고
프로세스를 spawn하지 않는다. `inspectPluginPermissions`,
`approvePluginPermissions`, `revokePluginPermissions`와 `getApprovedPluginPermissions`로
Host가 승인 상태를 확인·변경할 수 있고, `initialize.grantedPermissions`에는 현재
manifest 요청과 승인된 권한의 교집합만 전달한다. 권한을 선언하지 않는 기존 manifest는
기존 `grantedPermissions` 옵션을 유지해 기존 public API와 mock 동작을 보존한다.

승인 상태는 `MemoryPermissionApprovalStore` 또는 알 수 없는 문서 필드를 보존하는
원자적 JSON 저장소를 사용할 수 있다. Credential 경계에는 테스트용
`MemoryCredentialStore`와 실제 macOS `security` 명령을 execFile 스타일 인자 배열로
호출하는 `MacOSKeychainCredentialStore`가 있다. Keychain service/account는 plugin
namespace로 분리하고 set/get/delete와 missing-item 오류를 제공하며, command 오류와
로그는 secret 값을 보존하거나 노출하지 않는다. 이 adapter는 구현되어 있으며,
첫 실제 구현인 `@queuest/plugin-github`가 이 경계를 사용해 GitHub REST 읽기 흐름까지
연결한다. `@queuest/plugin-jira`도 같은 경계를 사용해 Atlassian Cloud REST 읽기 흐름과
process E2E까지 연결했고, `@queuest/plugin-calendar`도 Google Calendar REST 읽기 흐름과
process E2E까지 연결했다. Apple EventKit은 `@queuest/plugin-eventkit`의 공통 JSONL
client와 Swift helper 아래에 `@queuest/plugin-apple-calendar`·
`@queuest/plugin-apple-reminders`를 두며, native process 수명주기와 deterministic no-TCC
process E2E까지 연결했다. 승인·설정 UI 연결은 아직 남아 있다.

별도 프로세스는 격리의 경계이지 완전한 보안 샌드박스가 아니다. Connector 플러그인은
manifest에 선언하고 승인받은 네트워크·secret 권한과 Credential Store adapter를 통해서만
외부 API와 credential을 사용하도록 구현한다. Permission Broker는 manifest 권한에 대한
Host 정책 경계이며, OS-level network/filesystem sandbox를 구현하지는 않는다. 강한
권한이 필요한 플러그인은 Trusted 플러그인으로 분류하고 설치 시 별도 신뢰 확인을
거친다.

## Capability

하나의 거대한 플러그인 인터페이스 대신 기능별 capability를 사용한다.

| Capability | 의미 | 첫 구현 |
| --- | --- | --- |
| `source.work-items` | 외부 작업 항목을 페이지 단위로 조회 | GitHub (`@queuest/plugin-github`), Jira, Apple Reminders |
| `source.calendar-events` | 기간·캘린더 기준으로 일정 조회 | Google Calendar (`@queuest/plugin-calendar`), Apple Calendar |
| `agent.runner` | 태스크를 실행하고 취소 | AI 단계에서 추가 |

GitHub와 Jira의 결과는 외부 작업 항목으로 반환한 뒤 Host가 Task로 변환한다.
Calendar 일정은 Task와 의미가 다르므로 `CalendarEvent`로 별도 저장하고, 사용자가
명시적으로 선택할 때만 Task로 변환한다.

## Manifest

플러그인 패키지의 진입점에는 `manifest.json`이 있어야 한다.

```json
{
  "schemaVersion": 1,
  "id": "com.queuest.github",
  "name": "GitHub",
  "version": "0.1.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "node",
    "args": ["--experimental-strip-types", "bin/queuest-github.mjs"]
  },
  "capabilities": ["source.work-items"],
  "permissions": {
    "network": ["api.github.com"],
    "secrets": ["github"]
  },
  "configSchema": {}
}
```

Jira Cloud Connector의 manifest는 다음과 같이 최소 권한만 선언한다.

```json
{
  "schemaVersion": 1,
  "id": "com.queuest.jira",
  "name": "Jira Cloud",
  "version": "0.1.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "node",
    "args": ["--experimental-strip-types", "bin/queuest-jira.mjs"]
  },
  "capabilities": ["source.work-items"],
  "permissions": {
    "network": ["*.atlassian.net"],
    "secrets": ["jira"]
  },
  "configSchema": {}
}
```

Jira manifest는 filesystem 권한을 선언하지 않는다. Plugin Manager process E2E는 이
manifest를 실제 package에서 발견하고, 두 권한 승인 전에는 child process를 시작하지
않는지 확인한 뒤, 승인 후 실제 Node entrypoint를 실행한다.

Google Calendar Connector의 manifest도 일정 조회에 필요한 최소 권한만 선언한다.

```json
{
  "schemaVersion": 1,
  "id": "com.queuest.calendar",
  "name": "Google Calendar",
  "version": "0.1.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "node",
    "args": ["--experimental-strip-types", "bin/queuest-calendar.mjs"]
  },
  "capabilities": ["source.calendar-events"],
  "permissions": {
    "network": ["www.googleapis.com"],
    "secrets": ["calendar"]
  },
  "configSchema": {}
}
```

Calendar manifest는 filesystem 권한을 선언하지 않는다. Plugin Manager process E2E는 이
manifest를 실제 package에서 발견하고, network·secret 권한 승인 전에는 child process를
시작하지 않는지 확인한 뒤, 승인 후 실제 Node entrypoint의 initialize·health.check·shutdown을
검증한다. `health.check`는 의도적으로 Calendar credential을 읽거나 Google에 접속하지 않는
offline 확인이다.

Apple EventKit Connector는 외부 API credential 대신 macOS platform permission만 요청한다.
Calendar와 Reminders manifest는 다음과 같다.

```json
{
  "schemaVersion": 1,
  "id": "com.queuest.apple-calendar",
  "name": "Apple Calendar",
  "version": "0.1.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "node",
    "args": ["--experimental-strip-types", "bin/queuest-apple-calendar.mjs"]
  },
  "capabilities": ["source.calendar-events"],
  "permissions": {
    "platform": ["macos.eventkit.calendar"]
  },
  "configSchema": {}
}
```

```json
{
  "schemaVersion": 1,
  "id": "com.queuest.apple-reminders",
  "name": "Apple Reminders",
  "version": "0.1.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "node",
    "args": ["--experimental-strip-types", "bin/queuest-apple-reminders.mjs"]
  },
  "capabilities": ["source.work-items"],
  "permissions": {
    "platform": ["macos.eventkit.reminders"]
  },
  "configSchema": {}
}
```

Apple manifest에는 network·secret·filesystem 권한이 없다. Permission Broker는
`macos.eventkit.calendar` 또는 `macos.eventkit.reminders` 승인을 process spawn 전에
확인하고, initialize에는 승인된 platform 권한의 부분집합만 전달한다. 이 Host 권한이
승인되어도 macOS TCC 승인이 자동으로 부여되는 것은 아니다.

필수 검증 대상은 다음과 같다.

- manifest schema 버전
- 플러그인 ID·버전·Host API 호환성
- 진입점과 capability
- 네트워크·Keychain·파일 시스템 권한
- 설정 JSON Schema

권한은 업그레이드 때 다시 비교한다. 새 권한이 추가되면 자동으로 활성화하지 않고
사용자의 명시적 선택 승인을 요구한다. 승인 전 활성화 시도는 typed
`PLUGIN_PERMISSION_APPROVAL_REQUIRED` 오류로 끝나며, 플러그인 프로세스는 생성되지
않는다.

첫 실제 Connector인 `@queuest/plugin-github`는 고정된
`https://api.github.com` base URL과 `application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28` 헤더를 사용한다. `source.work-items.list`는
`/repos/{owner}/{repository}/issues?state=all&per_page=100&page={page}`를 GET하고,
GitHub의 Link 헤더에서 다음 숫자 page만 읽어 다시 고정 경로를 만든다. 입력은
`owner/repository`와 opaque numeric page cursor로 제한되어 arbitrary URL이나 host를
요청에 주입할 수 없다. issues endpoint에 함께 반환되는 pull request는
`pull_request` discriminator가 있으면 제외한 뒤 `ExternalWorkItem`으로 매핑한다.

## 프로토콜

프로세스는 한 줄에 하나의 JSON 메시지를 주고받는다.

주요 메서드는 다음과 같다.

```text
initialize
health.check
connection.status
tcc.status
tcc.request-access
source.work-items.list
source.calendar-events.list
shutdown
```

모든 요청과 응답은 `protocolVersion`, `id`를 포함한다. 최소 수직 슬라이스의 Host
transport는 request id 상관관계, 요청 타임아웃, 잘못된 JSON·응답과 일치하지 않는
응답의 격리, 프로세스 종료, stderr 로그, `shutdown` 후 graceful exit를 처리하고,
플러그인 오류를 앱 오류와 분리해서 전달한다. GitHub process의 `initialize`는 승인된
`network: ["api.github.com"]`와 `secrets: ["github"]`를 확인한 뒤 초기화하고,
`health.check`는 권한과 초기화 상태만 확인하며 네트워크 요청이나 Credential Store
조회를 하지 않는다. 실제 연결 확인(`connection.status`)은 credential을 읽어 GitHub
`/user`를 GET하고, 작업 항목 조회만 issues endpoint를 사용한다. `initialize`에는
승인된 권한의 부분집합만 전달하며, Credential Store command 오류에는 secret 값이
포함되지 않는다.

Jira process의 `initialize`는 `network: ["*.atlassian.net"]`와 `secrets: ["jira"]`가
모두 승인된 경우에만 성공한다. `source.work-items.list`는 `projectKey`로
`project = "<projectKey>" ORDER BY updated DESC` JQL을 만들고
`POST /rest/api/3/search/jql`을 호출한다. Jira 응답의 `nextPageToken`을 bounded opaque
cursor로 전달하고 `isLast`가 false면 다음 페이지를 요청하며, 마지막 페이지에는
`nextCursor`를 만들지 않는다. `connection.status`만 credential을 읽어
`GET /rest/api/3/myself`로 연결을 확인하고, `health.check`는 초기화·권한만 확인하는
offline 메서드라서 Jira 네트워크나 Credential Store를 호출하지 않는다. process E2E는
실제 initialize, 이 offline health check, clean shutdown을 함께 검증한다.

Calendar process의 `initialize`는 `network: ["www.googleapis.com"]`와
`secrets: ["calendar"]`가 모두 승인된 경우에만 성공한다.
`source.calendar-events.list`는 고정된
`GET /calendar/v3/calendars/{calendarId}/events` 경로에 `timeMin`, `timeMax`,
`singleEvents=true`, `orderBy=startTime`, `maxResults=2500`과 page cursor를 적용한다.
입력 calendar ID와 RFC3339 시간 범위는 URL 주입과 잘못된 범위를 막도록 검증하고, 여러
calendar ID를 조회할 때는 calendar별 Google `nextPageToken`을 opaque composite cursor로
보존한다. timed/all-day event의 `id`, `summary`, `start`, `end`, `status`, `htmlLink`,
`updated`를 `ExternalCalendarEvent`의 external ID·title·시각·all-day·status·source URL·
updatedAt로 변환하며, `confirmed`·`tentative`·`cancelled` 외 상태나 malformed response는
typed 오류로 처리한다. `connection.status`만 credential을 읽어 고정된
`GET /calendar/v3/calendars/primary`를 호출하고, `health.check`는 초기화·권한만 확인하는
offline 메서드다. credential/auth/not-found/rate-limit/HTTP/malformed-response/network
실패는 token/API response를 오류 message·stderr·로그·protocol 응답에 복제하지 않는다.

Apple EventKit process는 network·secret·filesystem 권한이 아니라 resource별 platform
permission을 검증한다. `@queuest/plugin-eventkit`은 Swift `EventKitJSONL.swift`를 별도
native process로 실행하고, JavaScript 경계에서는 JSONL request id·timeout·typed error와
graceful shutdown을 유지한다. Calendar helper는
`source.calendar-events.list`에서 calendar ID와 RFC3339 시간 범위를 받아
`ExternalCalendarEvent`로 매핑하고, Reminders helper는
`source.work-items.list`에서 선택적 reminder list ID를 받아 `ExternalWorkItem`으로
매핑한다. 두 capability 모두 page size 250과 숫자형 opaque cursor를 사용한다.

EventKit은 읽기 전용 권한을 제공하지 않는다. 따라서 macOS 14 이상에서 일정과
미리알림을 읽으려면 각각 `requestFullAccessToEvents`와
`requestFullAccessToReminders`를 먼저 성공시켜 `.fullAccess` 상태가 되어야 한다. macOS
14 미만에서는 helper가 `requestAccess(to:)`로 폴백한다. `health.check`는 초기화와 현재
TCC 상태만 확인하고 prompt를 띄우지 않으며, Host/UI가 명시적으로 `tcc.request-access`를
호출할 때만 사용자 동의 창을 요청한다. `.notDetermined`, `.denied`, `.restricted`,
`.writeOnly`와 native process/프로토콜 오류는 token 없이 typed error와 `ConnectionStatus`로
전달한다.

이 local path에는 OAuth, access token, Keychain credential, network request가 없다.
`connectionId`는 Host가 연결을 식별하기 위한 로컬 문자열이며, EventKit database는
Apple이 제공하는 `EKEventStore`를 통해서만 읽는다. 현재 plugin은 목록 조회·연결 상태·TCC
상태까지만 노출하고, EventKit create/update/delete 또는 외부 CalendarEvent/Task 저장은
호출하지 않는다.

Plugin transport는 플러그인이 보낸 stderr를 진단 로그로 전달하므로 credential 값을
stderr에 쓰지 않는 것이 플러그인 경계의 규칙이며, transport 자체는 secret redaction
계층이 아니다. 취소 신호와 응답 크기 제한은 아직 후속 transport 경계로 남아 있다.

플러그인이 반환하는 외부 작업 항목은 다음 정보를 포함한다.

- `providerId`, `connectionId`, `externalId`
- 안정적인 `externalRef`와 원본 `sourceUrl`
- 제목·본문·외부 상태·수정 시각

Host는 이 값을 이용해 중복을 제거하고, 선택한 스테이지에 로컬 Task를 저장한다.
플러그인은 SQLite에 직접 쓰지 않는다.

## 설치와 수명주기

내장 플러그인과 사용자 플러그인을 동일하게 취급한다.

```text
discover → validate → show permissions → install → enable → connect → sync
```

필수 관리 기능은 다음과 같다.

- 로컬 번들 또는 압축 패키지 설치 (후속 단계)
- 활성화·비활성화
- 연결 설정과 상태 확인
- 버전 고정·업데이트 (후속 단계)
- 권한 변경 확인
- 로그 확인
- 삭제 (후속 단계)

현재 최소 구현은 이미 존재하는 내장·사용자 디렉터리를 발견하고, manifest를
검증한 뒤 설치·활성화·비활성화 상태를 보존하며, 권한 승인 전 process spawn을
차단하는 범위다. `installPlugin`과 `uninstallPlugin`은 파일 시스템을 변경하지
않으므로, 압축 해제·업데이트·실제 삭제와 권한 승인 UI는 별도 구현이 필요하다.

초기에는 정적 레지스트리로 GitHub·Jira·Google Calendar·Apple EventKit을 번들해도 된다.
중요한 것은 번들 플러그인도 동일한 manifest·프로토콜·Host 경계를 사용하는 것이다. 이후
사용자 플러그인 디렉터리와 설치 UI를 추가해도 앱 본체의 도메인 코드는 바뀌지 않아야 한다.

Apple EventKit은 JavaScript process와 Swift native helper를 함께 배포한다. helper는
`packages/plugin-eventkit/native/build.sh`로 빌드하며 `Info.plist`를
`__TEXT,__info_plist`에 embedding하고 code sign한다. 로컬 기본값은 ad-hoc sign이고,
배포 빌드에서는 `QUEUEST_EVENTKIT_CODESIGN_IDENTITY`에 Developer ID Application
identity를 지정한다. Tauri 설정은 helper를
`Contents/Resources/eventkit/queuest-eventkit`에 포함하고 앱의
`apps/desktop/src-tauri/Info.plist`·`Entitlements.plist`를 적용한다.

앱과 helper는 같은 Team ID로 서명해야 TCC 승인과 배포 검증이 예측 가능하다. 외부
identity를 지정한 배포 절차는 다음을 확인한다.

```bash
QUEUEST_EVENTKIT_CODESIGN_IDENTITY="Developer ID Application: <name> (<team-id>)" \
  npm run build:native --workspace @queuest/plugin-eventkit
npm run tauri -- build
codesign --verify --deep --strict --verbose=2 \
  apps/desktop/src-tauri/target/release/bundle/macos/queuest.app
codesign -dvv --entitlements :- \
  apps/desktop/src-tauri/target/release/bundle/macos/queuest.app/Contents/Resources/eventkit/queuest-eventkit
```

서명된 helper의 embedded usage descriptions가 없거나 helper가 다른 identity로 다시
서명되면 TCC prompt가 거부되거나 기존 동의가 다른 실행 파일로 분리될 수 있다. CI와
notarization에서는 helper 서명 후 Tauri가 만든 nested resource와 최종 app을 함께 검증한다.

## 데이터와 인증 경계

프로젝트의 로컬 `repoPath`와 외부 서비스의 식별자를 분리한다.

```text
Project.repoPath                 로컬 작업 폴더
ProjectIntegration.repository    owner/repository 또는 Jira project key
ProjectIntegration.connectionId  Keychain에 저장된 연결 참조
```

API 토큰은 SQLite·manifest·프로토콜 로그에 저장하지 않는다. Calendar OAuth access token,
Jira API token, GitHub OAuth/PAT는 Host의 Credential Store가 관리하며 플러그인에는 필요한 연결
범위만 전달한다. GitHub는 논리적으로
`{ pluginId: "com.queuest.github", name: connectionId }` credential을 조회한다.
기본 macOS Keychain namespace에서는 service가
`com.yoonhogo.queuest.credentials.plugin.com.queuest.github`, account가
`com.yoonhogo.queuest.credentials.plugin.com.queuest.github.<connectionId>`로
생성된다. 테스트의 `MemoryCredentialStore`도 같은 plugin ID와 connection ID 조합으로
격리한다. 현재 Credential Store에는 memory 구현과 macOS Keychain adapter가 있고,
Keychain command는 shell 없이 `/usr/bin/security`를 execFile 스타일 인자 배열로
실행하며 wrapped 오류·로그에 secret을 포함하지 않는다. GitHub connector는
credential을 bearer Authorization 헤더에만 사용하고, 오류·stderr·로그·프로토콜
결과에 token 값을 포함하지 않는다.

Jira는 논리적으로 `{ pluginId: "com.queuest.jira", name: connectionId }` credential을
조회하며, Credential Store에는 다음 JSON 문자열을 저장한다.

```json
{
  "siteUrl": "https://<tenant>.atlassian.net",
  "email": "account@example.com",
  "apiToken": "<token>"
}
```

`baseUrl`은 `siteUrl` 대신 사용할 수 있는 호환 alias이며 둘 다 지정하면 같은 canonical
origin이어야 한다. 기본 macOS Keychain namespace에서 Jira의 service는
`com.yoonhogo.queuest.credentials.plugin.com.queuest.jira`, account는
`com.yoonhogo.queuest.credentials.plugin.com.queuest.jira.<connectionId>`다. 입력 URL은
HTTPS Atlassian Cloud subdomain(`*.atlassian.net`)의 origin만 허용한다. path, port, query,
fragment, userinfo와 임의 host를 거부하므로 credential이나 project input으로 request
authority/path를 주입할 수 없다. Jira 요청은 고정된 v3 API 경로와
`Authorization: Basic <base64(email:apiToken)>`, `Accept: application/json`,
`Content-Type: application/json`, stable `User-Agent: Queuest Jira Plugin/0.1.0`을 사용한다.

Google Calendar는 논리적으로 `{ pluginId: "com.queuest.calendar", name: connectionId }`
credential을 조회하며, Credential Store에는 다음 JSON 문자열을 저장한다.

```json
{
  "accessToken": "<oauth-access-token>"
}
```

기본 macOS Keychain namespace에서 Calendar의 service는
`com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar`, account는
`com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar.<connectionId>`다. connector는
승인된 `www.googleapis.com` network와 `calendar` secret 권한이 모두 있을 때만 이 값을
읽고, `Authorization: Bearer <accessToken>` 헤더로 고정된 Google Calendar API에 GET 요청을
보낸다. SQLite·manifest·protocol 로그에는 token을 복제하지 않는다.

OAuth 동의 화면, authorization code 교환, refresh token 관리와 Credential Store
provisioning은 Host/UI의 경계다. Calendar connector는 이미 provisioned 된 access token을
읽고 검증·사용하는 read-only process일 뿐이며, OAuth 흐름이나 일정 쓰기 API를 구현하지
않는다.

### Apple EventKit local path

Apple EventKit은 OAuth가 필요한 원격 provider가 아니다. Host는
`{ pluginId: "com.queuest.apple-calendar", name: connectionId }` 또는
`{ pluginId: "com.queuest.apple-reminders", name: connectionId }`에 token을 저장하지
않으며, Apple plugin manifest도 `secrets`와 `network`를 선언하지 않는다. `connectionId`는
요청 상관관계와 향후 연결 설정을 위한 비밀이 아닌 로컬 식별자다. JavaScript plugin은
승인된 platform permission을 Swift helper에 전달하고, helper는 `EKEventStore`를 통해
macOS의 로컬 Calendar/Reminders 저장소만 읽는다.

macOS 14 이상 full-access API를 사용하려면 앱과 helper의 Info.plist에 각각
`NSCalendarsFullAccessUsageDescription`와 `NSRemindersFullAccessUsageDescription`를
넣어야 한다. Tauri 앱은 `apps/desktop/src-tauri/Info.plist`에서 이를 선언하고,
helper는 `packages/plugin-eventkit/native/Info.plist`를 executable에 embed한다. Sandbox
또는 hardened-runtime 배포에서는 `com.apple.security.personal-information.calendars`
entitlement를 앱과 helper에 적용하고, 최종 nested code signing에서 이를 보존한다.

## 보안 등급

### Connector

GitHub·Jira·Calendar 같은 API 조회 플러그인이다.

- 파일 시스템 접근 없음
- 선언한 API 도메인만 사용
- 토큰은 Credential Store를 통해서만 읽고 SQLite·manifest·로그·프로토콜로 복제하지 않음
- 읽기 전용 동기화부터 시작

GitHub Connector의 현재 read-only scope는 issue 목록(`state=all`, pagination)과 연결
상태(`GET /user`) 확인이다. create/update/close/comment 같은 provider write operation,
그리고 조회 결과를 UI에서 선택한 마일스톤의 로컬 Task로 저장하거나
`externalRef`로 중복 제거하는 Host 흐름은 아직 후속 단계다. 이 범위를 지키기 위해
manifest에는 `api.github.com` network와 `github` secret만 선언하고 filesystem 권한은
선언하지 않는다.

Jira Cloud Connector의 read-only scope는 project JQL 기반 issue 목록과
`GET /rest/api/3/myself` 연결 상태 확인이다. Jira issue는 `providerId: "jira"`, connection
식별자, issue id/key 기반 stable `externalRef`(`jira:<tenant>.atlassian.net/<issueKey>`),
`https://<tenant>.atlassian.net/browse/<issueKey>` source URL, summary/title,
ADF 또는 문자열 description/body, labels, updatedAt를 가진 `ExternalWorkItem`으로
매핑한다. Jira status category `new`/`todo`는 `open`, `indeterminate`/`in-progress`는
`in_progress`, `done`/`closed`는 `closed`로 매핑한다. `*.atlassian.net` network와 `jira`
secret만 선언하며 filesystem 권한은 없다. missing/malformed credential, auth, not-found,
rate-limit, HTTP, malformed response, network failure는 token/API response를 포함하지 않는
`JiraPluginError` typed error와 안전한 `connection.status` state로 변환한다. 대응 코드는
`CREDENTIAL_NOT_FOUND`, `MALFORMED_CREDENTIAL`, `AUTH_ERROR`, `NOT_FOUND`, `RATE_LIMITED`,
`HTTP_ERROR`, `MALFORMED_RESPONSE`, `NETWORK_ERROR`이며, 오류 message·stderr·로그·protocol
응답에 token이나 원격 API response를 복제하지 않는다. UI import/local
Task 저장과 `externalRef` deduplication, Jira provider write, OAuth/3LO, self-hosted
Jira/Data Center는 후속 범위다.

Google Calendar Connector의 read-only scope는 기간·calendar ID 기반 일정 목록과
`GET /calendar/v3/calendars/primary` 연결 상태 확인이다. Google event는
`providerId: "google-calendar"`, connection ID, external ID, calendar ID, title, 시작·종료
시각, all-day 여부와 `confirmed`·`tentative`·`cancelled` 상태, 선택적 source URL·updatedAt를
가진 `ExternalCalendarEvent`로 매핑한다. `www.googleapis.com` network와 `calendar` secret만
선언하며 filesystem 권한은 없다. permission, missing/malformed credential, auth, not-found,
rate-limit, HTTP, malformed response, network failure는 token/API response를 포함하지 않는
`CalendarPluginError` typed error와 안전한 `connection.status` state로 변환한다. 일정 쓰기,
UI import, CalendarEvent 로컬 저장·Task 변환과 OAuth/consent/token refresh/provisioning은
후속 Host/UI 범위다.

Apple EventKit Connector의 read-only scope는 macOS 로컬 Calendar 일정과 Reminders 항목의
기간·목록 기반 조회, `connection.status`, `tcc.status`, `tcc.request-access`다. Apple
Calendar event는 `providerId: "apple-calendar"`, local connection ID, EventKit identifier,
calendar ID, title, 시작·종료 시각, all-day 여부와 `confirmed`·`tentative`·`cancelled`
상태를 가진 `ExternalCalendarEvent`로 매핑한다. Apple Reminders item은
`providerId: "apple-reminders"`, calendar/list title, stable external ID/ref, title/body,
open/closed status와 updatedAt를 가진 `ExternalWorkItem`으로 매핑한다.

두 manifest는 각각 `macos.eventkit.calendar`와 `macos.eventkit.reminders` platform
permission만 선언한다. Permission Broker 승인과 macOS TCC full-access 승인은 별개이며,
승인 전에는 process를 spawn하지 않는다. missing/denied/restricted/write-only TCC,
malformed native response, native process timeout/exit는 `EventKitPluginError`와 안전한
`ConnectionStatus`로 변환한다. OAuth 동의·token refresh·Credential Store provisioning,
network 호출, 일정/미리알림 write, UI import, CalendarEvent·Task 저장과
`externalRef` deduplication은 후속 Host/UI 범위다. Full access를 확보해도 현재 plugin은
read-only methods만 호출한다.

### Trusted

AI 실행, 로컬 명령, 파일 변환처럼 강한 권한이 필요한 플러그인이다.

- 별도 프로세스
- 설치 시 신뢰 확인
- 권한 목록과 변경 내역 표시
- 언제든 비활성화·삭제 가능

신뢰하지 않는 임의 코드를 완전히 격리해야 하는 경우에는 프로세스 실행만으로
충분하지 않다. 이후 WASM 또는 macOS OS-level sandbox를 검토한다.

## 단계적 구현

1. `plugin-contracts`의 manifest·프로토콜·정규화 타입 (완료)
2. mock 플러그인과 계약 테스트 (완료)
3. Plugin Manager의 발견·검증·수명주기 (완료)
4. Host 중개 인증·권한·로그 — Permission Broker, 승인 저장소, Keychain adapter,
   명시적 승인 전 활성화 차단, secret 비노출 경계까지 완료
5. GitHub API 플러그인 (완료: REST mapping, auth/permission boundary, pagination, safe errors, process E2E)
6. Jira API 플러그인 (완료: Atlassian Cloud read-only REST mapping, Basic API-token auth,
   permission boundary, enhanced JQL pagination, safe errors, offline health, process E2E)
7. Calendar API 플러그인 (완료: Google Calendar read-only REST mapping, Bearer access-token
   auth, permission boundary, timed/all-day event mapping, pagination, safe errors, offline
   health, process E2E)
8. Apple EventKit 플러그인 (완료: shared Swift EventKit helper, full-access/TCC gate,
   platform permission boundary, local read-only Calendar/Reminders mapping, helper signing,
   Tauri Info.plist/entitlements/resources, process E2E)
9. 사용자 설치·권한 승인 UI와 업데이트 (후속)
10. `agent.runner` 기반 AI 플러그인

외부 서비스에서 Queuest로 가져오는 단방향 흐름을 먼저 유지한다. GitHub, Jira, Google
Calendar와 Apple EventKit connector의 조회·변환은 완료했지만 UI import와 local
Task/CalendarEvent 저장, `externalRef` deduplication은 아직 구현하지 않았다. 외부 서비스에
수정 내용을 되돌려 쓰는 provider write 기능은 각 capability가 안정화된 뒤 별도로 설계하며,
Google Calendar OAuth 동의·token refresh·credential provisioning, Apple EventKit UI/TCC
설정과 write capability, Jira OAuth/3LO·self-hosted Jira/Data Center 지원도 후속 Host/UI
범위다.
