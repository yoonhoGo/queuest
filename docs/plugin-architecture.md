# Queuest 플러그인 아키텍처

## 목표

Queuest는 앞으로 추가될 외부 연동을 앱 본체의 구현과 분리한다.
GitHub·Jira·Calendar는 첫 번째 플러그인이며, 향후 어떤 제공자도 같은 Host 계약으로
설치·활성화·비활성화·업데이트·삭제할 수 있어야 한다.

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
    └── Calendar API
```

현재 계약은 `@queuest/plugin-contracts`에 있다. 첫 버전은 프로세스 플러그인을
대상으로 하지만, 계약 자체는 특정 언어·런타임에 종속되지 않는다.

별도 프로세스는 격리의 경계이지 완전한 보안 샌드박스가 아니다. 플러그인 프로세스가
운영체제의 네트워크·파일 시스템 권한을 그대로 가지지 않도록 Connector 플러그인은
Host가 중개하는 API와 Keychain만 사용하게 한다. 강한 권한이 필요한 플러그인은
Trusted 플러그인으로 분류하고 설치 시 별도 신뢰 확인을 거친다.

## Capability

하나의 거대한 플러그인 인터페이스 대신 기능별 capability를 사용한다.

| Capability | 의미 | 첫 구현 |
| --- | --- | --- |
| `source.work-items` | 외부 작업 항목을 페이지 단위로 조회 | GitHub, Jira |
| `source.calendar-events` | 기간·캘린더 기준으로 일정 조회 | Calendar |
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
  "version": "1.0.0",
  "hostApi": "^1.0.0",
  "entry": {
    "type": "process",
    "command": "./bin/queuest-github"
  },
  "capabilities": ["source.work-items"],
  "permissions": {
    "network": ["api.github.com"],
    "secrets": ["github"]
  },
  "configSchema": {}
}
```

필수 검증 대상은 다음과 같다.

- manifest schema 버전
- 플러그인 ID·버전·Host API 호환성
- 진입점과 capability
- 네트워크·Keychain·파일 시스템 권한
- 설정 JSON Schema

권한은 업그레이드 때 다시 비교한다. 새 권한이 추가되면 자동으로 활성화하지 않고
사용자의 승인을 요구한다.

## 프로토콜

프로세스는 한 줄에 하나의 JSON 메시지를 주고받는다.

주요 메서드는 다음과 같다.

```text
initialize
health.check
connection.status
source.work-items.list
source.calendar-events.list
shutdown
```

모든 요청과 응답은 `protocolVersion`, `id`를 포함한다. Host는 타임아웃·취소·응답
크기 제한·잘못된 JSON을 처리하고, 플러그인 오류를 앱 오류와 분리해서 표시한다.

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

- 로컬 번들 또는 압축 패키지 설치
- 활성화·비활성화
- 연결 설정과 상태 확인
- 버전 고정·업데이트
- 권한 변경 확인
- 로그 확인
- 삭제

초기에는 정적 레지스트리로 GitHub·Jira·Calendar를 번들해도 된다. 중요한 것은
번들 플러그인도 동일한 manifest·프로토콜·Host 경계를 사용하는 것이다. 이후 사용자
플러그인 디렉터리와 설치 UI를 추가해도 앱 본체의 도메인 코드는 바뀌지 않아야 한다.

## 데이터와 인증 경계

프로젝트의 로컬 `repoPath`와 외부 서비스의 식별자를 분리한다.

```text
Project.repoPath                 로컬 작업 폴더
ProjectIntegration.repository    owner/repository 또는 Jira project key
ProjectIntegration.connectionId  Keychain에 저장된 연결 참조
```

API 토큰은 SQLite·manifest·로그에 저장하지 않는다. Calendar OAuth, Jira API token,
GitHub OAuth/PAT는 Host의 Credential Store가 관리하며 플러그인에는 필요한 연결
범위만 전달한다.

## 보안 등급

### Connector

GitHub·Jira·Calendar 같은 API 조회 플러그인이다.

- 파일 시스템 접근 없음
- 선언한 API 도메인만 사용
- 토큰 직접 접근 없음
- 읽기 전용 동기화부터 시작

### Trusted

AI 실행, 로컬 명령, 파일 변환처럼 강한 권한이 필요한 플러그인이다.

- 별도 프로세스
- 설치 시 신뢰 확인
- 권한 목록과 변경 내역 표시
- 언제든 비활성화·삭제 가능

신뢰하지 않는 임의 코드를 완전히 격리해야 하는 경우에는 프로세스 실행만으로
충분하지 않다. 이후 WASM 또는 macOS OS-level sandbox를 검토한다.

## 단계적 구현

1. `plugin-contracts`의 manifest·프로토콜·정규화 타입
2. mock 플러그인과 계약 테스트
3. Plugin Manager의 발견·검증·수명주기
4. Host 중개 인증·권한·로그
5. GitHub API 플러그인
6. Jira API 플러그인
7. Calendar API 플러그인
8. 사용자 설치 UI와 업데이트
9. `agent.runner` 기반 AI 플러그인

외부 서비스에서 Queuest로 가져오는 단방향 흐름을 먼저 유지한다. 외부 서비스에
수정 내용을 되돌려 쓰는 기능은 각 capability가 안정화된 뒤 별도로 설계한다.
