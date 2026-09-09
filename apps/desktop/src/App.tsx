import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  githubIssueExternalRef,
  githubIssueToTask,
  listGithubIssues,
  type GithubIssue,
} from "@queuest/adapter-github";
import {
  activeTaskCount,
  advanceTaskStatus,
  canTransitionTaskStatus,
  calculateExperience,
  calculateLevel,
  calculateLevelProgress,
  calculateMilestoneProgress,
  calculateProjectProgress,
  calculateProjectStatus,
  calculateSkillSummaries,
  experienceToNextLevel,
  isMilestoneComplete,
  isMilestoneUnlocked,
  retreatTaskStatus,
  transitionTaskStatus,
} from "@queuest/domain";
import type {
  Assignee,
  Character,
  InboxTodo,
  Loadout,
  Milestone,
  PluginConnection,
  Project,
  ProjectGraph,
  ProjectTodo,
  Task,
  TaskStatus,
  Workspace,
} from "@queuest/domain";
import {
  deleteInboxTodo,
  loadInboxTodos,
  saveInboxTodo,
} from "./data/inbox";
import {
  createProject,
  deleteWorkspace,
  deleteLoadout,
  deleteMilestone,
  deleteProject,
  deleteTask,
  graphForProject,
  loadProjectGraphs,
  loadProjectTodos,
  loadWorkspaces,
  loadCharacter,
  saveCharacter,
  saveLoadout,
  saveTask,
  saveMilestone,
  saveProject,
  saveWorkspace,
  validateRepoPath,
  type NewProjectInput,
} from "./data/project";
import { discoverTools, type ToolDiscovery, type ToolInfo } from "./data/tools";
import {
  deletePluginConnection as deleteStoredPluginConnection,
  deletePluginCredential,
  loadPluginConnections,
  savePluginConnection as saveStoredPluginConnection,
  savePluginCredential,
} from "./data/plugin";
import "./App.css";

const STATUS_COLUMNS: Array<{ status: TaskStatus; label: string; hint: string }> = [
  { status: "todo", label: "대기", hint: "아직 시작하지 않은 퀘스트" },
  { status: "doing", label: "진행 중", hint: "지금 손을 대고 있는 퀘스트" },
  { status: "review", label: "검토 대기", hint: "AI 또는 작업 결과를 확인할 차례" },
  { status: "done", label: "완료", hint: "사람이 완주를 확인한 퀘스트" },
];

const PROJECT_STATUS_LABEL: Record<ReturnType<typeof calculateProjectStatus>, string> = {
  "not-started": "출발 전",
  active: "원정 중",
  complete: "완주",
};

const DEFAULT_CHARACTER: Character = {
  name: "Yoonho",
  job: "developer",
  spriteId: "developer",
};

const DEFAULT_LOADOUT: Loadout = {
  projectId: "",
  agentTool: "claude",
  sourceTool: "gh",
};

const JOB_LABEL: Record<Character["job"], string> = {
  developer: "개발자",
  planner: "기획자",
  designer: "디자이너",
};

const SPRITE_ART: Record<Character["job"], readonly string[]> = {
  developer: ["●", "╱▌╲", "╱ ╲"],
  planner: ["◆", "╱▌╲", "╱ ╲"],
  designer: ["✦", "╱▌╲", "╱ ╲"],
};

type AppView = "inbox" | "project-picker" | "project" | "character" | "plugins";
type ProjectLoadState = "idle" | "loading" | "ready" | "error";
type WorkspaceMutation = "create" | "update" | "delete" | null;

function App() {
  const [view, setView] = useState<AppView>("inbox");
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const previousViewRef = useRef<AppView>(view);
  const [todos, setTodos] = useState<InboxTodo[] | null>(null);
  const [projectTodos, setProjectTodos] = useState<ProjectTodo[] | null>(null);
  const [projectTodoLoadError, setProjectTodoLoadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [deletedTodo, setDeletedTodo] = useState<InboxTodo | null>(null);
  const [projectGraphs, setProjectGraphs] = useState<ProjectGraph[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [projectLoadState, setProjectLoadState] = useState<ProjectLoadState>("idle");
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [workspaceMutation, setWorkspaceMutation] = useState<WorkspaceMutation>(null);
  const [selectedProjectGraph, setSelectedProjectGraph] = useState<ProjectGraph | null>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (previousViewRef.current === view) {
      return;
    }

    previousViewRef.current = view;
    contentRef.current?.scrollTo(0, 0);
    if (view !== "project") {
      viewHeadingRef.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    let mounted = true;

    setTodos(null);
    setProjectTodos(null);
    setLoadError(null);
    setProjectTodoLoadError(null);
    setActionError(null);

    loadInboxTodos()
      .then((loadedTodos) => {
        if (mounted) {
          setTodos(loadedTodos);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setLoadError(readableError(error));
        }
      });

    loadProjectTodos()
      .then((loadedProjectTodos) => {
        if (mounted) {
          setProjectTodos(loadedProjectTodos);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setProjectTodoLoadError(readableError(error));
        }
      });

    return () => {
      mounted = false;
    };
  }, [reloadToken]);

  async function createTodo(title: string): Promise<boolean> {
    const todo: InboxTodo = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };

    setActionError(null);

    try {
      await saveInboxTodo(todo);
      setTodos((current) => (current ? [...current, todo] : [todo]));
      return true;
    } catch (error: unknown) {
      setActionError(readableError(error));
      return false;
    }
  }

  async function updateTodo(todo: InboxTodo): Promise<boolean> {
    setActionError(null);

    try {
      await saveInboxTodo(todo);
      setTodos((current) =>
        current ? current.map((item) => (item.id === todo.id ? todo : item)) : current,
      );
      return true;
    } catch (error: unknown) {
      setActionError(readableError(error));
      return false;
    }
  }

  async function removeTodo(todo: InboxTodo): Promise<boolean> {
    setActionError(null);

    try {
      await deleteInboxTodo(todo.id);
      setTodos((current) => (current ? current.filter((item) => item.id !== todo.id) : current));
      setDeletedTodo(todo);
      return true;
    } catch (error: unknown) {
      setActionError(readableError(error));
      return false;
    }
  }

  async function recoverTodo(): Promise<boolean> {
    if (!deletedTodo) {
      return false;
    }

    setActionError(null);

    try {
      await saveInboxTodo(deletedTodo);
      setTodos((current) =>
        [...(current ?? []), deletedTodo].sort(compareTodos),
      );
      setDeletedTodo(null);
      return true;
    } catch (error: unknown) {
      setActionError(readableError(error));
      return false;
    }
  }

  async function refreshProjectPickerData(): Promise<{
    graphs: ProjectGraph[];
    workspaces: Workspace[];
  }> {
    const [graphs, loadedWorkspaces] = await Promise.all([
      loadProjectGraphs(),
      loadWorkspaces(),
    ]);
    setProjectGraphs(graphs);
    setWorkspaces(loadedWorkspaces);
    setProjectLoadState("ready");
    return { graphs, workspaces: loadedWorkspaces };
  }

  async function loadExistingProjects(): Promise<void> {
    setProjectLoadState("loading");
    setProjectLoadError(null);
    setActionError(null);

    try {
      await refreshProjectPickerData();
    } catch (error: unknown) {
      setProjectLoadState("error");
      setProjectLoadError(readableError(error));
    }
  }

  function selectProject(graph: ProjectGraph) {
    setSelectedProjectGraph(graph);
    setView("project");
  }

  function backToInbox() {
    setSelectedProjectGraph(null);
    setProjectGraphs(null);
    setWorkspaces(null);
    setProjectLoadState("idle");
    setProjectLoadError(null);
    setReloadToken((current) => current + 1);
    setView("inbox");
  }

  function backToProjectPicker() {
    setSelectedProjectGraph(null);
    setProjectGraphs(null);
    setWorkspaces(null);
    setProjectLoadState("idle");
    setProjectLoadError(null);
    setView("project-picker");
  }

  function openProjectPicker(projectId?: string) {
    setActionError(null);
    if (projectId) {
      setProjectLoadState("loading");
      setProjectLoadError(null);
      setView("project-picker");
      void (async () => {
        try {
          const { graphs } = await refreshProjectPickerData();
          const graph = graphForProject(graphs, projectId);
          if (!graph) {
            throw new Error("프로젝트를 다시 불러오지 못했습니다.");
          }
          selectProject(graph);
        } catch (error: unknown) {
          setProjectLoadState("error");
          setProjectLoadError(readableError(error));
          setActionError(readableError(error));
        }
      })();
      return;
    }
    setView("project-picker");
  }

  async function togglePinned(): Promise<void> {
    const nextPinned = !pinned;

    try {
      await invoke("set_window_pinned", { pinned: nextPinned });
      setPinned(nextPinned);
    } catch (error: unknown) {
      setActionError(readableError(error));
    }
  }

  async function openSourceUrl(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch (error: unknown) {
      setActionError(`원본 링크를 열지 못했습니다: ${readableError(error)}`);
    }
  }

  async function finishCreateWorkspace(name: string): Promise<Workspace | null> {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim(),
    };
    setWorkspaceMutation("create");
    setProjectLoadError(null);
    setActionError(null);

    try {
      await saveWorkspace(workspace);
      await refreshProjectPickerData();
      return workspace;
    } catch (error: unknown) {
      setProjectLoadError(readableError(error));
      setActionError(readableError(error));
      if (!projectGraphs) {
        setProjectLoadState("error");
      }
      return null;
    } finally {
      setWorkspaceMutation(null);
    }
  }

  async function finishUpdateWorkspace(workspace: Workspace): Promise<Workspace | null> {
    setWorkspaceMutation("update");
    setProjectLoadError(null);
    setActionError(null);

    try {
      await saveWorkspace(workspace);
      await refreshProjectPickerData();
      return workspace;
    } catch (error: unknown) {
      setProjectLoadError(readableError(error));
      setActionError(readableError(error));
      return null;
    } finally {
      setWorkspaceMutation(null);
    }
  }

  async function finishDeleteWorkspace(workspaceId: string): Promise<boolean> {
    setWorkspaceMutation("delete");
    setProjectLoadError(null);
    setActionError(null);

    try {
      await deleteWorkspace(workspaceId);
      await refreshProjectPickerData();
      return true;
    } catch (error: unknown) {
      setProjectLoadError(readableError(error));
      setActionError(readableError(error));
      return false;
    } finally {
      setWorkspaceMutation(null);
    }
  }

  async function finishCreateProject(input: NewProjectInput): Promise<boolean> {
    setProjectLoadState("loading");
    setProjectLoadError(null);
    setActionError(null);

    try {
      const repoPath = input.repoPath?.trim();
      if (repoPath) {
        await validateRepoPath(repoPath);
      }

      const created = await createProject({
        ...input,
        ...(repoPath ? { repoPath } : {}),
      });
      const { graphs } = await refreshProjectPickerData();
      const graph = graphForProject(graphs, created.project.id);
      if (!graph) {
        throw new Error("새 프로젝트를 다시 불러오지 못했습니다.");
      }

      selectProject(graph);
      return true;
    } catch (error: unknown) {
      setProjectLoadState("error");
      const message = readableError(error);
      setProjectLoadError(message);
      setActionError(message);
      return false;
    }
  }

  if (view === "project" && selectedProjectGraph) {
    return (
      <ProjectBoard
        key={selectedProjectGraph.project.id}
        graph={selectedProjectGraph}
        pinned={pinned}
        onTogglePinned={() => void togglePinned()}
        onBackToInbox={backToInbox}
        onProjectDeleted={backToProjectPicker}
        onOpenCharacter={() => {
          setSelectedProjectGraph(null);
          setView("character");
        }}
        windowError={actionError}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        todoCount={todos?.filter((todo) => !todo.completed).length ?? 0}
        pinned={pinned}
        onTogglePinned={() => void togglePinned()}
        onOpenProject={openProjectPicker}
      />
      <AppNavigation active={view} onNavigate={(next) => next === "project" ? openProjectPicker() : setView(next)} />
      <main className="main-content" ref={contentRef}>
        {view === "character" ? <CharacterHome /> : view === "plugins" ? <PluginsPanel onOpenProject={openProjectPicker} /> : view === "project-picker" ? (
          <ProjectPicker
            headingRef={viewHeadingRef}
            onBack={() => setView("inbox")}
            projectGraphs={projectGraphs}
            workspaces={workspaces}
            projectLoadState={projectLoadState}
            projectLoadError={projectLoadError}
            actionError={actionError}
            workspaceMutating={workspaceMutation !== null}
            firstTodoTitle={todos?.find((todo) => !todo.completed)?.title}
            onLoadExisting={loadExistingProjects}
            onSelectProject={selectProject}
            onCreateProject={finishCreateProject}
            onCreateWorkspace={finishCreateWorkspace}
            onUpdateWorkspace={finishUpdateWorkspace}
            onDeleteWorkspace={finishDeleteWorkspace}
            onClearError={() => {
              setProjectLoadError(null);
              setActionError(null);
            }}
          />
        ) : loadError ? (
          <LoadErrorState
            message={loadError}
            onRetry={() => setReloadToken((current) => current + 1)}
          />
        ) : todos === null ? (
          <LoadingState />
        ) : (
          <TodoInbox
            headingRef={viewHeadingRef}
            todos={todos}
            actionError={actionError}
            deletedTodo={deletedTodo}
            onCreate={createTodo}
            onUpdate={updateTodo}
            onDelete={removeTodo}
            onRecover={recoverTodo}
            onClearActionError={() => setActionError(null)}
            onOpenProject={openProjectPicker}
            onOpenSource={openSourceUrl}
            projectTodos={projectTodos}
            projectTodoLoadError={projectTodoLoadError}
          />
        )}
      </main>
    </div>
  );
}

