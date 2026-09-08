# Queuest

> Life is a queue of quests.

개인 프로젝트를 원정(프로젝트) → 스테이지(마일스톤) → 퀘스트(태스크)로 관리하는 macOS 메뉴바 앱입니다.

현재 레포는 `Tauri 2 + React + TypeScript + SQLite` 기반의 MVP 골격입니다. UI의 데모 데이터는 아직 저장소에 연결하지 않았고, 도메인 규칙과 외부 경계부터 분리해 두었습니다.

## 구조

```text
apps/desktop              Tauri 셸과 React UI
packages/domain           순수 도메인 모델과 계산 규칙
packages/ports            저장소·에이전트·외부 연동 포트
packages/adapter-sqlite   Tauri SQL 기반 로컬 SQLite 어댑터
packages/adapter-claude   claude -p 실행 어댑터
packages/adapter-github   gh issue list 가져오기 어댑터
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

## 범위 메모

- 엔티티 ID는 UUID 문자열을 사용합니다.
- 상태는 `todo → doing → review → done` 네 가지입니다. `blocked`는 플래그입니다.
- XP·레벨·스킬은 저장하지 않고 태스크와 마일스톤에서 계산합니다.
- AI 실행 결과는 `review`로 돌아오며 `done` 처리는 사람의 몫입니다.
- GitHub 연동은 외부에서 앱으로 가져오는 단방향 어댑터만 둡니다.
- 커밋·푸시·클라우드 동기화·팀 공유는 이 초기화 범위에 포함하지 않습니다.
