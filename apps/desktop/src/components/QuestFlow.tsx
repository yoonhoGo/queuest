import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { advanceTaskStatus, createQuestContext, isMilestoneUnlocked, retreatTaskStatus, transitionTaskStatus } from "@queuest/domain";
import type { InboxTodo, ProjectGraph, ProjectTodo, Task } from "@queuest/domain";
import { QuestContextEditor } from "./QuestContext";
import { PixelIcon } from "./PixelIcon";
import { Button, CheckRow, Dialog, StatusBadge } from "./ui";

export const QUEST_STATUS = { todo: "대기", doing: "진행 중", review: "검토 대기", done: "완료", pending: "미수락" };

export function QuestDialog({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  return <Dialog title={title} busy={busy} onClose={onClose}>{children}</Dialog>;
}

export function QuestDetail({ item, onSave, onClose, onOpenSource, onOpenProject, stageLocked = false }: {
  item: ProjectTodo; onSave: (task: Task) => Promise<boolean>; onClose: () => void;
  onOpenSource: (url: string) => Promise<void>; onOpenProject?: (id: string) => void;
  stageLocked?: boolean;
}) {
  const { task } = item;
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);
  const criteria = [...new Set((task.quest?.successCriteria ?? "").split(/\n/).map(line => line.trim()).filter(Boolean))];
  const pending = task.quest?.acceptance === "pending";
  const reviewing = task.status === "review" && !pending;
  const canComplete = confirmed && criteria.every(criterion => checked.includes(criterion));
  const links = [...(task.sourceUrl ? [{ kind: "source", url: task.sourceUrl }] : []), ...(task.quest?.links ?? [])]
    .filter((link, index, all) => /^https?:\/\//i.test(link.url) && all.findIndex(other => other.url === link.url) === index);
  useEffect(() => { setChecked([]); setConfirmed(false); }, [task.id, task.status, task.quest?.successCriteria]);

  async function save(updated: Task) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError(null);
    try {
      if (await onSave(updated)) { setDraft(null); onClose(); }
      else setError("저장하지 못했습니다. 내용을 유지한 채 다시 시도할 수 있습니다.");
    } catch { setError("저장하지 못했습니다. 다시 시도하세요."); }
    finally { saving.current = false; setBusy(false); }
  }
  function move(status: Task["status"]) {
    if (stageLocked && status === advanceTaskStatus(task.status)) return;
    if (status === "done" && !canComplete) return;
    try { void save(transitionTaskStatus(task, status, { confirmedByHuman: status === "done" && canComplete })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
  }

  return <QuestDialog title={reviewing ? "퀘스트 완료 검토" : "퀘스트 상세"} busy={busy} onClose={onClose}>
    <p className="quest-breadcrumb">{item.project.name} › {item.milestone.name}</p>
    <StatusBadge className={`quest-state ${pending ? "pending" : task.status}`} status={pending ? "pending" : task.status}>
      {QUEST_STATUS[pending ? "pending" : task.status]}
    </StatusBadge>
    <h2>{task.title}</h2>
    {draft ? <form onSubmit={event => { event.preventDefault(); if (draft.title.trim()) void save({ ...draft, title: draft.title.trim() }); }}>
      <fieldset disabled={busy} className="quest-edit-fields">
        <label>퀘스트 제목<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>작업 설명<textarea value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
        <QuestContextEditor value={draft.quest ?? createQuestContext()} onChange={quest => setDraft({ ...draft, quest })} disabled={busy} />
        <div className="form-actions"><Button variant="primary" type="submit">저장</Button><Button variant="secondary" onClick={() => setDraft(null)}>편집 취소</Button></div>
      </fieldset>
    </form> : <>
      {task.body && <p className="quest-body">{task.body}</p>}
      {task.quest?.goal && <section className="quest-detail-section"><h3>목표</h3><p>{task.quest.goal}</p>{task.quest.reason && <p>{task.quest.reason}</p>}</section>}
      <section className="quest-detail-section"><h3>다음 행동</h3><p>{pending ? "내용을 확인하고 퀘스트를 수락하세요." : task.quest?.nextAction || "작업 내용을 확인하고 다음 행동을 정하세요."}</p></section>
      <section className="quest-detail-section"><h3>완료 조건</h3>
        {criteria.length ? criteria.map(criterion => reviewing ? <CheckRow className="quest-criterion" key={criterion}
          checked={checked.includes(criterion)} disabled={busy}
          onChange={event => setChecked(current => event.target.checked ? [...current, criterion] : current.filter(value => value !== criterion))}>
          {criterion}
        </CheckRow> : <p key={criterion}>{criterion}</p>) : <p>등록된 완료 조건이 없습니다. 작업 내용과 결과를 직접 확인하세요.</p>}
      </section>
      <section className="quest-detail-section"><h3>연결된 결과물</h3>
        {links.length ? links.map(link => <button className="quest-source" type="button" key={link.url} disabled={busy} onClick={() => {
          setError(null); void onOpenSource(link.url).catch(() => setError("원본을 열지 못했습니다. 다시 시도하세요."));
        }}><span>{link.kind === "source" ? "원본 작업" : link.kind === "pr" ? "PR 결과물" : link.kind === "jira" ? "Jira" : "외부 항목"}</span><small>{link.url}</small><span aria-hidden="true">↗</span></button>) : <p>연결된 결과물이 없습니다.</p>}
      </section>
      {reviewing && <div className="quest-review-note">
        <p>외부 작업의 상태와 별개로, 결과를 확인한 뒤 완료해 주세요.</p>
        <CheckRow className="quest-criterion" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}>
          작업 결과와 완료 조건을 직접 확인했습니다.
        </CheckRow>
      </div>}
      {task.blocked && <p className="validation-note">진행을 막는 문제가 표시된 퀘스트입니다.</p>}
      {stageLocked && <p className="validation-note">앞선 스테이지를 완료하면 이 퀘스트를 진행할 수 있습니다.</p>}
      <div className="quest-detail-actions">
        {pending ? <Button variant="primary" disabled={busy} onClick={() => void save({ ...task, status: "todo", quest: { ...task.quest!, acceptance: "accepted" } })}>퀘스트 수락</Button>
          : task.status !== "done" && <Button variant="primary" disabled={busy || stageLocked || (reviewing && !canComplete)} onClick={() => move(advanceTaskStatus(task.status))}>
            {busy ? "저장 중…" : reviewing ? "완료 확인" : task.status === "todo" ? "퀘스트 시작" : "검토 요청"}</Button>}
        {!pending && task.status !== "todo" && <Button variant="secondary" disabled={busy} onClick={() => move(retreatTaskStatus(task.status))}>{reviewing ? "작업으로 돌아가기" : task.status === "done" ? "검토로 되돌리기" : "대기로 되돌리기"}</Button>}
      </div>
      <div className="quest-secondary-actions"><Button variant="quiet" disabled={busy} onClick={() => setDraft({ ...task, quest: task.quest ?? createQuestContext() })}>내용 편집</Button>
        {onOpenProject && <Button variant="quiet" disabled={busy} onClick={() => onOpenProject(item.project.id)}>원정 보드 열기</Button>}</div>
    </>}
    {error && <p role="alert" className="action-error">{error}</p>}
  </QuestDialog>;
}

type Entry = { key: string; title: string; status: keyof typeof QUEST_STATUS; projectId: string; context: string; next: string; todo?: InboxTodo; item?: ProjectTodo };
export function QuestHome({ headingRef, todos, projectTodos, projectGraphs, projectTodoLoadError, actionError, deletedTodo,
  onCreate, onUpdate, onDelete, onRecover, onClearActionError, onOpenProject, onOpenSource, onSaveTask }: {
  headingRef: RefObject<HTMLHeadingElement | null>; todos: InboxTodo[]; projectTodos: ProjectTodo[] | null;
  projectGraphs: ProjectGraph[] | null;
  projectTodoLoadError: string | null; actionError: string | null; deletedTodo: InboxTodo | null;
  onCreate: (title: string) => Promise<boolean>; onUpdate: (todo: InboxTodo) => Promise<boolean>;
  onDelete: (todo: InboxTodo) => Promise<boolean>; onRecover: () => Promise<boolean>; onClearActionError: () => void;
  onOpenProject: (id?: string) => void; onOpenSource: (url: string) => Promise<void>; onSaveTask: (task: Task) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState("active");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingSave = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const entries: Entry[] = [
    ...(projectTodos ?? []).map(item => ({ key: `task:${item.task.id}`, title: item.task.title,
      status: item.task.quest?.acceptance === "pending" ? "pending" as const : item.task.status,
      projectId: item.project.id, context: `${item.project.name} › ${item.milestone.name}`, next: item.task.quest?.nextAction ?? "", item })),
    ...todos.map(todo => ({ key: `inbox:${todo.id}`, title: todo.title, status: todo.completed ? "done" as const : "todo" as const,
      projectId: "inbox", context: "개인 인박스", next: "", todo })),
  ];
  const rank = (entry: Entry) => entry.status === "done" ? 5 : entry.status === "pending" ? 4 : entry.item?.task.quest?.tracked ? 0 : entry.status === "review" ? 1 : entry.status === "doing" ? 2 : 3;
  entries.sort((a, b) => rank(a) - rank(b));
  const visible = entries.filter(entry => (projectFilter === "all" || entry.projectId === projectFilter) &&
    (filter === "all" || (filter === "active" ? entry.status !== "done" : entry.status === filter)));
  function stageLocked(entry: Entry) {
    if (!entry.item) return false;
    const graph = projectGraphs?.find(graph => graph.project.id === entry.projectId);
    return !graph || !isMilestoneUnlocked(entry.item.milestone.id, graph.milestones, graph.tasks);
  }
  const featured = visible.find(entry => entry.status !== "done" && entry.status !== "pending" && !stageLocked(entry));
  const selectedEntry = entries.find(entry => entry.key === selected);
  const projects = [...new Map((projectTodos ?? []).map(item => [item.project.id, item.project])).values()];
  function open(entry: Entry) { setSelected(entry.key); setEditTitle(entry.title); setError(null); }
  async function mutate(action: () => Promise<boolean>, after: () => void) {
    if (pendingSave.current) return;
    pendingSave.current = true; setBusy(true); setError(null);
    try { if (await action()) after(); else setError("저장하지 못했습니다. 다시 시도하세요."); }
    catch { setError("저장하지 못했습니다. 다시 시도하세요."); }
    finally { pendingSave.current = false; setBusy(false); }
  }
  return <div className="quest-home">
    <header className="quest-home-heading"><h2 ref={headingRef} tabIndex={-1}><PixelIcon name="clipboard" />지금의 퀘스트</h2><p>한곳에서 확인하고, 다음 행동을 이어가세요.</p></header>
    {featured && <section className="quest-featured" aria-label="지금 이어갈 퀘스트">
      <div className="quest-row-meta"><StatusBadge className={`quest-state ${featured.status}`} status={featured.status}>{QUEST_STATUS[featured.status]}</StatusBadge><span>{featured.item?.task.quest?.tracked ? "추적 중" : "이어서 할 일"}</span></div>
      <p className="quest-breadcrumb">{featured.context}</p><h3>{featured.title}</h3>
      <p className="quest-next"><strong>다음 행동</strong>{featured.status === "review" ? "결과와 완료 조건 확인" : featured.next || "작업 내용을 확인하고 시작하기"}</p>
      <Button variant="primary" onClick={() => open(featured)}>{featured.status === "review" ? "검토 열기" : featured.status === "doing" ? "퀘스트 이어하기" : "퀘스트 열기"}</Button>
    </section>}
    <section className="quest-queue" aria-labelledby="quest-queue-title">
      <div className="section-heading"><h2 id="quest-queue-title">퀘스트 목록</h2><span className="section-note">{visible.length}개</span></div>
      <div className="quest-filters" role="group" aria-label="퀘스트 상태 필터">
        {([['active', '진행할 일'], ['all', '전체'], ...Object.entries(QUEST_STATUS)]).map(([value, label]) => <Button variant="secondary" size="small" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      <label className="quest-project-filter">원정<select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="all">모든 원정과 개인 인박스</option><option value="inbox">개인 인박스</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <form className="quest-capture" onSubmit={event => { event.preventDefault(); if (!title.trim()) { setError("퀘스트 제목을 입력하세요."); return; }
        void mutate(() => onCreate(title.trim()), () => { setTitle(""); setFilter("active"); setProjectFilter("all"); }); }}>
        <label className="sr-only" htmlFor="quick-quest-title">새 퀘스트 제목</label><input id="quick-quest-title" placeholder="새 퀘스트를 바로 적기" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} />
        <Button type="submit" variant="primary" disabled={busy}>추가</Button>
      </form>
      {error && !selectedEntry && <p role="alert" className="action-error">{error}</p>}
      {actionError && <div role="alert" className="action-error">{actionError}<button type="button" onClick={onClearActionError}>닫기</button></div>}
      {projectTodoLoadError ? <p role="alert" className="action-error">원정 퀘스트를 불러오지 못했습니다: {projectTodoLoadError}</p> : projectTodos === null && <p role="status">원정 퀘스트를 불러오는 중…</p>}
      <div className="quest-queue-list">{visible.map(entry => <button type="button" className={`quest-queue-row ${entry.status}`} key={entry.key} onClick={() => open(entry)}>
        <span className="quest-row-meta"><StatusBadge className={`quest-state ${entry.status}`} status={entry.status}>{QUEST_STATUS[entry.status]}</StatusBadge><span>{entry.item?.task.assignee === "ai" ? "AI" : "나"}</span></span>
        <strong>{entry.title}</strong><span className="quest-breadcrumb">{entry.context}</span>
        {entry.next && entry.status !== "done" && <span className="quest-row-next">다음 · {entry.next}</span>}
      </button>)}</div>
      {visible.length === 0 && <p className="panel-empty">{entries.length ? "이 필터에 해당하는 퀘스트가 없습니다." : "첫 퀘스트를 적어보세요. 작은 행동 하나면 충분합니다."}</p>}
    </section>
    {deletedTodo && <div className="undo-bar" role="status"><span>“{deletedTodo.title}” 삭제됨</span><Button variant="quiet" disabled={busy} onClick={() => void mutate(onRecover, () => undefined)}>되돌리기</Button></div>}
    {selectedEntry?.item && <QuestDetail key={selectedEntry.key} item={selectedEntry.item} stageLocked={stageLocked(selectedEntry)} onSave={onSaveTask} onClose={() => setSelected(null)} onOpenSource={onOpenSource} onOpenProject={onOpenProject} />}
    {selectedEntry?.todo && <QuestDialog title="개인 퀘스트 상세" busy={busy} onClose={() => setSelected(null)}>
      <p className="quest-breadcrumb">개인 인박스</p><h2>{selectedEntry.title}</h2>
      <form onSubmit={event => { event.preventDefault(); if (!editTitle.trim()) { setError("퀘스트 제목을 입력하세요."); return; } void mutate(() => onUpdate({ ...selectedEntry.todo!, title: editTitle.trim() }), () => setSelected(null)); }}>
        <label className="quest-edit-label">퀘스트 제목<input value={editTitle} disabled={busy} onChange={event => setEditTitle(event.target.value)} /></label>
        <div className="form-actions"><Button type="submit" variant="secondary" disabled={busy}>제목 저장</Button><Button variant="primary" disabled={busy} onClick={() => void mutate(() => onUpdate({ ...selectedEntry.todo!, completed: !selectedEntry.todo!.completed }), () => setSelected(null))}>{selectedEntry.todo.completed ? "대기로 되돌리기" : "완료 확인"}</Button></div>
      </form>
      <Button variant="danger" size="small" disabled={busy} onClick={() => void mutate(() => onDelete(selectedEntry.todo!), () => setSelected(null))}>퀘스트 삭제</Button>
      {error && <p role="alert" className="action-error">{error}</p>}
    </QuestDialog>}
  </div>;
}
