import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  activeTaskCount,
  advanceTaskStatus,
  calculateExperience,
  calculateLevel,
  calculateMilestoneProgress,
  calculateProjectProgress,
  calculateProjectStatus,
  calculateSkillSummaries,
  canAssignToAi,
  isMilestoneComplete,
  isMilestoneUnlocked,
} from "@queuest/domain";
import type {
  Character,
  InboxTodo,
  Loadout,
  ProjectGraph,
  Task,
  TaskStatus,
} from "@queuest/domain";
import {
  deleteInboxTodo,
  loadInboxTodos,
  saveInboxTodo,
} from "./data/inbox";
import {
  createProject,
  graphForProject,
  loadProjectGraphs,
  saveTask,
  type NewProjectInput,
} from "./data/project";
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

type AppView = "inbox" | "project-picker" | "project";
type ProjectLoadState = "idle" | "loading" | "ready" | "error";

function App() {
  const [view, setView] = useState<AppView>("inbox");
  const [todos, setTodos] = useState<InboxTodo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [deletedTodo, setDeletedTodo] = useState<InboxTodo | null>(null);
  const [projectGraphs, setProjectGraphs] = useState<ProjectGraph[] | null>(null);
  const [projectLoadState, setProjectLoadState] = useState<ProjectLoadState>("idle");
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [selectedProjectGraph, setSelectedProjectGraph] = useState<ProjectGraph | null>(null);

  useEffect(() => {
    let mounted = true;

    setTodos(null);
    setLoadError(null);
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

  async function loadExistingProjects(): Promise<void> {
    setProjectLoadState("loading");
    setProjectLoadError(null);
    setActionError(null);

    try {
      const graphs = await loadProjectGraphs();
      setProjectGraphs(graphs);
      setProjectLoadState("ready");
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
    setProjectLoadState("idle");
    setProjectLoadError(null);
    setView("inbox");
  }

  function openProjectPicker() {
    setActionError(null);
    setView("project-picker");
  }

  async function finishCreateProject(input: NewProjectInput): Promise<boolean> {
    setProjectLoadState("loading");
    setProjectLoadError(null);
    setActionError(null);

    try {
      const created = await createProject(input);
      const graphs = await loadProjectGraphs();
      setProjectGraphs(graphs);
      setProjectLoadState("ready");
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
        onBackToInbox={backToInbox}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        todoCount={todos?.filter((todo) => !todo.completed).length ?? 0}
        onOpenProject={openProjectPicker}
      />
      <main className="main-content">
        {view === "project-picker" ? (
          <ProjectPicker
            onBack={() => setView("inbox")}
            projectGraphs={projectGraphs}
            projectLoadState={projectLoadState}
            projectLoadError={projectLoadError}
            actionError={actionError}
            firstTodoTitle={todos?.find((todo) => !todo.completed)?.title}
            onLoadExisting={loadExistingProjects}
            onSelectProject={selectProject}
            onCreateProject={finishCreateProject}
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
            todos={todos}
            actionError={actionError}
            deletedTodo={deletedTodo}
            onCreate={createTodo}
            onUpdate={updateTodo}
            onDelete={removeTodo}
            onRecover={recoverTodo}
            onClearActionError={() => setActionError(null)}
            onOpenProject={openProjectPicker}
          />
        )}
      </main>
    </div>
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "로컬 저장소와 통신하지 못했습니다. 잠시 후 다시 시도하세요.";
}

function compareTodos(left: InboxTodo, right: InboxTodo): number {
  return left.createdAt.localeCompare(right.createdAt);
}

interface AppHeaderProps {
  todoCount: number;
  onOpenProject: () => void;
}

function AppHeader({ todoCount, onOpenProject }: AppHeaderProps) {
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
  todos: InboxTodo[];
  actionError: string | null;
  deletedTodo: InboxTodo | null;
  onCreate: (title: string) => Promise<boolean>;
  onUpdate: (todo: InboxTodo) => Promise<boolean>;
  onDelete: (todo: InboxTodo) => Promise<boolean>;
  onRecover: () => Promise<boolean>;
  onClearActionError: () => void;
  onOpenProject: () => void;
}

function TodoInbox({
  todos,
  actionError,
  deletedTodo,
  onCreate,
  onUpdate,
  onDelete,
  onRecover,
  onClearActionError,
  onOpenProject,
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
          <h2 id="inbox-title">먼저, 할 일을 모아두세요</h2>
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
        <button className="secondary-button" type="button" onClick={onOpenProject}>
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
          <button className="row-action" type="button" onClick={onEdit}>편집</button>
          <button className="row-action danger" type="button" onClick={() => void onDelete()}>삭제</button>
        </div>
      )}
    </article>
  );
}

interface ProjectPickerProps {
  onBack: () => void;
  projectGraphs: ProjectGraph[] | null;
  projectLoadState: ProjectLoadState;
  projectLoadError: string | null;
  actionError: string | null;
  firstTodoTitle?: string;
  onLoadExisting: () => Promise<void>;
  onSelectProject: (graph: ProjectGraph) => void;
  onCreateProject: (input: NewProjectInput) => Promise<boolean>;
  onClearError: () => void;
}

function ProjectPicker({
  onBack,
  projectGraphs,
  projectLoadState,
  projectLoadError,
  actionError,
  firstTodoTitle,
  onLoadExisting,
  onSelectProject,
  onCreateProject,
  onClearError,
}: ProjectPickerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <section className="project-picker" aria-labelledby="project-picker-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PROJECT GATE</p>
          <h2 id="project-picker-title">어디서 이어갈까요?</h2>
        </div>
        <span className="workspace-chip">선택 후 로드</span>
      </div>
      <p className="project-picker-lede">
        인박스는 그대로 두고, 명시적으로 프로젝트를 선택하거나 새 원정을 만든 뒤 보드를 엽니다.
      </p>

      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={onClearError}>닫기</button>
        </div>
      )}

      {showCreateForm ? (
        <ProjectCreateForm
          initialTaskTitle={firstTodoTitle}
          submitting={projectLoadState === "loading"}
          onCancel={() => setShowCreateForm(false)}
          onSubmit={onCreateProject}
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
            <button className="secondary-button" type="button" onClick={() => setShowCreateForm(true)}>
              새 프로젝트 만들기
            </button>
          </div>
        </section>
      ) : projectLoadState === "ready" && projectGraphs && projectGraphs.length > 0 ? (
        <section className="project-list-panel" aria-labelledby="saved-projects-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SAVED PROJECTS</p>
              <h2 id="saved-projects-title">프로젝트 선택</h2>
            </div>
            <span className="section-note">{projectGraphs.length}개</span>
          </div>
          <div className="project-list">
            {projectGraphs.map((graph) => (
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
          <button className="secondary-button project-create-link" type="button" onClick={() => setShowCreateForm(true)}>
            + 새 프로젝트 만들기
          </button>
        </section>
      ) : (
        <section className="state-panel no-project-state" aria-labelledby="no-project-title">
          <span className="state-mark" aria-hidden="true">⌂</span>
          <p className="eyebrow">NO PROJECT SELECTED</p>
          <h2 id="no-project-title">
            {projectLoadState === "ready" ? "저장된 프로젝트가 없습니다" : "아직 프로젝트를 고르지 않았습니다"}
          </h2>
          <p>
            {projectLoadState === "ready"
              ? "새 프로젝트를 만들면 첫 스테이지와 함께 보드가 열립니다."
              : "기존 프로젝트를 불러오거나 새 원정을 만들어 보드로 이동하세요."}
          </p>
          <div className="state-actions">
            <button className="primary-button" type="button" onClick={() => void onLoadExisting()}>
              기존 프로젝트 불러오기
            </button>
            <button className="secondary-button" type="button" onClick={() => setShowCreateForm(true)}>
              새 프로젝트 만들기
            </button>
          </div>
        </section>
      )}

      <button className="back-link" type="button" onClick={onBack}>← 인박스로 돌아가기</button>
    </section>
  );
}

interface ProjectCreateFormProps {
  initialTaskTitle?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: NewProjectInput) => Promise<boolean>;
}

function ProjectCreateForm({
  initialTaskTitle,
  submitting,
  onCancel,
  onSubmit,
}: ProjectCreateFormProps) {
  const [name, setName] = useState("");
  const [firstTaskTitle, setFirstTaskTitle] = useState(initialTaskTitle ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("프로젝트 이름을 입력하세요.");
      return;
    }

    setValidationError(null);
    await onSubmit({ name: trimmedName, firstTaskTitle: firstTaskTitle.trim() || undefined });
  }

  return (
    <form className="project-create-form" onSubmit={handleSubmit}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">NEW EXPEDITION</p>
          <h2>새 프로젝트 만들기</h2>
        </div>
        <span className="section-note">SQLite에 저장</span>
      </div>
      <label htmlFor="project-name">프로젝트 이름</label>
      <input
        id="project-name"
        type="text"
        value={name}
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
        placeholder="인박스의 할 일을 첫 퀘스트로 복사할 수 있습니다"
        onChange={(event) => setFirstTaskTitle(event.target.value)}
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

interface ProjectBoardProps {
  graph: ProjectGraph;
  onBackToInbox: () => void;
}

function ProjectBoard({ graph, onBackToInbox }: ProjectBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(graph.tasks);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    graph.milestones[0]?.id ?? null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedMilestone =
    graph.milestones.find((milestone) => milestone.id === selectedMilestoneId) ??
    graph.milestones[0];
  const projectProgress = calculateProjectProgress(graph.milestones, tasks);
  const projectStatus = calculateProjectStatus(graph.milestones, tasks);
  const experience = calculateExperience(graph.milestones, tasks);
  const level = calculateLevel(experience);
  const skillSummaries = calculateSkillSummaries(
    graph.project,
    graph.milestones,
    tasks,
    DEFAULT_CHARACTER,
  );
  const aiReady = canAssignToAi(graph.project, { ...DEFAULT_LOADOUT, projectId: graph.project.id });
  const selectedTasks = useMemo(
    () => (selectedMilestone ? tasks.filter((task) => task.milestoneId === selectedMilestone.id) : []),
    [selectedMilestone, tasks],
  );
  const activeCount = activeTaskCount(tasks);

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask || currentTask.status === status) {
      return;
    }

    const updatedTask = { ...currentTask, status };
    setSaveError(null);

    try {
      await saveTask(updatedTask);
      setTasks((current) => current.map((task) => (task.id === taskId ? updatedTask : task)));
    } catch (error: unknown) {
      setSaveError(readableError(error));
    }
  }

  async function moveTaskForward(task: Task) {
    await updateTaskStatus(task.id, advanceTaskStatus(task.status));
  }

  async function assignTaskToAi(task: Task) {
    if (!aiReady) {
      return;
    }

    const updatedTask = { ...task, assignee: "ai" as const, status: "doing" as const };
    setSaveError(null);

    try {
      await saveTask(updatedTask);
      setTasks((current) => current.map((item) => (item.id === task.id ? updatedTask : item)));
    } catch (error: unknown) {
      setSaveError(readableError(error));
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
          <button className="topbar-project-button" type="button" onClick={onBackToInbox}>
            인박스
          </button>
          <button className="icon-button" type="button" aria-label="설정">
            ⚙
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="workspace-header" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2 id="workspace-title">{graph.workspace.name}</h2>
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
              <h2 id="project-title">{graph.project.name}</h2>
            </div>
          </div>
          <div className="project-stats">
            <span className={`status-pill ${projectStatus}`}>
              {PROJECT_STATUS_LABEL[projectStatus]}
            </span>
            <span className="project-percent">{projectProgress}%</span>
          </div>
          <div className="progress-track" aria-label={`프로젝트 진행률 ${projectProgress}%`}>
            <span style={{ width: `${projectProgress}%` }} />
          </div>
        </section>

        {saveError && (
          <div className="action-error" role="alert">
            <span>{saveError}</span>
            <button type="button" onClick={() => setSaveError(null)}>닫기</button>
          </div>
        )}

        <section className="stage-section" aria-labelledby="stage-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ROUTE MAP</p>
              <h2 id="stage-title">원정 경로</h2>
            </div>
            <span className="section-note">앞 스테이지를 통과하면 다음이 열린다</span>
          </div>

          {graph.milestones.length > 0 ? (
            <div className="stage-map" role="list" aria-label="프로젝트 마일스톤">
              {graph.milestones.map((milestone, index) => {
                const unlocked = isMilestoneUnlocked(milestone.id, graph.milestones, tasks);
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
            <section className="state-panel compact-state" aria-label="스테이지 없음">
              <span className="state-mark" aria-hidden="true">＋</span>
              <p className="eyebrow">NO STAGES YET</p>
              <h2>아직 스테이지가 없습니다</h2>
              <p>이 프로젝트에는 아직 원정 경로가 만들어지지 않았습니다.</p>
            </section>
          )}
        </section>

        {selectedMilestone ? (
          <section className="quest-section" aria-labelledby="quest-title">
            <div className="section-heading quest-heading">
              <div>
                <p className="eyebrow">STAGE {selectedMilestone.order}</p>
                <h2 id="quest-title">{selectedMilestone.name}</h2>
              </div>
              <span className="section-note">{selectedTasks.length}개의 퀘스트</span>
            </div>

            <div className="board" aria-label={`${selectedMilestone.name} 상태 보드`}>
              {STATUS_COLUMNS.map((column) => {
                const columnTasks = selectedTasks.filter((task) => task.status === column.status);

                return (
                  <section className={`quest-column ${column.status}`} key={column.status}>
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
                            aiReady={aiReady}
                            onAdvance={() => moveTaskForward(task)}
                            onAssignAi={() => assignTaskToAi(task)}
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

        <section className="character-sheet" aria-labelledby="character-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CHARACTER SHEET</p>
              <h2 id="character-title">나의 캐릭터</h2>
            </div>
            <span className="sheet-rule">계산되는 뷰</span>
          </div>

          <div className="character-summary">
            <div className="sprite" aria-label={`${DEFAULT_CHARACTER.job} 도트 캐릭터`} role="img">
              <span aria-hidden="true">●</span>
              <span aria-hidden="true">╱▌╲</span>
              <span aria-hidden="true">╱ ╲</span>
            </div>
            <div className="character-copy">
              <div className="character-name-row">
                <h3>{DEFAULT_CHARACTER.name}</h3>
                <span className="job-badge">개발자</span>
              </div>
              <p>Lv. {level} 원정대원</p>
              <div className="xp-row">
                <span>XP {experience}</span>
                <span>다음 레벨까지 {Math.max(0, 100 - (experience % 100))}</span>
              </div>
              <div className="xp-track" aria-label={`경험치 ${experience}`}>
                <span style={{ width: `${Math.min(100, experience % 100 || (experience > 0 ? 100 : 0))}%` }} />
              </div>
            </div>
          </div>

          <div className="sheet-grid">
            <div className="skill-panel">
              <div className="panel-heading">
                <h3>스킬</h3>
                <span>완료 태스크 기준</span>
              </div>
              <div className="skill-list">
                {skillSummaries.map((skill) => (
                  <div className={`skill-row ${skill.emphasized ? "emphasized" : ""}`} key={skill.name}>
                    <div className="skill-label">
                      <span>{skill.name}</span>
                      <strong>{skill.level}</strong>
                    </div>
                    <div className="skill-track" aria-label={`${skill.name} 레벨 ${skill.level}`}>
                      <span style={{ width: `${Math.min(100, skill.level * 20)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="equipment-panel">
              <div className="panel-heading">
                <h3>장비</h3>
                <span>프로젝트 설정</span>
              </div>
              <EquipmentSlot
                label="에이전트"
                value={DEFAULT_LOADOUT.agentTool ?? "비어 있음"}
                ready={aiReady}
                detail={graph.project.repoPath ? "실행 준비됨" : "repoPath 연결 대기"}
              />
              <EquipmentSlot
                label="소스"
                value={DEFAULT_LOADOUT.sourceTool ?? "비어 있음"}
                ready={Boolean(DEFAULT_LOADOUT.sourceTool)}
                detail="가져오기 어댑터"
              />
            </div>
          </div>

          <div className="inventory-line">
            <span className="inventory-label">발견한 도구</span>
            <span className="tool-tag equipped">claude</span>
            <span className="tool-tag equipped">gh</span>
            <span className="tool-tag muted">jj</span>
            <span className="inventory-note">PATH 스캔은 Tauri 셸 연결 후 활성화</span>
          </div>
        </section>

        <p className="prototype-note">
          프로젝트를 명시적으로 선택한 뒤 열리는 데모 원정 보드입니다. 인박스 할 일은 로컬 SQLite에 먼저 저장됩니다.
        </p>
      </main>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  aiReady: boolean;
  onAdvance: () => void | Promise<void>;
  onAssignAi: () => void | Promise<void>;
}

function TaskCard({ task, aiReady, onAdvance, onAssignAi }: TaskCardProps) {
  const nextStatus = advanceTaskStatus(task.status);
  const nextLabel = STATUS_COLUMNS.find((column) => column.status === nextStatus)?.label;

  return (
    <article className={`quest-card ${task.status} ${task.blocked ? "blocked" : ""}`}>
      <div className="card-meta">
        <span className="card-status">{STATUS_COLUMNS.find((column) => column.status === task.status)?.label}</span>
        <span className="card-assignee">{task.assignee === "ai" ? "AI" : "나"}</span>
      </div>
      <h4>{task.title}</h4>
      <p>{task.body}</p>
      <div className="card-tags">
        {task.skills.map((skill) => (
          <span key={skill}>#{skill}</span>
        ))}
        {task.assignee === "ai" && <span className="return-badge">AI 귀환</span>}
      </div>
      <div className="card-actions">
        {task.status !== "done" && (
          <button className="advance-button" type="button" onClick={() => void onAdvance()}>
            다음: {nextLabel}
          </button>
        )}
        {task.status !== "done" && (
          <button
            className="ai-button"
            type="button"
            disabled={!aiReady || task.assignee === "ai"}
            title={aiReady ? "Claude에게 작업을 맡깁니다" : "프로젝트 repoPath를 먼저 연결하세요"}
            onClick={() => void onAssignAi()}
          >
            {task.assignee === "ai" ? "실행 중" : "AI에게 맡기기"}
          </button>
        )}
      </div>
    </article>
  );
}

interface EquipmentSlotProps {
  label: string;
  value: string;
  ready: boolean;
  detail: string;
}

function EquipmentSlot({ label, value, ready, detail }: EquipmentSlotProps) {
  return (
    <div className={`equipment-slot ${ready ? "ready" : "waiting"}`}>
      <div className="equipment-icon" aria-hidden="true">
        {ready ? "✦" : "·"}
      </div>
      <div>
        <span className="equipment-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export default App;
