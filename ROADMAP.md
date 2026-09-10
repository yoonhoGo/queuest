# Queuest 로드맵

> Life is a queue of quests.

Queuest는 개인 프로젝트를 `원정(프로젝트) → 스테이지(마일스톤) → 퀘스트(태스크)`로 관리하는 macOS 메뉴바 앱이다.

이 문서는 설계 아이디어가 아니라, 현재 레포에서 실제로 만들어야 할 기능의 순서와 완료 조건을 기록한다.

## 현재 상태

- [x] [퀘스트 시스템](./docs/quest-system.md) 정의, 문맥 저장·편집 및 전역 추적 표시
- [ ] 공통 목표·수행 조건·외부 관계 가져오기·반복 회차·일정 동기화·성과 보상 (퀘스트 시스템 완료 조건 참조)

- [x] Tauri 2 + React + TypeScript 기반 데스크톱 골격
- [x] 도메인 모델과 진행률·게이트·XP·스킬 계산 함수
- [x] SQLite 스키마와 기본 저장소 어댑터
- [x] Claude 실행 및 GitHub Issues 조회를 위한 Tauri 명령 경계
- [x] 스테이지 맵·상태 보드·캐릭터 시트 데모 화면
- [x] Todo-first 진입과 선택 프로젝트 보드의 SQLite 연결
- [x] 화면에서 프로젝트·마일스톤·태스크를 생성·수정·삭제
- [x] 외부 플러그인 manifest·프로토콜·정규화 타입 계약
- [x] Apple EventKit Calendar·Reminders 로컬 read-only plugin과 native process E2E
- [ ] AI 어댑터를 실제 UI 흐름에 연결
- [x] GitHub Issues 조회·선택·로컬 Task 저장 UI 흐름

## P0 — 로컬 MVP

### 1. 앱 데이터 흐름

- [x] 앱 시작 시 SQLite 초기화 및 Todo 인박스 로드
- [x] React 앱 상태와 저장소 포트 연결
- [x] 로딩·빈 상태·오류 상태 화면
- [x] 명시적 프로젝트 선택·생성 후 워크스페이스·프로젝트·마일스톤·태스크 그래프 복원
- [x] 태스크 댓글·캐릭터·프로젝트 장비 슬롯 저장소 포트 완성
- [x] 새 DB에서 첫 프로젝트와 첫 스테이지 생성 안내

완료 조건: 앱을 종료했다 다시 실행해도 프로젝트와 태스크가 그대로 남는다.

### 2. 핵심 CRUD

- [x] 워크스페이스 생성·수정·삭제 및 전환
- [x] 프로젝트 생성·수정·삭제
- [x] 프로젝트 `repoPath` 입력·검증 및 스킬 편집
- [x] 마일스톤 생성·수정·삭제 및 순서 변경
- [x] 태스크 생성·수정·삭제
- [x] 태스크 제목·본문·담당자·스킬·`blocked` 플래그 편집
- [x] 하위 데이터가 있는 엔티티 삭제 시 확인 및 cascade 처리

완료 조건: 프로젝트 1개, 마일스톤 3개, 태스크 여러 개를 UI만으로 만들고 수정·삭제할 수 있다.

### 3. 상태 보드와 게이트

- [x] `todo → doing → review → done` 상태 이동
- [x] 상태 되돌리기 및 드래그 앤 드롭
- [x] `review → done`은 사람의 확인으로만 처리
- [x] 상태 변경을 DB에 저장하고 보드에 즉시 반영
- [x] 마일스톤별 완료율·프로젝트 진행률·프로젝트 상태 계산
- [x] 잠긴 마일스톤 표시 및 게이트 정책 적용
- [ ] 마일스톤 완료 시 잠금 해제 연출

현재 결정: 잠긴 스테이지는 접근을 막고, 태스크 편집기의 소속 변경으로만 계획 데이터를 미리 배치할 수 있다. AI 실행 권한은 AI 연동 단계에서 별도로 제한한다.