function readableError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "로컬 저장소와 통신하지 못했습니다. 잠시 후 다시 시도하세요.";
}

function AppNavigation({ active, onNavigate }: {
  active: AppView;
  onNavigate: (view: "inbox" | "project" | "character" | "plugins") => void;
}) {
  return (
    <nav className="app-navigation" aria-label="주요 화면">
      {([['inbox', '할 일'], ['project', '프로젝트'], ['character', '캐릭터'], ['plugins', '플러그인']] as const).map(([id, label]) => (
        <button type="button" key={id}
          aria-current={active === id || (id === "project" && active === "project-picker") ? "page" : undefined}
          onClick={() => onNavigate(id)}>{label}</button>
      ))}
    </nav>
  );
}

function CharacterHome() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [graphs, setGraphs] = useState<ProjectGraph[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([loadCharacter(), loadProjectGraphs()])
      .then(([value, loadedGraphs]) => {
        if (!cancelled) {
          setCharacter(value ?? DEFAULT_CHARACTER);
          setGraphs(loadedGraphs);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(readableError(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [reload]);
  const progress = character && graphs
    ? calculateGlobalCharacterProgress(graphs, character)
    : undefined;

  return (
    <section className="character-home character-sheet" aria-labelledby="profile-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GLOBAL CHARACTER</p>
          <h2 id="profile-title" tabIndex={-1}>나의 캐릭터</h2>
        </div>
        <span className="sheet-rule">전체 프로젝트</span>
      </div>
      <p className="page-description">캐릭터는 하나로 유지되고, 경험치와 스킬은 모든 프로젝트의 완료 기록에서 계산됩니다.</p>
      {error && (
        <div className="action-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button>
        </div>
      )}
      {loading && <p role="status">캐릭터와 원정 기록을 불러오는 중…</p>}
      {character && progress && (
        <>
          {editing ? (
            <CharacterSettingsPanel
              character={character}
              submitting={saving}
              onClose={() => setEditing(false)}
              onSubmit={async (next) => {
                setSaving(true);
                setError(null);
                try {
                  await saveCharacter(next);
                  setCharacter(next);
                  setEditing(false);
                  return true;
                } catch (reason: unknown) {
                  setError(readableError(reason));
                  return false;
                } finally {
                  setSaving(false);
                }
              }}
            />
          ) : (
            <div className="character-home-actions">
              <button className="primary-button" type="button" onClick={() => setEditing(true)}>
                캐릭터 편집
              </button>
            </div>
          )}

          <div className="character-summary">
            <CharacterSprite character={character} />
            <div className="character-copy">
              <div className="character-name-row">
                <h3>{character.name}</h3>
                <span className="job-badge">{JOB_LABEL[character.job]}</span>
              </div>
              <p>Lv. {progress.level} 원정대원</p>
              <div className="xp-row">
                <span>XP {progress.experience}</span>
                <span>다음 레벨까지 {progress.experienceToNextLevel}</span>
              </div>
              <div
                className="xp-track"
                role="progressbar"
                aria-label={`경험치 ${progress.experience}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.levelProgress}
              >
                <span aria-hidden="true" style={{ width: `${progress.levelProgress}%` }} />
              </div>
            </div>
          </div>

          <div className="sheet-grid">
            <div className="skill-panel">
              <div className="panel-heading">
                <h3>스킬</h3>
                <span>전체 완료 태스크 기준</span>
              </div>
              <div className="skill-list">
                {progress.skills.length > 0 ? progress.skills.map((skill) => (
                  <div className={`skill-row ${skill.emphasized ? "emphasized" : ""}`} key={skill.name}>
                    <div className="skill-label">
                      <span>{skill.name}</span>
                      <strong>{skill.level}</strong>
                    </div>
                    <div
                      className="skill-track"
                      role="progressbar"
                      aria-label={`${skill.name} 레벨 ${skill.level}`}
                      aria-valuemin={0}
                      aria-valuemax={5}
                      aria-valuenow={skill.level}
                    >
                      <span aria-hidden="true" style={{ width: `${Math.min(100, skill.level * 20)}%` }} />
                    </div>
                  </div>
                )) : <p className="panel-empty">완료한 태스크가 쌓이면 스킬이 나타납니다.</p>}
              </div>
            </div>

            <div className="character-stats-panel">
              <div className="panel-heading">
                <h3>활동 기록</h3>
                <span>모든 원정</span>
              </div>
              <dl className="character-stat-list">
                <div><dt>프로젝트</dt><dd>{progress.projectCount}</dd></div>
                <div><dt>진행 중</dt><dd>{progress.activeTaskCount}</dd></div>
                <div><dt>완료 퀘스트</dt><dd>{progress.completedTaskCount}</dd></div>
              </dl>
            </div>
          </div>

          <section className="character-projects" aria-labelledby="character-projects-title">
            <div className="panel-heading">
              <h3 id="character-projects-title">원정 기록</h3>
              <span>{progress.projects.length}개</span>
            </div>
            <div className="character-project-list">
              {progress.projects.length > 0 ? progress.projects.map((item) => (
                <div className="character-project-row" key={item.project.id}>
                  <div>
                    <strong>{item.project.name}</strong>
                    <small>{item.completedTaskCount}/{item.taskCount} 퀘스트 완료</small>
                  </div>
                  <span>{item.progress}%</span>
                </div>
              )) : <p className="panel-empty">프로젝트를 열면 원정 기록이 여기에 표시됩니다.</p>}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

interface GlobalCharacterProgress {
  experience: number;
  level: number;
  levelProgress: number;
  experienceToNextLevel: number;
  completedTaskCount: number;
  activeTaskCount: number;
  projectCount: number;
  skills: ReturnType<typeof calculateSkillSummaries>;
  projects: Array<{
    project: Project;
    progress: number;
    completedTaskCount: number;
    taskCount: number;
  }>;
}

function calculateGlobalCharacterProgress(
  graphs: ProjectGraph[],
  character: Character,
): GlobalCharacterProgress {
  const experience = graphs.reduce(
    (total, graph) => total + calculateExperience(graph.milestones, graph.tasks),
    0,
  );
  const skillsByName = new Map<string, ReturnType<typeof calculateSkillSummaries>[number]>();
  for (const graph of graphs) {
    for (const skill of calculateSkillSummaries(graph.project, graph.milestones, graph.tasks, character)) {
      const existing = skillsByName.get(skill.name);
      skillsByName.set(skill.name, existing
        ? { ...existing, level: existing.level + skill.level }
        : skill);
    }
  }
  const projects = graphs.map((graph) => ({
    project: graph.project,
    progress: calculateProjectProgress(graph.milestones, graph.tasks),
    completedTaskCount: graph.tasks.filter((task) => task.status === "done").length,
    taskCount: graph.tasks.length,
  })).sort((left, right) => left.project.name.localeCompare(right.project.name));

  return {
    experience,
    level: calculateLevel(experience),
    levelProgress: calculateLevelProgress(experience),
    experienceToNextLevel: experienceToNextLevel(experience),
    completedTaskCount: graphs.reduce(
      (total, graph) => total + graph.tasks.filter((task) => task.status === "done").length,
      0,
    ),
    activeTaskCount: graphs.reduce((total, graph) => total + activeTaskCount(graph.tasks), 0),
    projectCount: graphs.length,
    skills: [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    projects,
  };
}

type ConnectorId =
  | "github"
  | "jira"
  | "google-calendar"
  | "apple-calendar"
  | "apple-reminders";

type ConnectorCredentialKind = "token" | "jira" | "calendar" | "none";

interface ConnectorDefinition {
  id: ConnectorId;
  pluginId: string;
  name: string;
  description: string;
  credentialKind: ConnectorCredentialKind;
}

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "github",
    pluginId: "com.queuest.github",
    name: "GitHub",
    description: "저장소의 이슈와 작업을 확인합니다.",
    credentialKind: "token",
  },
  {
    id: "jira",
    pluginId: "com.queuest.jira",
    name: "Jira",
    description: "Jira Cloud 이슈를 확인합니다.",
    credentialKind: "jira",
  },
  {
    id: "google-calendar",
    pluginId: "com.queuest.calendar",
    name: "Google Calendar",
    description: "캘린더와 일정을 확인합니다.",
    credentialKind: "calendar",
  },
  {
    id: "apple-calendar",
    pluginId: "com.queuest.apple-calendar",
    name: "Apple Calendar",
    description: "Mac의 캘린더 일정을 확인합니다.",
    credentialKind: "none",
  },
  {
    id: "apple-reminders",
    pluginId: "com.queuest.apple-reminders",
    name: "Apple Reminders",
    description: "Mac의 미리 알림을 확인합니다.",
    credentialKind: "none",
  },
];

interface PluginConnectionDraft {
  connectionId: string;
  label: string;
  config: Record<string, string>;
  credential: string;
}

interface PluginConnectionEditorProps {
  connector: ConnectorDefinition;
  connection?: PluginConnection;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (draft: PluginConnectionDraft) => Promise<boolean>;
  onDelete?: () => void;
}

function PluginConnectionEditor({
  connector,
  connection,
  submitting,
  onCancel,
  onSubmit,
  onDelete,
}: PluginConnectionEditorProps) {
  const [connectionId, setConnectionId] = useState(
    () => connection?.connectionId ?? `${connector.id}-${crypto.randomUUID().slice(0, 8)}`,
  );
  const [label, setLabel] = useState(
    () => connection?.label ?? `${connector.name} 연결`,
  );
  const [config, setConfig] = useState<Record<string, string>>(
    () => connection?.config ?? {},
  );
  const [credential, setCredential] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function setConfigValue(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await onSubmit({ connectionId, label, config, credential });
    if (!result) {
      setValidationError("입력값을 확인하세요.");
    }
  }

  const hasStoredCredential = connection?.credentialStored ?? false;

  return (
    <section className="plugin-connection-editor editor-panel" aria-labelledby="connection-editor-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{connection ? "EDIT CONNECTION" : "NEW CONNECTION"}</p>
          <h3 id="connection-editor-title">{connector.name} 연결 설정</h3>
        </div>
        <span className="section-note">{connector.pluginId}</span>
      </div>
      <form onSubmit={submit}>
        <div className="editor-grid">
          <label>
            연결 이름
            <input
              type="text"
              value={label}
              onChange={(event) => { setLabel(event.target.value); setValidationError(null); }}
              placeholder={`예: ${connector.name} 개인 계정`}
              disabled={submitting}
            />
          </label>
          <label>
            연결 ID
            <input
              type="text"
              value={connectionId}
              onChange={(event) => { setConnectionId(event.target.value); setValidationError(null); }}
              disabled={submitting || Boolean(connection)}
            />
            {!connection && <span className="field-hint">영문, 숫자, ., -, _만 사용할 수 있습니다.</span>}
          </label>
        </div>

        {connector.id === "github" && (
          <label>
            저장소
            <input
              type="text"
              value={config.repository ?? ""}
              onChange={(event) => setConfigValue("repository", event.target.value)}
              placeholder="owner/repository"
              disabled={submitting}
            />
            <span className="field-hint">플러그인 조회에 사용할 기본 저장소입니다. 프로젝트의 gh 가져오기는 작업 폴더 설정을 따릅니다.</span>
          </label>
        )}

        {connector.id === "jira" && (
          <>
            <div className="editor-grid">
              <label>
                Jira 사이트 URL
                <input
                  type="url"
                  value={config.siteUrl ?? ""}
                  onChange={(event) => setConfigValue("siteUrl", event.target.value)}
                  placeholder="https://example.atlassian.net"
                  disabled={submitting}
                />
              </label>
              <label>
                계정 이메일
                <input
                  type="email"
                  value={config.email ?? ""}
                  onChange={(event) => setConfigValue("email", event.target.value)}
                  placeholder="account@example.com"
                  disabled={submitting}
                />
              </label>
            </div>
            <label>
              프로젝트 키
              <input
                type="text"
                value={config.projectKey ?? ""}
                onChange={(event) => setConfigValue("projectKey", event.target.value)}
                placeholder="QUEUEST"
                disabled={submitting}
              />
            </label>
          </>
        )}

        {(connector.id === "google-calendar" || connector.id === "apple-calendar") && (
          <label>
            캘린더 ID
            <textarea
              value={config.calendarIds ?? ""}
              onChange={(event) => setConfigValue("calendarIds", event.target.value)}
              placeholder={connector.id === "google-calendar" ? "primary\ncalendar-id@group.calendar.google.com" : "캘린더 식별자"}
              disabled={submitting}
            />
            <span className="field-hint">한 줄에 하나씩 입력합니다.</span>
          </label>
        )}

        {connector.id === "apple-reminders" && (
          <p className="settings-subsection field-hint">
            Apple Reminders는 별도 토큰 없이 macOS EventKit 권한과 이 연결 ID를 사용합니다.
          </p>
        )}

        {connector.credentialKind !== "none" ? (
          <label>
            {connector.credentialKind === "jira" ? "Jira API token" : connector.id === "google-calendar" ? "OAuth access token" : "Personal access token"}
            <input
              type="password"
              value={credential}
              onChange={(event) => { setCredential(event.target.value); setValidationError(null); }}
              placeholder={hasStoredCredential ? "입력하지 않으면 현재 credential 유지" : "credential 입력"}
              autoComplete="new-password"
              disabled={submitting}
            />
            <span className="field-hint">SQLite에는 저장하지 않고 macOS Keychain에만 저장합니다.</span>
          </label>
        ) : (
          <p className="settings-subsection field-hint">
            macOS 권한 상태는 연결 확인 시 EventKit에서 읽습니다. 이 설정에는 비밀 값이 없습니다.
          </p>
        )}

        {validationError && <p className="validation-note" role="alert">{validationError}</p>}
        <div className="form-actions settings-actions">
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "저장 중…" : "연결 저장"}
          </button>
          <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>취소</button>
          {connection && onDelete && (
            <button className="danger-button" type="button" onClick={onDelete} disabled={submitting}>연결 삭제</button>
          )}
        </div>
      </form>
    </section>
  );
}

interface PluginsPanelProps {
  onOpenProject?: () => void;
}

function PluginsPanel({ onOpenProject }: PluginsPanelProps) {
  const [tools, setTools] = useState<ToolDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<PluginConnection[] | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionEditor, setConnectionEditor] = useState<{
    connector: ConnectorDefinition;
    connection?: PluginConnection;
  } | null>(null);
  const [connectionMutation, setConnectionMutation] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setScanning(true); setError(null);
    discoverTools().then((value) => { if (!cancelled) setTools(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(readableError(reason)); })
      .finally(() => { if (!cancelled) setScanning(false); });
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    setConnectionError(null);
    loadPluginConnections()
      .then((value) => { if (!cancelled) setConnections(value); })
      .catch((reason: unknown) => { if (!cancelled) setConnectionError(readableError(reason)); });
    return () => { cancelled = true; };
  }, []);

  function openConnectionEditor(connector: ConnectorDefinition, connection?: PluginConnection) {
    setConnectionError(null);
    setConnectionEditor({ connector, ...(connection ? { connection } : {}) });
  }

  async function saveConnectionDraft(
    connector: ConnectorDefinition,
    draft: PluginConnectionDraft,
  ): Promise<boolean> {
    const connectionId = draft.connectionId.trim();
    const label = draft.label.trim();
    const config = Object.fromEntries(
      Object.entries(draft.config)
        .map(([key, value]) => [
          key,
          key === "calendarIds"
            ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).join("\n")
            : value.trim(),
        ])
        .filter(([, value]) => value.length > 0),
    );
    const current = connectionEditor?.connection;

    if (!connectionId || !/^[A-Za-z0-9._-]+$/.test(connectionId)) {
      setConnectionError("연결 ID는 영문, 숫자, ., -, _만 사용할 수 있습니다.");
      return false;
    }
    if (!label) {
      setConnectionError("연결 이름을 입력하세요.");
      return false;
    }
    if (connector.id === "github" && !config.repository) {
      setConnectionError("GitHub 저장소를 입력하세요.");
      return false;
    }
    if (connector.id === "jira" && (!config.siteUrl || !config.email || !config.projectKey)) {
      setConnectionError("Jira 사이트 URL, 계정 이메일, 프로젝트 키를 입력하세요.");
      return false;
    }
    if ((connector.id === "google-calendar" || connector.id === "apple-calendar") && !config.calendarIds) {
      setConnectionError("캘린더 ID를 하나 이상 입력하세요.");
      return false;
    }

    const credential = draft.credential.trim();
    if (connector.credentialKind !== "none" && !credential && !current?.credentialStored) {
      setConnectionError("credential을 입력하세요.");
      return false;
    }

    let credentialValue = "";
    if (credential) {
      if (connector.id === "jira") {
        credentialValue = JSON.stringify({
          siteUrl: config.siteUrl,
          email: config.email,
          apiToken: credential,
        });
      } else if (connector.id === "google-calendar") {
        credentialValue = JSON.stringify({ accessToken: credential });
      } else {
        credentialValue = credential;
      }
    }

    const mutationKey = `${connector.pluginId}:${connectionId}`;
    setConnectionMutation(mutationKey);
    setConnectionError(null);
    let credentialWritten = false;
    try {
      if (credentialValue) {
        await savePluginCredential(connector.pluginId, connectionId, credentialValue);
        credentialWritten = true;
      }
      const nextConnection: PluginConnection = {
        pluginId: connector.pluginId,
        connectionId,
        label,
        config,
        credentialStored: connector.credentialKind === "none"
          ? false
          : Boolean(credentialValue) || Boolean(current?.credentialStored),
        updatedAt: new Date().toISOString(),
      };
      try {
        await saveStoredPluginConnection(nextConnection);
      } catch (reason: unknown) {
        if (credentialWritten && !current?.credentialStored) {
          await deletePluginCredential(connector.pluginId, connectionId).catch(() => undefined);
        }
        throw reason;
      }
      setConnections(await loadPluginConnections());
      setConnectionEditor(null);
      return true;
    } catch (reason: unknown) {
      setConnectionError(readableError(reason));
      return false;
    } finally {
      setConnectionMutation(null);
    }
  }

  async function removeConnection(connector: ConnectorDefinition, connection: PluginConnection) {
    if (!window.confirm(`'${connection.label}' 연결을 삭제할까요?`)) {
      return;
    }
    const mutationKey = `${connector.pluginId}:${connection.connectionId}`;
    setConnectionMutation(mutationKey);
    setConnectionError(null);
    try {
      if (connection.credentialStored) {
        await deletePluginCredential(connection.pluginId, connection.connectionId);
      }
      await deleteStoredPluginConnection(connection.pluginId, connection.connectionId);
      setConnections(await loadPluginConnections());
      setConnectionEditor(null);
    } catch (reason: unknown) {
      setConnectionError(readableError(reason));
    } finally {
      setConnectionMutation(null);
    }
  }

  return <section aria-labelledby="plugins-title">
    <p className="eyebrow">CONNECTIONS & TOOLS</p>
    <h2 id="plugins-title">플러그인과 도구</h2>
    <p className="page-description">외부 서비스와 로컬 도구를 한곳에서 확인하세요.</p>
    <div className="section-heading"><h3>로컬 도구</h3><button className="small-button" type="button" disabled={scanning} onClick={() => setReload((value) => value + 1)}>{scanning ? "확인 중…" : "다시 확인"}</button></div>
    {error && <p className="action-error" role="alert">{error}</p>}
    {scanning && <p role="status">설치 및 인증 상태를 확인하는 중…</p>}
    {tools && <div className="plugin-list">{([tools.claude, tools.gh, tools.jj]).map((tool) => <article className="plugin-card" key={tool.id}>
      <div className="section-heading"><h3>{tool.id}</h3><span className={`tool-tag ${tool.installed && tool.authenticated !== false ? "equipped" : "warning"}`}>{toolStatusLabel(tool)}</span></div>
      <p>{tool.id === "claude" ? "프로젝트의 AI 작업 실행 도구" : tool.id === "gh" ? "GitHub 이슈 가져오기 도구" : "로컬 버전 관리 도구"}</p>
      {tool.path && <code>{tool.path}</code>}
    </article>)}</div>}
    <h3>서비스 플러그인</h3>
    <p className="page-description">연결 프로필은 SQLite에 저장하고, API token과 access token은 macOS Keychain에 보관합니다.</p>
    {connectionError && <p className="action-error" role="alert">{connectionError}</p>}
    {connectionEditor && (
      <PluginConnectionEditor
        key={`${connectionEditor.connector.pluginId}:${connectionEditor.connection?.connectionId ?? "new"}`}
        connector={connectionEditor.connector}
        connection={connectionEditor.connection}
        submitting={connectionMutation !== null}
        onCancel={() => setConnectionEditor(null)}
        onSubmit={(draft) => saveConnectionDraft(connectionEditor.connector, draft)}
        onDelete={connectionEditor.connection
          ? () => void removeConnection(connectionEditor.connector, connectionEditor.connection!)
          : undefined}
      />
    )}
    {connections === null && <p role="status">저장된 연결을 불러오는 중…</p>}
    <div className="plugin-list">{CONNECTORS.map((connector) => {
      const connectorConnections = connections?.filter((connection) => connection.pluginId === connector.pluginId) ?? [];
      const hasMissingCredential = connector.credentialKind !== "none"
        && connectorConnections.some((connection) => !connection.credentialStored);
      const status = connectorConnections.length === 0
        ? connector.id === "github" ? "가져오기 사용 가능" : "미연결"
        : hasMissingCredential ? "credential 필요" : "설정됨";
      const statusClass = connectorConnections.length === 0
        ? connector.id === "github" ? "equipped" : "muted"
        : hasMissingCredential ? "warning" : "equipped";
      return <article className="plugin-card" key={connector.id}>
        <div className="section-heading"><h3>{connector.name}</h3><span className={`tool-tag ${statusClass}`}>{status}</span></div>
        <p>{connector.id === "github" ? "프로젝트 작업 폴더와 gh 인증을 사용해 이슈를 선택한 스테이지의 퀘스트로 가져옵니다." : connector.description}</p>
        <div className="plugin-card-actions">
          <button className="secondary-button" type="button" onClick={() => openConnectionEditor(connector)}>연결 추가</button>
          {connector.id === "github" && onOpenProject && <button className="secondary-button" type="button" onClick={() => onOpenProject()}>프로젝트에서 GitHub 사용</button>}
        </div>
        {connectorConnections.length > 0 && (
          <div className="plugin-connection-list" aria-label={`${connector.name} 저장된 연결`}>
            {connectorConnections.map((connection) => {
              const mutationKey = `${connection.pluginId}:${connection.connectionId}`;
              return <div className="plugin-connection-row" key={mutationKey}>
                <div>
                  <strong>{connection.label}</strong>
                  <small>{connection.connectionId} · {connection.credentialStored ? "credential 저장됨" : "macOS 권한만 사용"}</small>
                </div>
                <button className="small-button" type="button" onClick={() => openConnectionEditor(connector, connection)} disabled={connectionMutation === mutationKey}>편집</button>
              </div>;
            })}
          </div>
        )}
      </article>;
    })}</div>
  </section>;
}

function compareTodos(left: InboxTodo, right: InboxTodo): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function parseSkillText(value: string): string[] {
  return [...new Set(value.split(",").map((skill) => skill.trim()).filter(Boolean))];
}

function skillText(skills: string[]): string {
  return skills.join(", ");
}

interface AppHeaderProps {
  todoCount: number;
  pinned: boolean;
  onTogglePinned: () => void;
  onOpenProject: () => void;
}

function AppHeader({ todoCount, pinned, onTogglePinned, onOpenProject }: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          Q
        </div>
        <div>
          <p className="eyebrow">TODO-FIRST QUEST BOARD</p>
          <h1>Queuest</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="active-counter" title="완료하지 않은 인박스 할 일 수">
          <span aria-hidden="true">◆</span> {todoCount}
        </span>
        <button
          className={`icon-button pin-button ${pinned ? "active" : ""}`}
          type="button"
          aria-label={pinned ? "팝오버 고정 해제" : "팝오버 고정"}
          aria-pressed={pinned}
          title={pinned ? "팝오버 고정 해제" : "포커스를 잃어도 팝오버 유지"}
          onClick={onTogglePinned}
        >
          {pinned ? "고정됨" : "고정"}
        </button>
        <button className="topbar-project-button" type="button" onClick={onOpenProject}>
          프로젝트
        </button>
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <section className="state-panel" role="status" aria-live="polite">
      <span className="state-mark loading-mark" aria-hidden="true">…</span>
      <p className="eyebrow">LOADING INBOX</p>
      <h2>인박스를 준비하는 중</h2>
      <p>로컬 저장소에서 할 일을 불러오고 있습니다.</p>
    </section>
  );
}

interface LoadErrorStateProps {
  message: string;
  onRetry: () => void;
}

function LoadErrorState({ message, onRetry }: LoadErrorStateProps) {
  return (
    <section className="state-panel error-state" role="alert">
      <span className="state-mark" aria-hidden="true">!</span>
      <p className="eyebrow">INBOX UNAVAILABLE</p>
      <h2>인박스를 열지 못했습니다</h2>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>
        다시 불러오기
      </button>
    </section>
  );
}

interface TodoInboxProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  todos: InboxTodo[];
  actionError: string | null;
  deletedTodo: InboxTodo | null;
  onCreate: (title: string) => Promise<boolean>;
  onUpdate: (todo: InboxTodo) => Promise<boolean>;
  onDelete: (todo: InboxTodo) => Promise<boolean>;
  onRecover: () => Promise<boolean>;
  onClearActionError: () => void;
  onOpenProject: (projectId?: string) => void;
  onOpenSource: (url: string) => Promise<void>;
  projectTodos: ProjectTodo[] | null;
  projectTodoLoadError: string | null;
}

function TodoInbox({
  headingRef,
  todos,
  actionError,
  deletedTodo,
  onCreate,
  onUpdate,
  onDelete,
  onRecover,
  onClearActionError,
  onOpenProject,
  onOpenSource,
  projectTodos,
  projectTodoLoadError,
}: TodoInboxProps) {
  const [draftTitle, setDraftTitle] = useState("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draftTitle.trim();

    if (!title) {
      setValidationError("할 일 제목을 입력하세요.");
      return;
    }

    setValidationError(null);
    if (await onCreate(title)) {
      setDraftTitle("");
    }
  }

  function beginEdit(todo: InboxTodo) {
    setValidationError(null);
    setEditingTodoId(todo.id);
    setEditingTitle(todo.title);
  }

  function cancelEdit() {
    setEditingTodoId(null);
    setEditingTitle("");
  }

  async function commitEdit(todo: InboxTodo) {
    const title = editingTitle.trim();
    if (!title) {
      setValidationError("할 일 제목을 입력하세요.");
      return;
    }

    setValidationError(null);
    if (await onUpdate({ ...todo, title })) {
      cancelEdit();
    }
  }

  return (
    <>
      <section className="inbox-intro" aria-labelledby="inbox-title">
        <div>
          <p className="eyebrow">PERSONAL INBOX</p>
          <h2 id="inbox-title" ref={headingRef} tabIndex={-1}>먼저, 할 일을 모아두세요</h2>
          <p className="inbox-lede">
            프로젝트를 고르기 전에도 생각을 놓치지 않도록 기록할 수 있습니다.
          </p>
        </div>
        <span className="workspace-chip">로컬 저장소</span>
      </section>

      <section className="todo-compose" aria-labelledby="compose-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">QUICK CAPTURE</p>
            <h2 id="compose-title">새 할 일</h2>
          </div>
          <span className="section-note">Enter로 저장</span>
        </div>
        <form className="todo-form" onSubmit={handleCreate}>
          <label className="sr-only" htmlFor="new-todo-title">새 할 일 제목</label>
          <input
            id="new-todo-title"
            type="text"
            value={draftTitle}
            placeholder="예: 다음 원정 아이디어 적기"
            onChange={(event) => {
              setDraftTitle(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
          />
          <button className="primary-button" type="submit">추가</button>
        </form>
        {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      </section>

      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={onClearActionError}>닫기</button>
        </div>
      )}

      {todos.length === 0 ? (
        <section className="state-panel empty-state" aria-labelledby="empty-title">
          <span className="state-mark" aria-hidden="true">＋</span>
          <p className="eyebrow">INBOX CLEAR</p>
          <h2 id="empty-title">아직 적어둔 할 일이 없습니다</h2>
          <p>위 입력창에 첫 생각을 적으면 여기에 차곡차곡 쌓입니다.</p>
        </section>
      ) : (
        <section className="todo-list-panel" aria-labelledby="todo-list-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">QUEUE</p>
              <h2 id="todo-list-title">내 인박스</h2>
            </div>
            <span className="section-note">{todos.length}개</span>
          </div>
          <div className="todo-list">
            {[...todos].sort(compareTodos).map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                editing={editingTodoId === todo.id}
                editingTitle={editingTitle}
                onToggle={() => onUpdate({ ...todo, completed: !todo.completed })}
                onEdit={() => beginEdit(todo)}
                onDelete={() => onDelete(todo)}
                onChangeTitle={setEditingTitle}
                onSaveEdit={() => commitEdit(todo)}
                onCancelEdit={cancelEdit}
              />
            ))}
          </div>
        </section>
      )}

      <section className="project-todo-panel" aria-labelledby="project-todo-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PROJECT QUEUE</p>
            <h2 id="project-todo-title">프로젝트의 할 일</h2>
          </div>
          <span className="section-note">{projectTodos?.length ?? 0}개</span>
        </div>
        {projectTodoLoadError ? (
          <p className="validation-note" role="alert">프로젝트 할 일을 불러오지 못했습니다: {projectTodoLoadError}</p>
        ) : projectTodos === null ? (
          <p className="panel-empty" role="status">프로젝트 할 일을 불러오는 중…</p>
        ) : projectTodos.length === 0 ? (
          <p className="panel-empty">프로젝트를 만들고 퀘스트를 추가하면 이곳에서도 볼 수 있습니다.</p>
        ) : (
          <div className="todo-list project-todo-list">
            {projectTodos.map((item) => (
              <ProjectTodoRow
                key={item.task.id}
                item={item}
                onOpen={() => onOpenProject(item.project.id)}
                onOpenSource={item.task.sourceUrl ? () => void onOpenSource(item.task.sourceUrl!) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {deletedTodo && (
        <div className="undo-bar" role="status" aria-live="polite">
          <span>“{deletedTodo.title}”을(를) 삭제했습니다.</span>
          <button type="button" onClick={() => void onRecover()}>되돌리기</button>
        </div>
      )}

      <section className="project-next-step" aria-labelledby="project-next-title">
        <div>
          <p className="eyebrow">NEXT WHEN READY</p>
          <h2 id="project-next-title">프로젝트에서 이어가기</h2>
          <p>할 일을 정리할 준비가 되면 원정과 스테이지를 열어보세요.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => onOpenProject()}>
          프로젝트 열기 또는 만들기
        </button>
      </section>
    </>
  );
}

interface TodoRowProps {
  todo: InboxTodo;
  editing: boolean;
  editingTitle: string;
  onToggle: () => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  onChangeTitle: (title: string) => void;
  onSaveEdit: () => Promise<void>;
  onCancelEdit: () => void;
}

function TodoRow({
  todo,
  editing,
  editingTitle,
  onToggle,
  onEdit,
  onDelete,
  onChangeTitle,
  onSaveEdit,
  onCancelEdit,
}: TodoRowProps) {
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const previousEditingRef = useRef(editing);

  useEffect(() => {
    if (previousEditingRef.current && !editing) {
      editButtonRef.current?.focus();
    }

    previousEditingRef.current = editing;
  }, [editing]);

  return (
    <article className={`todo-row ${todo.completed ? "completed" : ""}`}>
      <button
        className="todo-check"
        type="button"
        aria-label={`${todo.title}, ${todo.completed ? "완료 취소" : "완료 처리"}`}
        aria-pressed={todo.completed}
        onClick={() => void onToggle()}
      >
        <span aria-hidden="true">{todo.completed ? "✓" : ""}</span>
      </button>
      {editing ? (
        <form
          className="todo-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveEdit();
          }}
        >
          <label className="sr-only" htmlFor={`edit-todo-${todo.id}`}>할 일 제목 수정</label>
          <input
            id={`edit-todo-${todo.id}`}
            type="text"
            value={editingTitle}
            autoFocus
            onChange={(event) => onChangeTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onCancelEdit();
              }
            }}
          />
          <button className="row-action save" type="submit">저장</button>
          <button className="row-action" type="button" onClick={onCancelEdit}>취소</button>
        </form>
      ) : (
        <div className="todo-copy">
          <span className="todo-title">{todo.title}</span>
          <span className="todo-meta">{todo.completed ? "완료" : "대기"}</span>
        </div>
      )}
      {!editing && (
        <div className="todo-actions">
          <button className="row-action" ref={editButtonRef} type="button" onClick={onEdit}>편집</button>
          <button className="row-action danger" type="button" onClick={() => void onDelete()}>삭제</button>
        </div>
      )}
    </article>
  );
}

interface ProjectTodoRowProps {
  item: ProjectTodo;
  onOpen: () => void;
  onOpenSource?: () => void;
}

function ProjectTodoRow({ item, onOpen, onOpenSource }: ProjectTodoRowProps) {
  const statusLabel = STATUS_COLUMNS.find((column) => column.status === item.task.status)?.label ?? item.task.status;

  return (
    <article className={`todo-row project-todo-row ${item.task.status === "done" ? "completed" : ""}`}>
      <span className={`project-todo-status ${item.task.status}`} aria-label={`프로젝트 태스크 상태: ${statusLabel}`}>
        {item.task.status === "done" ? "✓" : "◆"}
      </span>
      <div className="todo-copy">
        <span className="todo-title">{item.task.title}</span>
        <span className="todo-meta">{item.project.name} · {item.milestone.name} · {statusLabel}</span>
      </div>
      <div className="todo-actions">
        {onOpenSource && <button className="row-action" type="button" onClick={onOpenSource}>원본</button>}
        <button className="row-action" type="button" onClick={onOpen}>프로젝트 열기</button>
      </div>
    </article>
  );
}

interface ProjectPickerProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  projectGraphs: ProjectGraph[] | null;
  workspaces: Workspace[] | null;
  projectLoadState: ProjectLoadState;
  projectLoadError: string | null;
  actionError: string | null;
  workspaceMutating: boolean;
  firstTodoTitle?: string;
  onLoadExisting: () => Promise<void>;
  onSelectProject: (graph: ProjectGraph) => void;
  onCreateProject: (input: NewProjectInput) => Promise<boolean>;
  onCreateWorkspace: (name: string) => Promise<Workspace | null>;
  onUpdateWorkspace: (workspace: Workspace) => Promise<Workspace | null>;
  onDeleteWorkspace: (workspaceId: string) => Promise<boolean>;
  onClearError: () => void;
}

function ProjectPicker({
  headingRef,
  onBack,
  projectGraphs,
  workspaces,
  projectLoadState,
  projectLoadError,
  actionError,
  workspaceMutating,
  firstTodoTitle,
  onLoadExisting,
  onSelectProject,
  onCreateProject,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onClearError,
}: ProjectPickerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [workspaceEditor, setWorkspaceEditor] = useState<{ workspace?: Workspace } | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const previousProjectLoadStateRef = useRef(projectLoadState);

  useEffect(() => {
    if (
      previousProjectLoadStateRef.current === "loading" &&
      projectLoadState !== "loading"
    ) {
      headingRef.current?.focus();
    }

    previousProjectLoadStateRef.current = projectLoadState;
  }, [headingRef, projectLoadState]);

  useEffect(() => {
    if (!workspaces) {
      return;
    }

    if (selectedWorkspaceId && workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return;
    }

    setSelectedWorkspaceId(workspaces[0]?.id ?? null);
  }, [selectedWorkspaceId, workspaces]);

  const selectedWorkspace = workspaces?.find((workspace) => workspace.id === selectedWorkspaceId);
  const visibleProjectGraphs = projectGraphs?.filter(
    (graph) => graph.workspace.id === selectedWorkspace?.id,
  ) ?? [];

  function openProjectCreateForm() {
    if (selectedWorkspace) {
      setShowCreateForm(true);
      return;
    }

    setWorkspaceEditor({});
  }

  async function saveWorkspaceName(name: string): Promise<Workspace | null> {
    if (!workspaceEditor) {
      return null;
    }

    const saved = workspaceEditor.workspace
      ? await onUpdateWorkspace({ ...workspaceEditor.workspace, name })
      : await onCreateWorkspace(name);

    if (saved) {
      setSelectedWorkspaceId(saved.id);
      setWorkspaceEditor(null);
    }

    return saved;
  }

  async function removeWorkspace(): Promise<void> {
    if (!workspaceToDelete) {
      return;
    }

    if (await onDeleteWorkspace(workspaceToDelete.id)) {
      setWorkspaceToDelete(null);
      setShowCreateForm(false);
    }
  }

  return (
    <section
      className="project-picker"
      aria-labelledby="project-picker-title"
      aria-busy={projectLoadState === "loading"}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">PROJECT GATE</p>
          <h2 id="project-picker-title" ref={headingRef} tabIndex={-1}>어디서 이어갈까요?</h2>
        </div>
        <span className="workspace-chip">
          {workspaces ? `${workspaces.length}개 워크스페이스` : "선택 후 로드"}
        </span>
      </div>
      <p className="project-picker-lede">
        워크스페이스를 고른 뒤 프로젝트를 열거나, 새 워크스페이스와 원정을 차례로 만들 수 있습니다.
      </p>

      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={onClearError}>닫기</button>
        </div>
      )}

      {workspaceEditor && (
        <WorkspaceEditor
          workspace={workspaceEditor.workspace}
          submitting={workspaceMutating}
          onCancel={() => setWorkspaceEditor(null)}
          onSubmit={saveWorkspaceName}
        />
      )}

      {showCreateForm && selectedWorkspace ? (
        <ProjectCreateForm
          key={selectedWorkspace.id}
          workspace={selectedWorkspace}
          initialTaskTitle={firstTodoTitle}
          submitting={projectLoadState === "loading"}
          onCancel={() => setShowCreateForm(false)}
          onSubmit={(input) => onCreateProject({ ...input, workspaceId: selectedWorkspace.id })}
        />
      ) : projectLoadState === "loading" ? (
        <ProjectLoadingState />
      ) : projectLoadState === "error" ? (
        <section className="state-panel error-state" role="alert">
          <span className="state-mark" aria-hidden="true">!</span>
          <p className="eyebrow">PROJECTS UNAVAILABLE</p>
          <h2>프로젝트를 불러오지 못했습니다</h2>
          <p>{projectLoadError ?? "로컬 저장소와 통신하지 못했습니다."}</p>
          <div className="state-actions">
            <button className="primary-button" type="button" onClick={() => void onLoadExisting()}>
              다시 불러오기
            </button>
            <button className="secondary-button" type="button" onClick={() => setWorkspaceEditor({})}>
              새 워크스페이스 만들기
            </button>
          </div>
        </section>
      ) : projectLoadState === "ready" ? (
        <>
          <section className="workspace-manager" aria-labelledby="workspace-manager-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WORKSPACES</p>
                <h2 id="workspace-manager-title">워크스페이스</h2>
              </div>
              <button
                className="small-button accent"
                type="button"
                onClick={() => setWorkspaceEditor({})}
                disabled={workspaceMutating}
              >
                + 워크스페이스
              </button>
            </div>
            {workspaces && workspaces.length > 0 ? (
              <div className="workspace-list" role="list" aria-label="워크스페이스 목록">
                {workspaces.map((workspace) => {
                  const projectCount = projectGraphs?.filter(
                    (graph) => graph.workspace.id === workspace.id,
                  ).length ?? 0;
                  const selected = workspace.id === selectedWorkspace?.id;

                  return (
                    <div className={`workspace-row ${selected ? "selected" : ""}`} key={workspace.id} role="listitem">
                      <button
                        className="workspace-select"
                        type="button"
                        aria-pressed={selected}
                        disabled={workspaceMutating}
                        onClick={() => {
                          setSelectedWorkspaceId(workspace.id);
                          setShowCreateForm(false);
                        }}
                      >
                        <span className="workspace-select-icon" aria-hidden="true">⌂</span>
                        <span className="workspace-select-copy">
                          <strong>{workspace.name}</strong>
                          <small>{projectCount}개 프로젝트</small>
                        </span>
                      </button>
                      <div className="workspace-row-actions">
                        <button
                          className="row-action"
                          type="button"
                          disabled={workspaceMutating}
                          onClick={() => setWorkspaceEditor({ workspace })}
                        >
                          편집
                        </button>
                        <button
                          className="row-action danger"
                          type="button"
                          disabled={workspaceMutating}
                          onClick={() => setWorkspaceToDelete(workspace)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="workspace-empty">아직 워크스페이스가 없습니다. 첫 작업 공간을 만들어 보세요.</p>
            )}
          </section>

          {selectedWorkspace && visibleProjectGraphs.length > 0 ? (
            <section className="project-list-panel" aria-labelledby="saved-projects-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">SAVED PROJECTS · {selectedWorkspace.name}</p>
                  <h2 id="saved-projects-title">프로젝트 선택</h2>
                </div>
                <span className="section-note">{visibleProjectGraphs.length}개</span>
              </div>
              <div className="project-list">
                {visibleProjectGraphs.map((graph) => (
                  <button
                    className="project-list-card"
                    key={graph.project.id}
                    type="button"
                    onClick={() => onSelectProject(graph)}
                  >
                    <span className="project-choice-icon" aria-hidden="true">✦</span>
                    <span className="project-list-copy">
                      <span className="eyebrow">{graph.workspace.name}</span>
                      <strong>{graph.project.name}</strong>
                      <span>{graph.milestones.length}개 스테이지 · {graph.tasks.length}개 퀘스트</span>
                    </span>
                    <span className="project-list-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
              <button className="secondary-button project-create-link" type="button" onClick={openProjectCreateForm}>
                + 새 프로젝트 만들기
              </button>
            </section>
          ) : selectedWorkspace ? (
            <section className="state-panel no-project-state" aria-labelledby="no-project-title">
              <span className="state-mark" aria-hidden="true">✦</span>
              <p className="eyebrow">WORKSPACE READY</p>
              <h2 id="no-project-title">{selectedWorkspace.name}에 프로젝트가 없습니다</h2>
              <p>이 워크스페이스에 첫 원정을 만들면 보드가 열립니다.</p>
              <div className="state-actions">
                <button className="primary-button" type="button" onClick={openProjectCreateForm}>
                  새 프로젝트 만들기
                </button>
                <button className="secondary-button" type="button" onClick={() => setWorkspaceEditor({})}>
                  워크스페이스 추가
                </button>
              </div>
            </section>
          ) : (
            <section className="state-panel no-project-state" aria-labelledby="no-workspace-title">
              <span className="state-mark" aria-hidden="true">⌂</span>
              <p className="eyebrow">NO WORKSPACE YET</p>
              <h2 id="no-workspace-title">워크스페이스를 먼저 만들어 주세요</h2>
              <p>프로젝트와 스테이지를 담을 첫 작업 공간이 필요합니다.</p>
              <button className="primary-button" type="button" onClick={() => setWorkspaceEditor({})}>
                새 워크스페이스 만들기
              </button>
            </section>
          )}
        </>
      ) : (
        <section className="state-panel no-project-state" aria-labelledby="no-project-title">
          <span className="state-mark" aria-hidden="true">⌂</span>
          <p className="eyebrow">NO WORKSPACE SELECTED</p>
          <h2 id="no-project-title">아직 워크스페이스를 고르지 않았습니다</h2>
          <p>기존 워크스페이스를 불러오거나 새 작업 공간을 만들어 보드로 이동하세요.</p>
          <div className="state-actions">
            <button className="primary-button" type="button" onClick={() => void onLoadExisting()}>
              기존 워크스페이스 불러오기
            </button>
            <button className="secondary-button" type="button" onClick={() => setWorkspaceEditor({})}>
              새 워크스페이스 만들기
            </button>
          </div>
        </section>
      )}

      <button className="back-link" type="button" onClick={onBack}>← 인박스로 돌아가기</button>

      {workspaceToDelete && (
        <ConfirmDialog
          title="워크스페이스를 삭제할까요?"
          message={`“${workspaceToDelete.name}”의 프로젝트 ${projectGraphs?.filter((graph) => graph.workspace.id === workspaceToDelete.id).length ?? 0}개와 하위 데이터가 함께 삭제됩니다.`}
          confirmLabel="워크스페이스 삭제"
          busy={workspaceMutating}
          onCancel={() => setWorkspaceToDelete(null)}
          onConfirm={removeWorkspace}
        />
      )}
    </section>
  );
}

interface WorkspaceEditorProps {
  workspace?: Workspace;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<Workspace | null>;
}

function WorkspaceEditor({ workspace, submitting, onCancel, onSubmit }: WorkspaceEditorProps) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("워크스페이스 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit(trimmedName);
  }

  return (
    <form className="editor-panel workspace-editor" onSubmit={handleSubmit} aria-labelledby="workspace-editor-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">WORKSPACE EDITOR</p>
          <h2 id="workspace-editor-title">{workspace ? "워크스페이스 편집" : "새 워크스페이스"}</h2>
        </div>
        <span className="section-note">SQLite에 저장</span>
      </div>
      <label>
        워크스페이스 이름
        <input
          type="text"
          value={name}
          autoFocus
          disabled={submitting}
          placeholder="예: 개인 프로젝트"
          onChange={(event) => {
            setName(event.target.value);
            if (validationError) {
              setValidationError(null);
            }
          }}
        />
      </label>
      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "저장 중…" : workspace ? "변경 저장" : "워크스페이스 만들기"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
          취소
        </button>
      </div>
    </form>
  );
}

interface ProjectCreateFormProps {
  workspace: Workspace;
  initialTaskTitle?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: NewProjectInput) => Promise<boolean>;
}

function ProjectCreateForm({
  workspace,
  initialTaskTitle,
  submitting,
  onCancel,
  onSubmit,
}: ProjectCreateFormProps) {
  const [name, setName] = useState("");
  const [firstTaskTitle, setFirstTaskTitle] = useState(initialTaskTitle ?? "");
  const [repoPath, setRepoPath] = useState("");
  const [skills, setSkills] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("프로젝트 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit({
      name: trimmedName,
      firstTaskTitle: firstTaskTitle.trim() || undefined,
      repoPath: repoPath.trim() || undefined,
      skills: parseSkillText(skills),
    });
  }

  return (
    <form className="project-create-form" onSubmit={handleSubmit}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">NEW EXPEDITION</p>
          <h2>새 프로젝트 만들기</h2>
        </div>
        <span className="section-note">{workspace.name} · SQLite에 저장</span>
      </div>
      <label htmlFor="project-name">프로젝트 이름</label>
      <input
        id="project-name"
        type="text"
        value={name}
        autoFocus
        disabled={submitting}
        placeholder="예: Queuest"
        onChange={(event) => {
          setName(event.target.value);
          if (validationError) {
            setValidationError(null);
          }
        }}
      />
      <label htmlFor="first-task-title">첫 퀘스트 <span>(선택)</span></label>
      <input
        id="first-task-title"
        type="text"
        value={firstTaskTitle}
        disabled={submitting}
        placeholder="인박스의 할 일을 첫 퀘스트로 복사할 수 있습니다"
        onChange={(event) => setFirstTaskTitle(event.target.value)}
      />
      <label htmlFor="new-project-repo-path">작업 폴더 <span>(선택)</span></label>
      <input
        id="new-project-repo-path"
        type="text"
        value={repoPath}
        disabled={submitting}
        placeholder="/Users/me/Projects/queuest"
        onChange={(event) => setRepoPath(event.target.value)}
      />
      <label htmlFor="new-project-skills">프로젝트 스킬 <span>(선택)</span></label>
      <input
        id="new-project-skills"
        type="text"
        value={skills}
        disabled={submitting}
        placeholder="typescript, tauri, rust"
        onChange={(event) => setSkills(event.target.value)}
      />
      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "저장 중…" : "프로젝트 만들기"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>취소</button>
      </div>
    </form>
  );
}

function ProjectLoadingState() {
  return (
    <section className="state-panel" role="status" aria-live="polite">
      <span className="state-mark loading-mark" aria-hidden="true">…</span>
      <p className="eyebrow">LOADING PROJECTS</p>
      <h2>프로젝트를 준비하는 중</h2>
      <p>선택할 프로젝트 그래프를 로컬 저장소에서 불러오고 있습니다.</p>
    </section>
  );
}

interface TaskDraft {
  milestoneId: string;
  title: string;
  body: string;
  assignee: Assignee;
  skills: string[];
  blocked: boolean;
}

interface TaskEditorProps {
  task?: Task;
  defaultMilestoneId: string;
  milestones: Milestone[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (draft: TaskDraft) => Promise<boolean>;
}

function TaskEditor({
  task,
  defaultMilestoneId,
  milestones,
  submitting,
  onCancel,
  onSubmit,
}: TaskEditorProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? defaultMilestoneId);
  const [assignee, setAssignee] = useState<Assignee>(task?.assignee ?? "human");
  const [skills, setSkills] = useState(skillText(task?.skills ?? []));
  const [blocked, setBlocked] = useState(task?.blocked ?? false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setValidationError("퀘스트 제목을 입력하세요.");
      return;
    }

    if (!milestoneId) {
      setValidationError("퀘스트를 담을 스테이지를 선택하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit({
      milestoneId,
      title: trimmedTitle,
      body: body.trim(),
      assignee,
      skills: parseSkillText(skills),
      blocked,
    });
  }

  return (
    <form className="editor-panel task-editor" onSubmit={handleSubmit} aria-labelledby="task-editor-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">QUEST EDITOR</p>
          <h2 id="task-editor-title">{task ? "퀘스트 편집" : "새 퀘스트"}</h2>
        </div>
        <span className="section-note">SQLite에 저장</span>
      </div>

      <div className="editor-grid">
        <label>
          퀘스트 제목
          <input
            type="text"
            value={title}
            autoFocus
            disabled={submitting}
            placeholder="예: 첫 화면 설계하기"
            onChange={(event) => {
              setTitle(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
          />
        </label>
        <label>
          스테이지
          <select
            value={milestoneId}
            disabled={submitting || milestones.length === 0}
            onChange={(event) => setMilestoneId(event.target.value)}
          >
            {milestones.map((milestone) => (
              <option value={milestone.id} key={milestone.id}>
                {milestone.order}. {milestone.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        본문
        <textarea
          value={body}
          disabled={submitting}
          rows={3}
          placeholder="완료 조건이나 작업 메모를 적습니다"
          onChange={(event) => setBody(event.target.value)}
        />
      </label>

      <div className="editor-grid">
        <label>
          담당
          <select
            value={assignee}
            disabled={submitting}
            onChange={(event) => setAssignee(event.target.value as Assignee)}
          >
            <option value="human">나</option>
            <option value="ai">AI</option>
          </select>
        </label>
        <label>
          스킬 태그
          <input
            type="text"
            value={skills}
            disabled={submitting}
            placeholder="typescript, planning"
            onChange={(event) => setSkills(event.target.value)}
          />
        </label>
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={blocked}
          disabled={submitting}
          onChange={(event) => setBlocked(event.target.checked)}
        />
        <span>막힌 퀘스트로 표시</span>
      </label>

      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting || milestones.length === 0}>
          {submitting ? "저장 중…" : task ? "변경 저장" : "퀘스트 추가"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
          취소
        </button>
      </div>
    </form>
  );
}

interface MilestoneEditorProps {
  milestone?: Milestone;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}

function MilestoneEditor({ milestone, submitting, onCancel, onSubmit }: MilestoneEditorProps) {
  const [name, setName] = useState(milestone?.name ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("스테이지 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit(trimmedName);
  }

  return (
    <form className="editor-panel compact-editor" onSubmit={handleSubmit} aria-labelledby="milestone-editor-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAGE EDITOR</p>
          <h2 id="milestone-editor-title">{milestone ? "스테이지 편집" : "새 스테이지"}</h2>
        </div>
      </div>
      <label>
        스테이지 이름
        <input
          type="text"
          value={name}
          autoFocus
          disabled={submitting}
          placeholder="예: 앱의 심장"
          onChange={(event) => {
            setName(event.target.value);
            if (validationError) {
              setValidationError(null);
            }
          }}
        />
      </label>
      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "저장 중…" : milestone ? "변경 저장" : "스테이지 추가"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
          취소
        </button>
      </div>
    </form>
  );
}

interface ProjectSettingsDraft {
  name: string;
  repoPath: string;
  skills: string[];
  loadout: Pick<Loadout, "agentTool" | "sourceTool">;
}

interface ProjectSettingsPanelProps {
  project: Project;
  loadout: Loadout;
  tools: ToolDiscovery | null;
  toolLoadError: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (draft: ProjectSettingsDraft) => Promise<boolean>;
  onRefreshTools: () => Promise<void>;
  onDelete: () => void;
}

function ProjectSettingsPanel({
  project,
  loadout,
  tools,
  toolLoadError,
  submitting,
  onClose,
  onSubmit,
  onRefreshTools,
  onDelete,
}: ProjectSettingsPanelProps) {
  const [name, setName] = useState(project.name);
  const [repoPath, setRepoPath] = useState(project.repoPath ?? "");
  const [skills, setSkills] = useState(skillText(project.skills));
  const [agentTool, setAgentTool] = useState<Loadout["agentTool"]>(loadout.agentTool);
  const [sourceTool, setSourceTool] = useState<Loadout["sourceTool"]>(loadout.sourceTool);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("프로젝트 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    const saved = await onSubmit({
      name: trimmedName,
      repoPath: repoPath.trim(),
      skills: parseSkillText(skills),
      loadout: { agentTool, sourceTool },
    });
    if (!saved) {
      setValidationError("프로젝트 설정을 저장하지 못했습니다.");
    }
  }

  return (
    <form className="editor-panel project-settings" onSubmit={handleSubmit} aria-labelledby="project-settings-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">EXPEDITION SETTINGS</p>
          <h2 id="project-settings-title">프로젝트 설정</h2>
        </div>
        <span className="section-note">경로 저장 전 폴더 확인</span>
      </div>

      <label>
        프로젝트 이름
        <input
          type="text"
          value={name}
          autoFocus
          disabled={submitting}
          onChange={(event) => {
            setName(event.target.value);
            if (validationError) {
              setValidationError(null);
            }
          }}
        />
      </label>
      <label>
        작업 폴더 (`repoPath`)
        <input
          type="text"
          value={repoPath}
          disabled={submitting}
          placeholder="/Users/me/Projects/queuest"
          onChange={(event) => setRepoPath(event.target.value)}
        />
        <small className="field-hint">비워두면 AI와 GitHub 기능이 비활성화됩니다.</small>
      </label>
      <label>
        프로젝트 스킬
        <input
          type="text"
          value={skills}
          disabled={submitting}
          placeholder="typescript, tauri, rust"
          onChange={(event) => setSkills(event.target.value)}
        />
      </label>

      <div className="settings-subsection">
        <div className="panel-heading">
          <h3>프로젝트 장비</h3>
          <button className="row-action" type="button" onClick={() => void onRefreshTools()} disabled={submitting}>
            PATH 다시 스캔
          </button>
        </div>
        <div className="editor-grid">
          <label>
            에이전트
            <select
              value={agentTool ?? ""}
              disabled={submitting}
              onChange={(event) => setAgentTool(event.target.value === "claude" ? "claude" : undefined)}
            >
              <option value="">장비 없음</option>
              <option value="claude" disabled={tools?.claude.installed === false}>
                claude · {toolStatusLabel(tools?.claude)}
              </option>
            </select>
          </label>
          <label>
            소스
            <select
              value={sourceTool ?? ""}
              disabled={submitting}
              onChange={(event) => setSourceTool(event.target.value === "gh" ? "gh" : undefined)}
            >
              <option value="">장비 없음</option>
              <option
                value="gh"
                disabled={tools?.gh.installed === false || tools?.gh.authenticated === false}
              >
                gh · {toolStatusLabel(tools?.gh)}
              </option>
            </select>
          </label>
        </div>
        <p className="field-hint">
          {toolLoadError ?? "설치되지 않았거나 인증되지 않은 도구는 장착할 수 없습니다."}
        </p>
      </div>

      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions settings-actions">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "확인 중…" : "설정 저장"}
        </button>
        <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
          닫기
        </button>
        <button className="danger-button" type="button" onClick={onDelete} disabled={submitting}>
          프로젝트 삭제
        </button>
      </div>
    </form>
  );
}

function toolStatusLabel(tool: ToolInfo | undefined): string {
  if (!tool) {
    return "확인 중";
  }

  if (!tool.installed) {
    return "미설치";
  }

  if (tool.authenticated === false) {
    return "인증 필요";
  }

  return "준비됨";
}

interface CharacterSettingsPanelProps {
  character: Character;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (character: Character) => Promise<boolean>;
}

function CharacterSettingsPanel({
  character,
  submitting,
  onClose,
  onSubmit,
}: CharacterSettingsPanelProps) {
  const [name, setName] = useState(character.name);
  const [job, setJob] = useState<Character["job"]>(character.job);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("캐릭터 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit({ name: trimmedName, job, spriteId: job });
  }

  return (
    <form className="editor-panel character-settings" onSubmit={handleSubmit} aria-labelledby="character-settings-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CHARACTER SETTINGS</p>
          <h2 id="character-settings-title">캐릭터 설정</h2>
        </div>
        <span className="section-note">이름 · 직업 · 스프라이트</span>
      </div>
      <div className="editor-grid">
        <label>
          캐릭터 이름
          <input
            type="text"
            value={name}
            autoFocus
            disabled={submitting}
            onChange={(event) => {
              setName(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
          />
        </label>
        <label>
          직업
          <select
            value={job}
            disabled={submitting}
            onChange={(event) => setJob(event.target.value as Character["job"])}
          >
            <option value="developer">{JOB_LABEL.developer} · 개발 스프라이트</option>
            <option value="planner">{JOB_LABEL.planner} · 기획 스프라이트</option>
            <option value="designer">{JOB_LABEL.designer} · 디자인 스프라이트</option>
          </select>
        </label>
      </div>
      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "저장 중…" : "캐릭터 저장"}
        </button>
        <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
          닫기
        </button>
      </div>
    </form>
  );
}

interface GithubImportPanelProps {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  tools: ToolDiscovery | null;
  defaultMilestoneId?: string;
  submitting: boolean;
  onCancel: () => void;
  onImport: (issues: GithubIssue[], milestoneId: string) => Promise<boolean>;
}

function GithubImportPanel({
  project,
  milestones,
  tasks,
  tools,
  defaultMilestoneId,
  submitting,
  onCancel,
  onImport,
}: GithubImportPanelProps) {
  const [issues, setIssues] = useState<GithubIssue[] | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ?? milestones[0]?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const existingRefs = useMemo(
    () => new Set(tasks.flatMap((task) => task.externalRef ? [task.externalRef] : [])),
    [tasks],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listGithubIssues(project)
      .then((loadedIssues) => {
        if (cancelled) {
          return;
        }
        setIssues(loadedIssues);
        setSelectedRefs(new Set(
          loadedIssues
            .filter((issue) => !existingRefs.has(githubIssueExternalRef(issue)))
            .map(githubIssueExternalRef),
        ));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(readableError(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [existingRefs, project]);

  function toggleIssue(issue: GithubIssue): void {
    const ref = githubIssueExternalRef(issue);
    setSelectedRefs((current) => {
      const next = new Set(current);
      if (next.has(ref)) {
        next.delete(ref);
      } else if (!existingRefs.has(ref)) {
        next.add(ref);
      }
      return next;
    });
  }

  function selectAllNewIssues(): void {
    setSelectedRefs(new Set(
      (issues ?? [])
        .filter((issue) => !existingRefs.has(githubIssueExternalRef(issue)))
        .map(githubIssueExternalRef),
    ));
  }

  async function handleImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const selectedIssues = (issues ?? []).filter((issue) => selectedRefs.has(githubIssueExternalRef(issue)));
    if (!milestoneId) {
      setError("가져올 대상 스테이지를 선택하세요.");
      return;
    }
    if (selectedIssues.length === 0) {
      setError("가져올 새 GitHub 이슈를 하나 이상 선택하세요.");
      return;
    }

    setError(null);
    if (!(await onImport(selectedIssues, milestoneId))) {
      setError("GitHub 이슈를 저장하지 못했습니다.");
    }
  }

  async function openIssue(issue: GithubIssue): Promise<void> {
    try {
      await openUrl(issue.url);
    } catch (reason: unknown) {
      setError(`원본 링크를 열지 못했습니다: ${readableError(reason)}`);
    }
  }

  const ghUnavailable = tools?.gh.installed === false;
  const ghNeedsAuth = tools?.gh.authenticated === false;

  return (
    <form className="editor-panel github-import-panel" onSubmit={(event) => void handleImport(event)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">GITHUB PLUGIN</p>
          <h2>GitHub 이슈 가져오기</h2>
        </div>
        <span className="section-note">읽기 전용</span>
      </div>
      <p className="field-hint">
        {project.repoPath ? `${project.repoPath}의 이슈를 선택한 스테이지에 퀘스트로 저장합니다.` : "프로젝트 작업 폴더가 필요합니다."}
      </p>
      {ghUnavailable && <p className="validation-note" role="alert">gh가 설치되어 있지 않습니다.</p>}
      {ghNeedsAuth && <p className="validation-note" role="alert">gh 인증이 필요합니다. 터미널에서 `gh auth login`을 먼저 실행하세요.</p>}
      <label>
        가져올 스테이지
        <select value={milestoneId} disabled={submitting || milestones.length === 0} onChange={(event) => setMilestoneId(event.target.value)}>
          {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}
        </select>
      </label>
      <div className="import-toolbar">
        <span className="section-note">
          {selectedRefs.size}개 선택 · {issues?.length ?? 0}개 발견
        </span>
        <button className="small-button" type="button" disabled={loading || submitting || !issues} onClick={selectAllNewIssues}>
          새 이슈 모두 선택
        </button>
      </div>
      {error && <p className="validation-note" role="alert">{error}</p>}
      {loading ? (
        <p className="panel-empty" role="status">GitHub 이슈를 불러오는 중…</p>
      ) : issues && issues.length > 0 ? (
        <div className="github-issue-list" role="list" aria-label="GitHub 이슈 목록">
          {issues.map((issue) => {
            const ref = githubIssueExternalRef(issue);
            const duplicate = existingRefs.has(ref);
            return (
              <div className={`github-issue-row ${duplicate ? "duplicate" : ""}`} key={ref} role="listitem">
                <label className="github-issue-select">
                  <input
                    type="checkbox"
                    checked={selectedRefs.has(ref)}
                    disabled={duplicate || submitting}
                    onChange={() => toggleIssue(issue)}
                  />
                  <span className="github-issue-copy">
                    <strong>{issue.title}</strong>
                    <small>{issue.state === "CLOSED" ? "닫힘" : "열림"}{duplicate ? " · 이미 가져옴" : ""}</small>
                  </span>
                </label>
                <button className="row-action" type="button" onClick={() => void openIssue(issue)}>원본</button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="panel-empty">가져올 GitHub 이슈가 없습니다.</p>
      )}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={submitting || loading || selectedRefs.size === 0}>
          {submitting ? "저장 중…" : `${selectedRefs.size}개 가져오기`}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>취소</button>
      </div>
    </form>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <p className="eyebrow">CONFIRM ACTION</p>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="form-actions">
          <button
            className="danger-button"
            type="button"
            ref={confirmButtonRef}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
        </div>
      </section>
    </div>
  );
}

interface ProjectBoardProps {
  windowError: string | null;
  graph: ProjectGraph;
  pinned: boolean;
  onTogglePinned: () => void;
  onBackToInbox: () => void;
  onProjectDeleted: () => void;
  onOpenCharacter: () => void;
}

function ProjectBoard({ graph, pinned, onTogglePinned, onBackToInbox, onProjectDeleted, onOpenCharacter, windowError }: ProjectBoardProps) {
  const [section, setSection] = useState<"project" | "plugins">("project");
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [section]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [project, setProject] = useState<Project>(graph.project);
  const [milestones, setMilestones] = useState<Milestone[]>(() =>
    [...graph.milestones].sort((left, right) => left.order - right.order),
  );
  const [tasks, setTasks] = useState<Task[]>(graph.tasks);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    graph.milestones[0]?.id ?? null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<"task" | "milestone" | "project" | null>(null);
  const [taskEditor, setTaskEditor] = useState<{
    task?: Task;
    milestoneId: string;
  } | null>(null);
  const [milestoneEditor, setMilestoneEditor] = useState<{ milestone?: Milestone } | null>(null);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [githubImportOpen, setGithubImportOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [milestoneToDelete, setMilestoneToDelete] = useState<Milestone | null>(null);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [loadout, setLoadout] = useState<Loadout>(
    graph.loadout ?? { ...DEFAULT_LOADOUT, projectId: project.id },
  );
  const [tools, setTools] = useState<ToolDiscovery | null>(null);
  const [toolLoadError, setToolLoadError] = useState<string | null>(null);

  const orderedMilestones = useMemo(
    () => [...milestones].sort((left, right) => left.order - right.order),
    [milestones],
  );
  const selectedMilestone =
    orderedMilestones.find((milestone) => milestone.id === selectedMilestoneId) ??
    orderedMilestones[0];
  const selectedMilestoneIndex = selectedMilestone
    ? orderedMilestones.findIndex((milestone) => milestone.id === selectedMilestone.id)
    : -1;
  const projectProgress = calculateProjectProgress(orderedMilestones, tasks);
  const projectStatus = calculateProjectStatus(orderedMilestones, tasks);
  const selectedTasks = useMemo(
    () => (selectedMilestone ? tasks.filter((task) => task.milestoneId === selectedMilestone.id) : []),
    [selectedMilestone?.id, tasks],
  );
  const activeCount = activeTaskCount(tasks);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let mounted = true;
    setToolLoadError(null);

    discoverTools()
      .then((discovered) => {
        if (mounted) {
          setTools(discovered);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setToolLoadError(readableError(error));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function refreshTools(): Promise<void> {
    setToolLoadError(null);

    try {
      setTools(await discoverTools());
    } catch (error: unknown) {
      setToolLoadError(readableError(error));
    }
  }

  async function persistTask(updatedTask: Task): Promise<boolean> {
    setSaveError(null);
    setMutation("task");

    try {
      await saveTask(updatedTask);
      setTasks((current) =>
        current.some((task) => task.id === updatedTask.id)
          ? current.map((task) => (task.id === updatedTask.id ? updatedTask : task))
          : [...current, updatedTask],
      );
      return true;
    } catch (error: unknown) {
      setSaveError(readableError(error));
      return false;
    } finally {
      setMutation(null);
    }
  }

  async function importGithubTasks(importedTasks: Task[]): Promise<boolean> {
    const existingRefs = new Set(
      tasks.flatMap((task) => task.externalRef ? [task.externalRef] : []),
    );
    const newTasks = importedTasks.filter((task) => {
      if (!task.externalRef || existingRefs.has(task.externalRef)) {
        return false;
      }
      existingRefs.add(task.externalRef);
      return true;
    });

    if (newTasks.length === 0) {
      setSaveError("선택한 GitHub 이슈는 이미 이 프로젝트에 가져와져 있습니다.");
      return false;
    }

    setSaveError(null);
    setMutation("task");
    const savedTasks: Task[] = [];
    try {
      for (const task of newTasks) {
        await saveTask(task);
        savedTasks.push(task);
      }
      setTasks((current) => [...current, ...savedTasks]);
      return true;
    } catch (error: unknown) {
      if (savedTasks.length > 0) {
        setTasks((current) => [...current, ...savedTasks]);
      }
      setSaveError(readableError(error));
      return false;
    } finally {
      setMutation(null);
    }
  }

  async function updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    confirmedByHuman = false,
  ): Promise<void> {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask || currentTask.status === status) {
      return;
    }

    if (status === "done" && currentTask.status !== "review") {
      setSaveError("퀘스트를 완료하려면 먼저 검토 대기 상태로 이동하세요.");
      return;
    }

    if (!canTransitionTaskStatus(currentTask, status, { confirmedByHuman })) {
      if (status !== "done") {
        setSaveError("이 퀘스트는 현재 상태로 이동할 수 없습니다.");
        return;
      }

      const confirmed = window.confirm(
        `“${currentTask.title}”의 작업 결과를 확인하고 완료 처리할까요?`,
      );
      if (!confirmed) {
        return;
      }

      confirmedByHuman = true;
    }

    try {
      const updatedTask = transitionTaskStatus(currentTask, status, { confirmedByHuman });
      await persistTask(updatedTask);
    } catch (error: unknown) {
      setSaveError(readableError(error));
    }
  }

  async function moveTaskForward(task: Task): Promise<void> {
    await updateTaskStatus(task.id, advanceTaskStatus(task.status));
  }

  async function moveTaskBackward(task: Task): Promise<void> {
    await updateTaskStatus(task.id, retreatTaskStatus(task.status));
  }

  async function saveTaskDraft(draft: TaskDraft): Promise<boolean> {
    if (!taskEditor) {
      return false;
    }

    const updatedTask: Task = taskEditor.task
      ? { ...taskEditor.task, ...draft }
      : {
          id: crypto.randomUUID(),
          status: "todo",
          ...draft,
        };
    const saved = await persistTask(updatedTask);
    if (saved) {
      setTaskEditor(null);
    }

    return saved;
  }

  async function removeTask(): Promise<void> {
    if (!taskToDelete) {
      return;
    }

    const deleting = taskToDelete;
    setSaveError(null);
    setMutation("task");

    try {
      await deleteTask(deleting.id);
      setTasks((current) => current.filter((task) => task.id !== deleting.id));
      setTaskToDelete(null);
    } catch (error: unknown) {
      setSaveError(readableError(error));
    } finally {
      setMutation(null);
    }
  }

  async function saveMilestoneDraft(name: string): Promise<boolean> {
    if (!milestoneEditor) {
      return false;
    }

    const existing = milestoneEditor.milestone;
    const nextMilestone: Milestone = existing
      ? { ...existing, name }
      : {
          id: crypto.randomUUID(),
          projectId: project.id,
          name,
          order: orderedMilestones.length + 1,
        };
    setSaveError(null);
    setMutation("milestone");

    try {
      await saveMilestone(nextMilestone);
      setMilestones((current) =>
        existing
          ? current.map((milestone) =>
              milestone.id === existing.id ? nextMilestone : milestone,
            )
          : [...current, nextMilestone],
      );
      if (!existing) {
        setSelectedMilestoneId(nextMilestone.id);
      }
      setMilestoneEditor(null);
      return true;
    } catch (error: unknown) {
      setSaveError(readableError(error));
      return false;
    } finally {
      setMutation(null);
    }
  }

  async function reorderSelectedMilestone(direction: -1 | 1): Promise<void> {
    if (selectedMilestoneIndex < 0) {
      return;
    }

    const targetIndex = selectedMilestoneIndex + direction;
    const target = orderedMilestones[targetIndex];
    const current = orderedMilestones[selectedMilestoneIndex];
    if (!target || !current) {
      return;
    }

    const updates = orderedMilestones.map((milestone, index) => {
      if (index === selectedMilestoneIndex) {
        return { ...milestone, order: target.order };
      }
      if (index === targetIndex) {
        return { ...milestone, order: current.order };
      }
      return milestone;
    });

    setSaveError(null);
    setMutation("milestone");
    try {
      await Promise.all([saveMilestone(updates[selectedMilestoneIndex]), saveMilestone(updates[targetIndex])]);
      setMilestones(updates);
    } catch (error: unknown) {
      setSaveError(readableError(error));
    } finally {
      setMutation(null);
    }
  }

  async function removeMilestone(): Promise<void> {
    if (!milestoneToDelete) {
      return;
    }

    const deleting = milestoneToDelete;
    const deletingIndex = orderedMilestones.findIndex((milestone) => milestone.id === deleting.id);
    setSaveError(null);
    setMutation("milestone");

    try {
      await deleteMilestone(deleting.id);
      const remainingMilestones = orderedMilestones.filter((milestone) => milestone.id !== deleting.id);
      setMilestones(remainingMilestones);
      setTasks((current) => current.filter((task) => task.milestoneId !== deleting.id));
      setSelectedMilestoneId(
        remainingMilestones[Math.min(Math.max(deletingIndex, 0), remainingMilestones.length - 1)]?.id ?? null,
      );
      setMilestoneToDelete(null);
    } catch (error: unknown) {
      setSaveError(readableError(error));
    } finally {
      setMutation(null);
    }
  }

  async function saveProjectSettings(draft: ProjectSettingsDraft): Promise<boolean> {
    const repoPath = draft.repoPath.trim();
    setSaveError(null);
    setMutation("project");

    try {
      if (repoPath) {
        await validateRepoPath(repoPath);
      }

      const updatedProject: Project = {
        id: project.id,
        workspaceId: project.workspaceId,
        name: draft.name.trim(),
        skills: draft.skills,
        ...(repoPath ? { repoPath } : {}),
      };
      const updatedLoadout: Loadout = {
        projectId: project.id,
        ...draft.loadout,
      };
      await saveProject(updatedProject);
      if (updatedLoadout.agentTool || updatedLoadout.sourceTool) {
        await saveLoadout(updatedLoadout);
      } else {
        await deleteLoadout(project.id);
      }
      setProject(updatedProject);
      setLoadout(updatedLoadout);
      setShowProjectSettings(false);
      return true;
    } catch (error: unknown) {
      setSaveError(readableError(error));
      return false;
    } finally {
      setMutation(null);
    }
  }

  async function removeProject(): Promise<void> {
    setSaveError(null);
    setMutation("project");

    try {
      await deleteProject(project.id);
      onProjectDeleted();
    } catch (error: unknown) {
      setSaveError(readableError(error));
    } finally {
      setMutation(null);
      setConfirmProjectDelete(false);
    }
  }

  async function openTaskSource(task: Task): Promise<void> {
    if (!task.sourceUrl) {
      return;
    }

    try {
      await openUrl(task.sourceUrl);
    } catch (error: unknown) {
      setSaveError(`원본 링크를 열지 못했습니다: ${readableError(error)}`);
    }
  }

  function handleDropStatus(status: TaskStatus, taskId: string | null): void {
    setDraggedTaskId(null);
    const resolvedTaskId = taskId || draggedTaskId;
    if (!resolvedTaskId) {
      return;
    }

    const task = tasks.find((item) => item.id === resolvedTaskId);
    if (task) {
      void updateTaskStatus(task.id, status);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            Q
          </div>
          <div>
            <p className="eyebrow">MENU BAR QUEST BOARD</p>
            <h1>Queuest</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="active-counter" title="현재 진행 중인 태스크 수">
            <span aria-hidden="true">◆</span> {activeCount}
          </span>
          <button
            className={`icon-button pin-button ${pinned ? "active" : ""}`}
            type="button"
            aria-label={pinned ? "팝오버 고정 해제" : "팝오버 고정"}
            aria-pressed={pinned}
            title={pinned ? "팝오버 고정 해제" : "포커스를 잃어도 팝오버 유지"}
            onClick={onTogglePinned}
          >
            {pinned ? "고정됨" : "고정"}
          </button>
          <button className="topbar-project-button" type="button" onClick={onBackToInbox}>
            인박스
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="프로젝트 설정"
            onClick={() => { setSection("project"); setShowProjectSettings(true); }}
          >
            ⚙
          </button>
        </div>
      </header>

      <AppNavigation
        active={section}
        onNavigate={(next) => {
          if (next === "inbox") {
            onBackToInbox();
          } else if (next === "character") {
            onOpenCharacter();
          } else {
            setSection(next);
          }
        }}
      />
      <main className="main-content" ref={mainRef}>
        {windowError && <p className="action-error" role="alert">{windowError}</p>}
        {section === "plugins" && (
          <PluginsPanel
            onOpenProject={() => {
              setSection("project");
              setGithubImportOpen(true);
            }}
          />
        )}
        <div hidden={section !== "project"}>
        <section className="workspace-header" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2 id="workspace-title" ref={headingRef} tabIndex={-1}>{graph.workspace.name}</h2>
          </div>
          <span className="workspace-chip">로컬 저장소</span>
        </section>

        <section className="project-banner" aria-labelledby="project-title">
          <div className="project-heading">
            <div className="project-token" aria-hidden="true">
              ✦
            </div>
            <div>
              <p className="eyebrow">SELECTED EXPEDITION</p>
              <h2 id="project-title">{project.name}</h2>
            </div>
          </div>
          <div className="project-stats">
            <span className={`status-pill ${projectStatus}`}>
              {PROJECT_STATUS_LABEL[projectStatus]}
            </span>
            <span className="project-percent">{projectProgress}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`프로젝트 진행률 ${projectProgress}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={projectProgress}
          >
            <span aria-hidden="true" style={{ width: `${projectProgress}%` }} />
          </div>
        </section>

        {saveError && (
          <div className="action-error" role="alert">
            <span>{saveError}</span>
            <button type="button" onClick={() => setSaveError(null)}>닫기</button>
          </div>
        )}

        {showProjectSettings && (
          <ProjectSettingsPanel
            project={project}
            loadout={loadout}
            tools={tools}
            toolLoadError={toolLoadError}
            submitting={mutation === "project"}
            onClose={() => setShowProjectSettings(false)}
            onSubmit={saveProjectSettings}
            onRefreshTools={refreshTools}
            onDelete={() => setConfirmProjectDelete(true)}
          />
        )}

        <section className="stage-section" aria-labelledby="stage-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ROUTE MAP</p>
              <h2 id="stage-title">원정 경로</h2>
            </div>
            <div className="stage-actions">
              <button
                className="small-button"
                type="button"
                onClick={() => setMilestoneEditor({})}
                disabled={mutation !== null}
              >
                + 스테이지
              </button>
              {selectedMilestone && (
                <>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => setMilestoneEditor({ milestone: selectedMilestone })}
                    disabled={mutation !== null}
                  >
                    편집
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => setMilestoneToDelete(selectedMilestone)}
                    disabled={mutation !== null}
                  >
                    삭제
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    aria-label="선택한 스테이지 위로 이동"
                    onClick={() => void reorderSelectedMilestone(-1)}
                    disabled={mutation !== null || selectedMilestoneIndex <= 0}
                  >
                    ↑
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    aria-label="선택한 스테이지 아래로 이동"
                    onClick={() => void reorderSelectedMilestone(1)}
                    disabled={mutation !== null || selectedMilestoneIndex < 0 || selectedMilestoneIndex >= orderedMilestones.length - 1}
                  >
                    ↓
                  </button>
                </>
              )}
            </div>
          </div>

          {orderedMilestones.length > 0 ? (
            <div className="stage-map" role="list" aria-label="프로젝트 마일스톤">
              {orderedMilestones.map((milestone, index) => {
                const unlocked = isMilestoneUnlocked(milestone.id, orderedMilestones, tasks);
                const complete = isMilestoneComplete(milestone.id, tasks);
                const selected = milestone.id === selectedMilestone?.id;

                return (
                  <div className="stage-step" key={milestone.id} role="listitem">
                    {index > 0 && <span className="stage-connector" aria-hidden="true" />}
                    <button
                      className={`stage-node ${selected ? "selected" : ""} ${complete ? "complete" : ""}`}
                      type="button"
                      disabled={!unlocked}
                      aria-current={selected ? "step" : undefined}
                      aria-label={`${milestone.name}, ${complete ? "완료" : unlocked ? "열림" : "잠김"}`}
                      onClick={() => setSelectedMilestoneId(milestone.id)}
                    >
                      <span className="stage-number">{complete ? "✓" : index + 1}</span>
                      {!unlocked && <span className="lock-mark" aria-hidden="true">⌑</span>}
                    </button>
                    <span className={`stage-label ${selected ? "selected" : ""}`}>
                      {milestone.name}
                    </span>
                    <span className="stage-progress">
                      {calculateMilestoneProgress(milestone.id, tasks)}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <section className="state-panel compact-state" role="status" aria-label="스테이지 없음">
              <span className="state-mark" aria-hidden="true">＋</span>
              <p className="eyebrow">NO STAGES YET</p>
              <h2>아직 스테이지가 없습니다</h2>
              <p>이 프로젝트에는 아직 원정 경로가 만들어지지 않았습니다.</p>
            </section>
          )}

          {milestoneEditor && (
            <MilestoneEditor
              milestone={milestoneEditor.milestone}
              submitting={mutation === "milestone"}
              onCancel={() => setMilestoneEditor(null)}
              onSubmit={saveMilestoneDraft}
            />
          )}
        </section>

        {githubImportOpen && (
          <GithubImportPanel
            project={project}
            milestones={orderedMilestones}
            tasks={tasks}
            tools={tools}
            defaultMilestoneId={selectedMilestone?.id}
            submitting={mutation === "task"}
            onCancel={() => setGithubImportOpen(false)}
            onImport={async (issues, milestoneId) => {
              const importedTasks = issues.map((issue) => githubIssueToTask(issue, project, milestoneId));
              const saved = await importGithubTasks(importedTasks);
              if (saved) {
                setGithubImportOpen(false);
              }
              return saved;
            }}
          />
        )}

        {selectedMilestone ? (
          <section className="quest-section" aria-labelledby="quest-title">
            <div className="section-heading quest-heading">
              <div>
                <p className="eyebrow">STAGE {selectedMilestone.order}</p>
                <h2 id="quest-title">{selectedMilestone.name}</h2>
              </div>
              <div className="quest-heading-actions">
                <span className="section-note">{selectedTasks.length}개의 퀘스트</span>
                <button
                  className="small-button"
                  type="button"
                  onClick={() => setGithubImportOpen(true)}
                  disabled={mutation !== null || orderedMilestones.length === 0}
                >
                  GitHub 가져오기
                </button>
                <button
                  className="small-button accent"
                  type="button"
                  onClick={() => setTaskEditor({ milestoneId: selectedMilestone.id })}
                  disabled={mutation !== null}
                >
                  + 퀘스트
                </button>
              </div>
            </div>

            <div className="board" aria-label={`${selectedMilestone.name} 상태 보드`}>
              {STATUS_COLUMNS.map((column) => {
                const columnTasks = selectedTasks.filter((task) => task.status === column.status);

                return (
                  <section
                    className={`quest-column ${column.status}`}
                    key={column.status}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropStatus(column.status, event.dataTransfer.getData("text/plain"));
                    }}
                  >
                    <header className="column-header">
                      <div>
                        <h3>{column.label}</h3>
                        <p>{column.hint}</p>
                      </div>
                      <span className="column-count">{columnTasks.length}</span>
                    </header>
                    <div className="column-cards">
                      {columnTasks.length === 0 ? (
                        <p className="empty-column">이 칸은 비어 있다</p>
                      ) : (
                        columnTasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onAdvance={() => moveTaskForward(task)}
                            onRetreat={() => moveTaskBackward(task)}
                            onEdit={() => setTaskEditor({ task, milestoneId: task.milestoneId })}
                            onDelete={() => setTaskToDelete(task)}
                            onOpenSource={task.sourceUrl ? () => void openTaskSource(task) : undefined}
                            onDragStart={() => setDraggedTaskId(task.id)}
                            onDragEnd={() => setDraggedTaskId(null)}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        ) : null}

        {taskEditor && (
          <TaskEditor
            key={taskEditor.task?.id ?? "new-task"}
            task={taskEditor.task}
            defaultMilestoneId={taskEditor.milestoneId}
            milestones={orderedMilestones}
            submitting={mutation === "task"}
            onCancel={() => setTaskEditor(null)}
            onSubmit={saveTaskDraft}
          />
        )}

        </div>
        <p hidden={section !== "project"} className="prototype-note">
          프로젝트를 명시적으로 선택한 뒤 열리는 원정 보드입니다. 퀘스트·스테이지·프로젝트 설정은 로컬 SQLite에 저장됩니다.
        </p>
      </main>

      {taskToDelete && (
        <ConfirmDialog
          title="퀘스트를 삭제할까요?"
          message={`“${taskToDelete.title}”와 연결된 댓글이 함께 삭제됩니다.`}
          confirmLabel="퀘스트 삭제"
          busy={mutation === "task"}
          onCancel={() => setTaskToDelete(null)}
          onConfirm={removeTask}
        />
      )}
      {milestoneToDelete && (
        <ConfirmDialog
          title="스테이지를 삭제할까요?"
          message={`“${milestoneToDelete.name}”의 퀘스트 ${tasks.filter((task) => task.milestoneId === milestoneToDelete.id).length}개도 함께 삭제됩니다.`}
          confirmLabel="스테이지 삭제"
          busy={mutation === "milestone"}
          onCancel={() => setMilestoneToDelete(null)}
          onConfirm={removeMilestone}
        />
      )}
      {confirmProjectDelete && (
        <ConfirmDialog
          title="프로젝트를 삭제할까요?"
          message={`“${project.name}”의 모든 스테이지와 퀘스트가 함께 삭제됩니다.`}
          confirmLabel="프로젝트 삭제"
          busy={mutation === "project"}
          onCancel={() => setConfirmProjectDelete(false)}
          onConfirm={removeProject}
        />
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onAdvance: () => void | Promise<void>;
  onRetreat: () => void | Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSource?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function TaskCard({
  task,
  onAdvance,
  onRetreat,
  onEdit,
  onDelete,
  onOpenSource,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const previousStatus = retreatTaskStatus(task.status);
  const nextStatus = advanceTaskStatus(task.status);
  const previousLabel = STATUS_COLUMNS.find((column) => column.status === previousStatus)?.label;
  const nextLabel = STATUS_COLUMNS.find((column) => column.status === nextStatus)?.label;

  return (
    <article
      className={`quest-card ${task.status} ${task.blocked ? "blocked" : ""}`}
      draggable
      aria-label={`${task.title}, ${STATUS_COLUMNS.find((column) => column.status === task.status)?.label}`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-meta">
        <span className="card-status">{STATUS_COLUMNS.find((column) => column.status === task.status)?.label}</span>
        <span className="card-assignee">{task.assignee === "ai" ? "AI" : "나"}</span>
        {task.comments && task.comments.length > 0 && (
          <span className="card-comments">댓글 {task.comments.length}</span>
        )}
      </div>
      <h4>{task.title}</h4>
      <p>{task.body}</p>
      <div className="card-tags">
        {task.skills.map((skill) => (
          <span key={skill}>#{skill}</span>
        ))}
        {task.blocked && <span className="blocked-badge">BLOCKED</span>}
      </div>
      <div className="card-actions">
        {task.status !== "todo" && (
          <button className="advance-button retreat-button" type="button" onClick={() => void onRetreat()}>
            이전: {previousLabel}
          </button>
        )}
        {task.status !== "done" && (
          <button className="advance-button" type="button" onClick={() => void onAdvance()}>
            {nextStatus === "done" ? "완료 확인" : `다음: ${nextLabel}`}
          </button>
        )}
        <button className="row-action" type="button" onClick={onEdit}>편집</button>
        {onOpenSource && <button className="row-action" type="button" onClick={onOpenSource}>원본</button>}
        <button className="row-action danger" type="button" onClick={onDelete}>삭제</button>
      </div>
    </article>
  );
}

interface CharacterSpriteProps {
  character: Character;
}

function CharacterSprite({ character }: CharacterSpriteProps) {
  return (
    <div
      className={`sprite sprite-${character.spriteId}`}
      aria-label={`${JOB_LABEL[character.job]} ${character.spriteId} 도트 캐릭터`}
      role="img"
    >
      {SPRITE_ART[character.job].map((line) => (
        <span aria-hidden="true" key={line}>{line}</span>
      ))}
    </div>
  );
}

export default App;
