import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  activeTaskCount,
  advanceTaskStatus,
  canTransitionTaskStatus,
  calculateExperience,
  calculateLevel,
  calculateMilestoneProgress,
  calculateProjectProgress,
  calculateProjectStatus,
  calculateSkillSummaries,
  canAssignToAi,
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
  Project,
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
  deleteMilestone,
  deleteProject,
  deleteTask,
  graphForProject,
  loadProjectGraphs,
  saveTask,
  saveMilestone,
  saveProject,
  validateRepoPath,
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
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousViewRef = useRef<AppView>(view);
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
    if (previousViewRef.current === view) {
      return;
    }

    previousViewRef.current = view;
    if (view !== "project") {
      viewHeadingRef.current?.focus();
    }
  }, [view]);

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

  function backToProjectPicker() {
    setSelectedProjectGraph(null);
    setProjectGraphs(null);
    setProjectLoadState("idle");
    setProjectLoadError(null);
    setView("project-picker");
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
      const repoPath = input.repoPath?.trim();
      if (repoPath) {
        await validateRepoPath(repoPath);
      }

      const created = await createProject({
        ...input,
        ...(repoPath ? { repoPath } : {}),
      });
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
        onProjectDeleted={backToProjectPicker}
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
            headingRef={viewHeadingRef}
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

function parseSkillText(value: string): string[] {
  return [...new Set(value.split(",").map((skill) => skill.trim()).filter(Boolean))];
}

function skillText(skills: string[]): string {
  return skills.join(", ");
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
  headingRef: RefObject<HTMLHeadingElement | null>;
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

interface ProjectPickerProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
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
  headingRef,
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
        <span className="section-note">SQLite에 저장</span>
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
}

interface ProjectSettingsPanelProps {
  project: Project;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (draft: ProjectSettingsDraft) => Promise<boolean>;
  onDelete: () => void;
}

function ProjectSettingsPanel({
  project,
  submitting,
  onClose,
  onSubmit,
  onDelete,
}: ProjectSettingsPanelProps) {
  const [name, setName] = useState(project.name);
  const [repoPath, setRepoPath] = useState(project.repoPath ?? "");
  const [skills, setSkills] = useState(skillText(project.skills));
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
  graph: ProjectGraph;
  onBackToInbox: () => void;
  onProjectDeleted: () => void;
}

function ProjectBoard({ graph, onBackToInbox, onProjectDeleted }: ProjectBoardProps) {
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
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [milestoneToDelete, setMilestoneToDelete] = useState<Milestone | null>(null);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

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
  const experience = calculateExperience(orderedMilestones, tasks);
  const level = calculateLevel(experience);
  const skillSummaries = calculateSkillSummaries(
    project,
    orderedMilestones,
    tasks,
    DEFAULT_CHARACTER,
  );
  const aiReady = canAssignToAi(project, { ...DEFAULT_LOADOUT, projectId: project.id });
  const selectedTasks = useMemo(
    () => (selectedMilestone ? tasks.filter((task) => task.milestoneId === selectedMilestone.id) : []),
    [selectedMilestone?.id, tasks],
  );
  const activeCount = activeTaskCount(tasks);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
      await saveProject(updatedProject);
      setProject(updatedProject);
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
          <button className="topbar-project-button" type="button" onClick={onBackToInbox}>
            인박스
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="프로젝트 설정"
            onClick={() => setShowProjectSettings(true)}
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="main-content">
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
            submitting={mutation === "project"}
            onClose={() => setShowProjectSettings(false)}
            onSubmit={saveProjectSettings}
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
              <div
                className="xp-track"
                role="progressbar"
                aria-label={`경험치 ${experience}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={experience % 100}
              >
                <span aria-hidden="true" style={{ width: `${Math.min(100, experience % 100 || (experience > 0 ? 100 : 0))}%` }} />
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
                detail={project.repoPath ? "실행 준비됨" : "repoPath 연결 대기"}
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
  onDragStart: () => void;
  onDragEnd: () => void;
}

function TaskCard({
  task,
  onAdvance,
  onRetreat,
  onEdit,
  onDelete,
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
        <button className="row-action danger" type="button" onClick={onDelete}>삭제</button>
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