완료 조건: 태스크 완료에 따라 다음 마일스톤이 열리고, 앱을 재실행해도 보드 상태가 유지된다.

### 4. 메뉴바 앱 동작

- [x] 트레이 클릭으로 메인 팝오버 열기·닫기
- [x] 포커스를 잃으면 자동 숨김
- [x] 핀을 켜면 자동 숨김을 해제
- [ ] 현재 `doing` 태스크 수를 트레이에 표시
- [x] Dock에 상주하지 않는 accessory 동작 확인
- [x] 설정 버튼을 실제 설정 화면에 연결

완료 조건: 다른 앱을 사용 중에도 메뉴바 한 번의 클릭으로 420×640 보드를 다시 열 수 있다.

### 5. 캐릭터 시트와 도구 설정

- [x] 캐릭터 이름·직업 선택
- [x] 개발자·기획자·디자이너 도트 스프라이트 연결
- [x] 전체 프로젝트의 완료 태스크·마일스톤 기반 XP·레벨 표시
- [x] 스킬 태그별 레벨과 직업별 강조 표시
- [x] XP 계산식과 “다음 레벨까지” 표시 일치 검증
- [x] 기존 로컬 도구 PATH 탐색과 상태 확인
- [x] 발견된 도구를 인벤토리와 프로젝트별 장비 슬롯에 표시
- [x] 로컬 도구 미설치 상태 안내

완료 조건: 도구가 없으면 관련 기능이 비활성화되고, 완료 기록에 따라 캐릭터 시트가 자동으로 바뀐다.

### 6. AI 실행

- [ ] 태스크 카드에서 Claude 실행
- [ ] 프로젝트 `repoPath`를 작업 디렉터리로 사용
- [ ] 실행 중 상태·전역 동시 실행 잠금
- [ ] 실행 중 취소 및 프로세스 종료 처리
- [ ] 성공 결과 요약·원문을 태스크 댓글로 저장
- [ ] 성공 시 `review`로 전환
- [ ] 실패·취소·빈 출력·잘못된 JSON 오류 처리
- [ ] MVP에서는 작업 트리 변경까지만 허용하고 커밋·푸시는 하지 않음

완료 조건: 태스크 하나가 실제 저장소에서 실행되고 `review`로 돌아오며, 사람이 확인하기 전에는 `done`이 되지 않는다.

### 7. 외부 연동 플러그인 기반

- [x] 버전 있는 manifest와 capability 계약
- [x] 프로세스 플러그인 JSON 프로토콜 계약
- [x] 외부 프로세스 플러그인용 SDK와 계약 테스트
- [x] GitHub·Jira 작업 항목과 Calendar 일정의 정규화 모델 분리
- [x] GitHub API 플러그인
- [x] Jira API 플러그인
- [x] Calendar API 플러그인
- [x] Apple EventKit Calendar·Reminders plugin과 공통 Swift native helper
- [x] Plugin Manager의 발견·검증·설치 상태·활성화·비활성화
- [x] 권한 브로커·승인 저장소와 macOS Keychain Credential Store 경계
- [x] 내장 서비스 플러그인 연결 설정 화면과 macOS Keychain credential bridge
- [ ] 사용자 플러그인 설정 JSON Schema 기반 화면
- [x] 플러그인 프로세스 타임아웃·stderr·graceful shutdown·로그 경계
- [ ] 플러그인 프로세스 취소·응답 크기 제한

현재 Plugin Manager 최소 수직 슬라이스는 내장·사용자 디렉터리의 manifest 검증,
Host API 호환성 확인, reversible lifecycle state, process stdio transport와
mock-plugin E2E를 제공한다. `@queuest/plugin-permissions`는 manifest의 network·secret·
filesystem 권한을 정규화하고 requested/granted/missing 상태를 비교한다. permissioned
manifest는 사용자가 선택한 권한을 명시적으로 승인하기 전에는 `activatePlugin`이
프로세스를 spawn하지 않으며, 새로 요청된 권한도 같은 방식으로 다시 승인해야 한다.
초기화 메시지에는 승인된 권한의 부분집합만 전달한다. Memory/원자적 JSON 승인 저장소와
실제 `/usr/bin/security` 기반 macOS Keychain Credential Store를 제공하고, credential
오류와 로그에는 secret 값을 포함하지 않는다. Jira provider API와 Credential Store 연결,
Calendar provider API 흐름과 내장 서비스 플러그인의 연결 설정 UI는 완료했고, 사용자
플러그인 권한 승인·JSON Schema 기반 설정 생성 UI는 후속 단계로 남아 있다.
transport 취소와 응답 크기 제한도 후속 경계다.

