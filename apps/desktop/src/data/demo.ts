import type {
  Character,
  Loadout,
  Milestone,
  Project,
  Task,
  Workspace,
} from "@queuest/domain";

export const DEMO_WORKSPACE: Workspace = {
  id: "8b5ef4cf-6a66-4f2b-bc95-7e1f9bd3f401",
  name: "사이드 퀘스트",
};

export const DEMO_PROJECT: Project = {
  id: "9d1f4ab2-5ac5-43b5-88f0-26e17c9ef9b2",
  workspaceId: DEMO_WORKSPACE.id,
  name: "Queuest",
  skills: ["typescript", "tauri", "rust"],
};

export const DEMO_MILESTONES: Milestone[] = [
  {
    id: "a5c51dc7-5ca4-4c0b-8c7c-3ab3dc8d1a01",
    projectId: DEMO_PROJECT.id,
    name: "바닥 다지기",
    order: 1,
  },
  {
    id: "a5c51dc7-5ca4-4c0b-8c7c-3ab3dc8d1a02",
    projectId: DEMO_PROJECT.id,
    name: "앱의 심장",
    order: 2,
  },
  {
    id: "a5c51dc7-5ca4-4c0b-8c7c-3ab3dc8d1a03",
    projectId: DEMO_PROJECT.id,
    name: "첫 원정",
    order: 3,
  },
];

export const DEMO_TASKS: Task[] = [
  {
    id: "c7e2e124-82f9-4e26-9a79-111111111111",
    milestoneId: DEMO_MILESTONES[0].id,
    title: "앱 이름과 셸 결정",
    body: "Queuest와 Tauri 2를 프로젝트의 출발점으로 확정한다.",
    status: "done",
    assignee: "human",
    skills: ["research", "planning"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-222222222222",
    milestoneId: DEMO_MILESTONES[0].id,
    title: "Tauri 2 프로젝트 생성",
    body: "React와 TypeScript 프런트엔드가 Rust 셸 안에서 뜨도록 만든다.",
    status: "done",
    assignee: "human",
    skills: ["tauri", "rust"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-333333333333",
    milestoneId: DEMO_MILESTONES[0].id,
    title: "React 화면 진입점 만들기",
    body: "메뉴바에서 열리는 보드 화면의 기본 레이아웃을 잡는다.",
    status: "done",
    assignee: "human",
    skills: ["typescript", "react"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-444444444444",
    milestoneId: DEMO_MILESTONES[0].id,
    title: "SQLite 스키마 초안",
    body: "워크스페이스부터 태스크까지의 로컬 저장 경계를 준비한다.",
    status: "done",
    assignee: "human",
    skills: ["sqlite", "typescript"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-555555555555",
    milestoneId: DEMO_MILESTONES[0].id,
    title: "메뉴바 창 크기 결정",
    body: "420×640 팝오버 안에서 보드와 캐릭터 시트를 읽을 수 있게 한다.",
    status: "done",
    assignee: "human",
    skills: ["tauri", "design"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-666666666666",
    milestoneId: DEMO_MILESTONES[1].id,
    title: "원정 보드 화면",
    body: "스테이지 경로와 현재 스테이지의 퀘스트 카드를 연결한다.",
    status: "doing",
    assignee: "human",
    skills: ["typescript", "react", "css"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-777777777777",
    milestoneId: DEMO_MILESTONES[1].id,
    title: "태스크 상태 이동 연결",
    body: "사람이 카드의 상태를 다음 칸으로 넘길 수 있게 한다.",
    status: "todo",
    assignee: "human",
    skills: ["typescript"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-888888888888",
    milestoneId: DEMO_MILESTONES[1].id,
    title: "SQLite 저장소 연결",
    body: "데모 데이터 대신 로컬 데이터베이스를 읽고 쓰는 흐름을 연결한다.",
    status: "todo",
    assignee: "human",
    skills: ["sqlite", "rust"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-999999999999",
    milestoneId: DEMO_MILESTONES[2].id,
    title: "Claude 실행 어댑터 검증",
    body: "프로젝트 작업 디렉터리에서 claude -p를 호출하고 결과를 review로 돌려놓는다.",
    status: "todo",
    assignee: "human",
    skills: ["claude", "rust"],
    blocked: false,
  },
  {
    id: "c7e2e124-82f9-4e26-9a79-aaaaaaaaaaaa",
    milestoneId: DEMO_MILESTONES[2].id,
    title: "GitHub Issues 가져오기",
    body: "gh 인증을 재사용해 열린 이슈를 퀘스트 카드로 가져온다.",
    status: "todo",
    assignee: "human",
    skills: ["github", "typescript"],
    blocked: false,
  },
];

export const DEMO_CHARACTER: Character = {
  name: "Yoonho",
  job: "developer",
  spriteId: "developer",
};

export const DEMO_LOADOUT: Loadout = {
  projectId: DEMO_PROJECT.id,
  agentTool: "claude",
  sourceTool: "gh",
};
