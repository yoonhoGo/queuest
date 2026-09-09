# Queuest

> Life is a queue of quests.

개인 프로젝트를 원정(프로젝트) → 스테이지(마일스톤) → 퀘스트(태스크)로 관리하는 macOS 메뉴바 앱입니다.

현재 레포는 `Tauri 2 + React + TypeScript + SQLite` 기반의 로컬 MVP입니다. 앱은 SQLite 인박스를 먼저 열고, 사용자가 프로젝트를 선택하거나 만들 때만 워크스페이스·프로젝트·마일스톤·태스크 그래프를 불러옵니다. 워크스페이스와 프로젝트·마일스톤·태스크 CRUD, 보드 상태 이동은 로컬 SQLite에 즉시 저장되고, 태스크 댓글·캐릭터·프로젝트 장비 설정도 재실행 시 복원할 수 있는 저장 경계를 갖습니다. 메뉴바 팝오버는 포커스와 핀 상태를 반영하며 도구 상태를 확인합니다. 외부 연동은 `@queuest/plugin-contracts`의 버전 있는 프로토콜과 [플러그인 아키텍처](./docs/plugin-architecture.md)를 기준으로 확장합니다.

## 미리보기

macOS 메뉴바에서 Queuest 아이콘을 클릭하면 열리는 게임형 퀘스트 팝오버입니다.

![Queuest macOS 메뉴바 팝오버 미리보기](./docs/images/queuest-menu-preview.png)

## 구조

```text
apps/desktop              Tauri 셸과 React UI
packages/domain           순수 도메인 모델과 계산 규칙
packages/ports            저장소·에이전트 포트
packages/plugin-contracts 외부 플러그인 manifest·프로토콜·정규화 타입
packages/plugin-sdk       외부 프로세스 플러그인용 JSON 프로토콜 SDK
packages/plugin-manager  플러그인 발견·검증·수명주기·stdio 전송 런타임
packages/adapter-sqlite   Tauri SQL 기반 로컬 SQLite 어댑터
packages/adapter-claude   claude -p 실행 어댑터
packages/adapter-github   기존 GitHub 경계 어댑터 (플러그인 전환 예정)
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
- 커밋·푸시·클라우드 동기화·팀 공유는 이 초기화 범위에 포함하지 않습니다.