`@queuest/plugin-github`는 이 단계의 첫 실제 Connector다. 고정된
`https://api.github.com`에서 issues와 user endpoint를 GET으로 호출하고, `com.queuest.github`
namespace와 `connectionId`로 찾은 credential을 bearer token으로 사용한다. manifest의
`api.github.com` network와 `github` secret 권한을 모두 승인하기 전에는 credential/API를
사용하지 않으며, owner/repository와 숫자 page cursor만 입력으로 받아 모든 issue 상태를
페이지 단위로 조회한다. GitHub issues 응답의 pull request는 제외하고
`ExternalWorkItem`으로 변환하며, auth·not-found·rate-limit·HTTP·malformed-response·
credential 오류는 안전한 typed error/connection state로 매핑한다. 응답 변환·보안 경계는
주입 fetch와 MemoryCredentialStore 단위 테스트로, manifest 발견·권한 거부·실제 Node
process initialize/health/shutdown은 Plugin Manager process E2E로 검증한다.

`@queuest/plugin-jira`도 읽기 전용 API Connector로 완료했다. manifest는
`id: "com.queuest.jira"`, `capabilities: ["source.work-items"]`,
`network: ["*.atlassian.net"]`, `secrets: ["jira"]`만 선언하며, 파일 시스템 권한은
선언하지 않는다. Credential Store의 논리 키는 `{ pluginId: "com.queuest.jira", name:
connectionId }`이고 JSON 값은 다음과 같다.

```json
{"siteUrl":"https://<tenant>.atlassian.net","email":"account@example.com","apiToken":"<token>"}
```

`baseUrl`은 `siteUrl`의 호환 alias이며, 기본 macOS Keychain service/account는 각각
`com.yoonhogo.queuest.credentials.plugin.com.queuest.jira`와
`com.yoonhogo.queuest.credentials.plugin.com.queuest.jira.<connectionId>`다. HTTPS
`*.atlassian.net` origin만 허용하고 arbitrary host/path/port injection을 막는다. 두 권한을
명시적으로 승인한 뒤에만 Basic `base64(email:apiToken)` 인증으로
`POST /rest/api/3/search/jql`과 `GET /rest/api/3/myself`를 호출한다. `projectKey`로 안전한
JQL을 만들고 bounded opaque `nextPageToken`과 `isLast`를 이용해 페이지를 이어 가며,
summary·ADF/string description·labels·updatedAt·Jira status category를
`ExternalWorkItem`의 title/body·labels·updatedAt·open/in_progress/closed와 stable
`externalRef`·browse `sourceUrl`로 매핑한다. `health.check`는 initialize 이후에도
credential/API를 읽지 않는 offline 상태 확인이며, missing/malformed credential·auth·not-found·
rate-limit·HTTP·malformed-response·network 실패는 token을 포함하지 않는 safe typed
error/connection state로 전달한다. 실제 manifest 발견, 승인 전 spawn 차단, 승인 후 Node
entrypoint initialize/health/shutdown은 Plugin Manager process E2E로 검증한다.

`@queuest/plugin-calendar`는 Google Calendar 일정 조회용 읽기 전용 API Connector로 완료했다.
manifest는 `id: "com.queuest.calendar"`, `capabilities: ["source.calendar-events"]`,
`network: ["www.googleapis.com"]`, `secrets: ["calendar"]`만 선언하며 파일 시스템 권한은
선언하지 않는다. Credential Store의 논리 키는 `{ pluginId: "com.queuest.calendar", name:
connectionId }`이고 JSON 값은 다음과 같다.

