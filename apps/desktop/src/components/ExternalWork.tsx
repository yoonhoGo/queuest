import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Milestone, PluginConnection, Project, Task } from "@queuest/domain";
import { loadPluginConnections } from "../data/plugin";
import { jiraIssueToTask } from "../data/jira";
import type { JiraIssue, JiraPage } from "../data/jira";

interface ReviewPullRequest {
  number: number; title: string; url: string; repository: { nameWithOwner: string };
  author: { login: string } | null; updatedAt: string; isDraft: boolean;
}

export function GithubReviewPanel() {
  const [items, setItems] = useState<ReviewPullRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try { setItems(await invoke<ReviewPullRequest[]>("github_review_list")); }
    catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }
  return <section className="editor-panel" aria-labelledby="github-reviews-title">
    <div className="section-heading"><h3 id="github-reviews-title">확인할 GitHub PR</h3>
      <button type="button" className="small-button" disabled={loading} onClick={() => void refresh()}>{loading ? "조회 중…" : "PR 조회"}</button></div>
    <p className="field-hint">gh에 로그인한 계정으로 나에게 리뷰가 요청된 열린 PR을 조회합니다. 모든 저장소에서 최근 업데이트 순 최대 100개를 표시합니다.</p>
    {error && <p role="alert" className="validation-note">{error}</p>}
    {items?.length === 0 && <p role="status">리뷰 요청된 열린 PR이 없습니다.</p>}
    {items && <div className="github-issue-list">{items.map(pr => <article className="github-issue-row" key={pr.url}>
      <div className="github-issue-copy"><strong>{pr.title}</strong><small>{pr.repository.nameWithOwner} #{pr.number} · {pr.author?.login ?? "알 수 없는 작성자"}{pr.isDraft ? " · 초안" : ""}</small></div>
      <button type="button" className="row-action" onClick={() => void openUrl(pr.url).catch(() => setError("PR 링크를 열지 못했습니다."))}>PR 열기 ↗</button>
    </article>)}</div>}
  </section>;
}

