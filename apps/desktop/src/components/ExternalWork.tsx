import type { Task } from "@queuest/domain";

export function PendingQuestPanel({ tasks, submitting, onAccept, onEdit, onOpenSource, onDelete }: {
  tasks: Task[]; submitting: boolean; onAccept: (task: Task) => Promise<boolean>;
  onEdit: (task: Task) => void; onOpenSource: (task: Task) => void; onDelete: (task: Task) => void;
}) {
  const pending = tasks.filter(task => task.quest?.acceptance === "pending");
  if (!pending.length) return null;
  return <section className="editor-panel" aria-label="미수락 퀘스트">
    <h3>미수락 퀘스트</h3><p className="field-hint">Jira 백로그에서 가져온 제안입니다. 수락하면 대기 퀘스트가 됩니다.</p>
    {pending.map(task => <article className="github-issue-row pending-quest-row" key={task.id}>
      <div className="github-issue-copy"><strong>{task.title}</strong><small>{task.body}</small></div>
      <div className="card-actions">
        <button type="button" className="small-button" disabled={submitting} onClick={() => void onAccept(task)}>수락</button>
        <button type="button" className="row-action" disabled={submitting} onClick={() => onEdit(task)}>편집</button>
        <button type="button" className="row-action" onClick={() => onOpenSource(task)}>원본</button>
        <button type="button" className="row-action danger" disabled={submitting} onClick={() => onDelete(task)}>삭제</button>
      </div>
    </article>)}
  </section>;
}