```json
{"accessToken":"<oauth-access-token>"}
```

기본 macOS Keychain service/account는 각각
`com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar`와
`com.yoonhogo.queuest.credentials.plugin.com.queuest.calendar.<connectionId>`다. 두 권한을
명시적으로 승인한 뒤에만 credential/API를 사용하고, 고정된
`GET /calendar/v3/calendars/{calendarId}/events` 경로에 RFC3339 `timeMin`·`timeMax`,
`singleEvents=true`, `orderBy=startTime`, `maxResults=2500`과 opaque page cursor를
적용한다. timed/all-day 일정과 `confirmed`·`tentative`·`cancelled` 상태를
`ExternalCalendarEvent`로 매핑하고, 여러 calendar ID를 조회할 때도 완료된 page를 반복하지
않는 cursor를 반환한다. `connection.status`는 credential을 읽어
`GET /calendar/v3/calendars/primary`를 호출하지만, `health.check`는 초기화·권한만 확인하는
offline 상태 확인이다. missing/malformed credential·permission·auth·not-found·rate-limit·
HTTP·malformed-response·network 실패는 token/API 응답을 포함하지 않는 safe typed error와
connection state로 전달하며, 응답 변환·권한 경계·process initialize/health/shutdown은
단위 테스트와 Plugin Manager process E2E로 검증한다.

이 Connector는 OAuth 동의·authorization code 교환·token refresh나 Credential Store
provisioning을 구현하지 않는다. Host/UI가 OAuth 결과인 `accessToken`을 Credential Store에
넣고, connector에는 승인된 network·secret 권한과 연결 ID만 전달하는 것이 OAuth 경계다.
일정 쓰기, UI import, CalendarEvent 로컬 저장·Task 변환은 후속 범위다.

`@queuest/plugin-apple-calendar`와 `@queuest/plugin-apple-reminders`는 macOS EventKit
로컬 데이터 조회를 위한 read-only Connector다. 공통 `@queuest/plugin-eventkit`이 Swift
`EventKitJSONL.swift` helper를 별도 process로 실행하며, Calendar는
`source.calendar-events`와 `macos.eventkit.calendar`, Reminders는 `source.work-items`와
`macos.eventkit.reminders`를 선언한다. 두 manifest 모두 network·secret·filesystem 권한을
선언하지 않고, OAuth·access token·Credential Store provisioning도 사용하지 않는다.

Plugin Manager는 platform permission을 먼저 승인해야 process를 spawn하고, helper의
`initialize`에는 승인된 platform 권한만 전달한다. 이것은 macOS TCC 동의와 별개의 Host
권한이다. helper는 macOS 14 이상에서 읽기에 필요한 EventKit full access를
`tcc.request-access`로 요청하고, `tcc.status`와 `health.check`로 상태를 확인한다. 권한을
허용하지 않았거나 read access가 없으면 목록 조회를 수행하지 않으며, `health.check`는
사용자에게 권한을 자동 요청하지 않는다.

앱의 `Info.plist`와 helper의 embedded `Info.plist`에는
`NSCalendarsFullAccessUsageDescription`와 `NSRemindersFullAccessUsageDescription`가 있고,
Tauri bundle은 `Contents/Resources/eventkit/queuest-eventkit`에 helper를 포함한다.
`apps/desktop/src-tauri/Entitlements.plist`와 native helper entitlements는 Calendar
personal-information entitlement를 선언한다. `packages/plugin-eventkit/native/build.sh`는
Info.plist를 helper의 `__TEXT,__info_plist`에 포함하고 helper를 서명한다. 로컬은 ad-hoc
서명으로 빌드할 수 있지만, 배포 시에는 앱과 같은 Team ID의 Developer ID identity로
helper와 Tauri app을 모두 서명하고 nested resource의 `codesign --verify --deep`를 확인해야
한다.