export function JiraImportPanel({ project, milestones, tasks, defaultMilestoneId, submitting, onImport, onCancel }: {
  project: Project; milestones: Milestone[]; tasks: Task[]; defaultMilestoneId?: string;
  submitting: boolean; onImport: (tasks: Task[]) => Promise<boolean>; onCancel: () => void;
}) {
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [mode, setMode] = useState<"project" | "backlog">("project");
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ?? milestones[0]?.id ?? "");
  const [items, setItems] = useState<JiraIssue[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const seenCursors = useRef(new Set<string>());
  const connection = connections.find(item => item.connectionId === connectionId);
  const existing = useMemo(() => new Set(tasks.flatMap(task => task.externalRef ? [task.externalRef] : [])), [tasks]);
  const selectedNew = items.filter(item => selected.has(item.externalRef) && !existing.has(item.externalRef));
  useEffect(() => {
    mounted.current = true;
    loadPluginConnections().then(all => {
      if (!mounted.current) return;
      const jira = all.filter(item => item.pluginId === "com.queuest.jira");
      setConnections(jira); setConnectionId(jira[0]?.connectionId ?? "");
    }).catch(() => { if (mounted.current) setError("Jira 연결 목록을 읽지 못했습니다."); });
    return () => { mounted.current = false; };
  }, []);
  function reset() { setItems([]); setSelected(new Set()); setNextCursor(null); setLoaded(false); setError(""); seenCursors.current.clear(); }
  async function fetchPage(cursor?: string) {
    if (!connection) return;
    const boardId = connection.config.boardId ? Number(connection.config.boardId) : undefined;
    if ((mode === "backlog" || boardId !== undefined) && (!Number.isSafeInteger(boardId) || !boardId || boardId < 1)) {
      setError("플러그인 → Jira 연결 편집에서 백로그 보드 ID를 저장하세요."); return;
    }
    setLoading(true); setError("");
    if (!cursor) { reset(); }
    try {
      const page = await invoke<JiraPage>("jira_issue_list", { query: {
        connectionId, projectKey: connection.config.projectKey, siteUrl: connection.config.siteUrl,
        email: connection.config.email, boardId, backlogOnly: mode === "backlog", cursor, approved: true,
      } });
      if (!mounted.current) return;
      if (cursor) seenCursors.current.add(cursor);
      if (page.nextCursor && seenCursors.current.has(page.nextCursor)) throw new Error("Jira 페이지가 반복되었습니다. 처음부터 다시 조회하세요.");
      setItems(current => [...new Map([...(cursor ? current : []), ...page.items].map(item => [item.externalRef, item])).values()]);
      setNextCursor(page.nextCursor); setLoaded(true);
    } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { if (mounted.current) setLoading(false); }
  }
  async function importSelected() {
    if (!milestones.some(item => item.id === milestoneId) || selectedNew.length === 0) return;
    setError("");
    if (!(await onImport(selectedNew.map(item => jiraIssueToTask(item, project, milestoneId))))) setError("일부 항목을 저장하지 못했습니다. 이미 저장된 항목을 제외하고 다시 시도하세요.");
  }
  return <section className="editor-panel github-import-panel jira-import-panel" aria-labelledby="jira-import-title">
    <div className="section-heading"><h2 id="jira-import-title">Jira 퀘스트 가져오기</h2><span className="section-note">읽기 전용</span></div>
    {connections.length === 0 && <p>플러그인 화면에서 Jira 연결을 먼저 저장하세요.</p>}
    <div className="editor-grid">
      <label>Jira 연결<select value={connectionId} disabled={loading || submitting} onChange={e => { setConnectionId(e.target.value); reset(); }}>
        {connections.map(item => <option key={item.connectionId} value={item.connectionId}>{item.label} · {item.config.projectKey}</option>)}
      </select></label>
      <label>가져올 범위<select value={mode} disabled={loading || submitting} onChange={e => { setMode(e.target.value as typeof mode); reset(); }}>
        <option value="project">프로젝트 티켓</option><option value="backlog">보드 백로그 → 미수락 퀘스트</option>
      </select></label>
      <label>저장할 스테이지<select value={milestoneId} disabled={submitting} onChange={e => setMilestoneId(e.target.value)}>
        {milestones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    <p className="field-hint">{mode === "backlog" ? "백로그 티켓은 미수락으로 저장됩니다. 퀘스트를 수락한 뒤 진행할 수 있습니다." : "Jira 진행 중은 진행 중으로, 완료는 검토 대기로 가져옵니다. 보드 ID가 설정되어 있으면 해당 보드의 백로그 티켓은 자동으로 미수락 처리합니다. 보드 ID가 없으면 백로그 여부를 구분하지 않습니다."}</p>
    <p className="field-hint">조회 시 이 연결의 Keychain 인증 정보와 Jira 사이트({connection?.config.siteUrl ?? "미설정"}) 접근을 허용합니다. Jira 원본은 변경하지 않습니다.</p>
    <div className="import-toolbar">
      <button type="button" className="small-button" disabled={!connection || loading || submitting} onClick={() => void fetchPage()}>접근 허용하고 조회</button>
      {nextCursor && <button type="button" className="small-button" disabled={loading || submitting} onClick={() => void fetchPage(nextCursor)}>다음 페이지</button>}
      <button type="button" className="small-button" disabled={loading || submitting || !items.length} onClick={() => setSelected(new Set(items.filter(item => !existing.has(item.externalRef)).map(item => item.externalRef)))}>조회된 새 티켓 모두 선택</button>
      <span className="section-note">{items.length}개 조회 · {selectedNew.length}개 선택</span>
    </div>
    {loading && <p role="status">Jira 티켓을 불러오는 중…</p>}
    {error && <p role="alert" className="validation-note">{error}</p>}
    {loaded && !items.length && <p role="status">조회 가능한 티켓이 없습니다. 프로젝트·보드와 접근 권한을 확인하세요.</p>}
    <div className="github-issue-list">{items.map(item => <div className="github-issue-row" key={item.externalRef}>
      <label className="github-issue-select"><input type="checkbox" disabled={existing.has(item.externalRef) || submitting || loading} checked={!existing.has(item.externalRef) && selected.has(item.externalRef)} onChange={e => {
        const checked = e.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(item.externalRef); else next.delete(item.externalRef); return next; });
      }} /><span className="github-issue-copy"><strong>{item.key} · {item.title}</strong><small>{item.status}{item.backlog ? " · 미수락으로 저장" : ""}{existing.has(item.externalRef) ? " · 이미 가져옴" : ""}</small></span></label>
      <button type="button" className="row-action" onClick={() => void openUrl(item.url).catch(() => setError("Jira 링크를 열지 못했습니다."))}>원본</button>
    </div>)}</div>
    <div className="form-actions"><button type="button" className="primary-button" disabled={loading || submitting || !milestoneId || !selectedNew.length} onClick={() => void importSelected()}>{submitting ? "저장 중…" : "선택한 티켓 가져오기"}</button>
      <button type="button" className="small-button" disabled={loading || submitting} onClick={onCancel}>닫기</button></div>
  </section>;
}

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