이 완료는 native helper와 plugin process의 권한 경계·JSONL 수명주기·결정적 no-TCC E2E까지다.
EventKit에는 read-only TCC 권한이 없으므로 현재 구현은 full access를 받더라도 목록 조회만
호출한다. 일정/미리알림 UI, TCC 안내·요청 화면, CalendarEvent·Task 저장 및
`externalRef` deduplication, EventKit에 생성·수정·삭제를 되돌려 쓰는 operation은 후속
Host/UI 범위이며 별도의 write capability와 명시적 사용자 확인이 필요하다.

API Connector와 내장 connector 연결 설정에 이어 Jira의 native Host 가져오기와 로컬 Task
저장도 연결했다. Calendar·EventKit 항목의 로컬 Task 또는 CalendarEvent 저장은 후속 범위다. GitHub는 아래의 read-only
가져오기 흐름을 연결했으며, GitHub에 수정 내용을 되돌려 쓰는 create/update/close/comment
작업은 읽기 전용 범위 밖의 후속 단계로 남긴다.

Jira Cloud의 UI 가져오기·local Task 저장·프로젝트 내 `externalRef` 중복 방지는
별도 native Host adapter로 구현했다. provider write operation은 아직 없다. OAuth/3LO와 self-hosted Jira/Data
Center 지원도 Atlassian Cloud API Connector 이후의 후속 범위다.

완료 조건: 내장 플러그인과 사용자 설치 플러그인이 동일한 manifest·프로토콜로
검증되고, 앱 본체가 플러그인의 구현이나 외부 API 타입을 직접 의존하지 않는다.

### 8. GitHub Issues 가져오기(UI·Host 흐름)

`@queuest/plugin-github`의 조회·응답 변환을 프로젝트 보드의 GitHub 가져오기 패널과
로컬 Task 저장 경계에 연결했다. 앱의 현재 Tauri Host 경로는 프로젝트 `repoPath`에서
`gh` CLI를 호출하며, 동일한 GitHub 이슈 응답을 사용하는 `@queuest/adapter-github`가
Task 변환을 담당한다.

- [x] 가져오기 메뉴와 대상 마일스톤 선택
- [x] UI에서 GitHub 인증 상태로 열린/닫힌 이슈 가져오기
- [x] 가져온 항목의 OPEN/CLOSED를 로컬 Task 상태로 매핑
- [x] `externalRef` 기반 중복 방지
- [x] 이슈 원본 URL 열기
- [x] 인증·저장소·네트워크 오류 안내

이 단계에서는 외부 서비스로의 쓰기 작업을 추가하지 않는다. GitHub issue 생성·수정·종료·
댓글 등 provider write operation은 읽기 전용 동기화가 안정화된 뒤 별도로 설계한다.

완료 조건: 같은 저장소에서 가져오기를 반복해도 동일 이슈가 중복 카드로 생성되지 않는다.
현재 구현은 선택한 새 이슈만 저장하고, 이미 가져온 이슈는 비활성화해 표시한다.

Jira UI 가져오기와 local Task 저장, 프로젝트 내 `externalRef` 중복 방지는 native Host 경로로
구현했다. provider write operation, OAuth/3LO, self-hosted Jira/Data Center는 후속 범위다.

Google Calendar Connector도 UI 일정 화면·동기화, 일정 쓰기, CalendarEvent 로컬 저장·Task
변환, OAuth 동의·token refresh·credential provisioning은 이 read-only API Connector 완료에
포함하지 않는다.

Apple EventKit Connector도 native process와 TCC 권한 확인까지 완료했지만, EventKit 목록을
표시하는 UI, local CalendarEvent·Task 저장, 일정/미리알림 write operation은 아직 구현하지
않는다. OAuth 없는 local path를 유지하고, 향후 UI에서 별도 사용자 확인을 거친 뒤 capability를
확장한다.

### 9. MVP 검증과 배포

- [x] 도메인 계산·상태 전이 단위 테스트
- [x] SQLite 저장·재실행·cascade 테스트
- [x] GitHub 응답 변환 테스트 (`@queuest/plugin-github`)
- [x] Jira 응답 변환·process boundary 테스트 (`@queuest/plugin-jira`)
- [x] Calendar 응답 변환·process boundary 테스트 (`@queuest/plugin-calendar`)
- [x] Apple EventKit 응답 변환·platform permission·process boundary 테스트
- [x] EventKit Swift helper의 Info.plist embedding·서명 및 Tauri resource build metadata
- [x] 로컬 Task `externalRef` 중복 방지 및 GitHub Task 변환 테스트
- [ ] AI 결과 변환·취소·오류 테스트
- [ ] 키보드 포커스·접근성 라벨·색상 외 상태 표현 점검
- [ ] 빈 프로젝트·태스크가 많은 프로젝트·도구 미설치 상태 점검
- [ ] macOS 번들 설치·실제 메뉴바·팝오버 및 TCC consent 스모크 테스트

### P0 완료 기준

새로 설치한 macOS 앱에서 프로젝트를 만들고, 마일스톤 3개를 거쳐 태스크를 완료하며, AI 결과를 검토하고, GitHub 이슈를 중복 없이 가져온 뒤 앱을 재실행해도 데이터가 남아 있어야 한다.

## P1 — 반복 사용 개선

- [ ] 외부 플러그인 레지스트리와 서명 검토
- [ ] 로그인 시 자동 시작
- [ ] 전역 단축키로 팝오버 토글
- [ ] 작업 완료·AI 귀환 알림
- [ ] 프로젝트별 AI 병렬 실행
- [ ] AI 실행 로그 스트리밍
- [ ] Agent SDK 직접 임베드 검토
- [ ] Obsidian 노트 링크 열기
- [ ] 커밋·PR 자동화 옵션 검토 — 별도 확인 단계 필수

## P2 — 회고와 연출

- [ ] 주간 완료 수 및 프로젝트별 진행 통계
- [ ] 완료·게이트 해제·레벨업 연출 확장
- [ ] 사운드와 전체 연출 on/off 설정
- [ ] 태스크 검색·필터·정렬

## P3 — 파티와 온라인화

팀원 초대와 공동 보드가 필요해지는 시점에 온라인 기능을 별도 설계한다.

- [ ] 계정·초대·권한
- [ ] 서버 저장과 동기화
- [ ] 팀원별 `assignee`
- [ ] 충돌 해결 또는 CRDT
- [ ] 실시간 공동 보드

P3 전까지는 로컬 SQLite, 단일 사용자, 외부 도구에서 앱으로 가져오는 단방향 흐름을 유지한다.

## 만들지 않는 것

상점·드롭·강화·스탯 효과·스킬 트리, 모바일, 클라우드 동기화, 팀 공유, 역방향 동기화, 반복 태스크, 기한 기반 자동 이월은 해당 단계가 명시되기 전까지 만들지 않는다.


### GitHub 검토 PR과 Jira 퀘스트 가져오기

- [x] 할 일 화면에서 `gh` 계정에 리뷰 요청된 열린 PR 조회 및 원본 열기 (최대 100개)
- [x] 저장된 Jira 연결·대상 스테이지 선택과 프로젝트 티켓 페이지 조회
- [x] 보드 ID 기반 실제 백로그 조회와 미수락 퀘스트 저장
- [x] 보드 ID가 설정된 프로젝트 조회에서도 해당 보드 백로그를 미수락으로 분류
- [x] 명시적 수락, 수락 전 상태 전환 차단·추적 및 진행률/XP 제외
- [x] SQLite 수락 여부 유지, 프로젝트 내 중복 방지, 부분 저장 실패 후 재시도

데스크톱 Jira 경로는 Node process plugin의 배포와 별개인 native Host adapter이다.
조회 버튼의 접근 허용을 Host에서 확인하며 process PermissionBroker 승인 저장소와는
별개다. 실제 Jira/GitHub 계정으로 최종 사용자 검증은 별도로 필요하다.
