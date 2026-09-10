import type { QuestContext, Task } from "@queuest/domain";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./QuestContext.css";

const roles = { main: "메인", side: "서브" };
const cadences = { once: "단발", daily: "일일", weekly: "주간" };
const challenges = { normal: "일반", boss: "보스 토벌", raid: "레이드", event: "기간 한정 이벤트" };
const kinds = { jira: "Jira", issue: "GitHub Issue", pr: "PR 결과물", event: "Calendar 일정", reminder: "Reminder" };

export function QuestContextEditor({ value, onChange, disabled }: {
  value: QuestContext; onChange: (value: QuestContext) => void; disabled: boolean;
}) {
  function update(patch: Partial<QuestContext>) { onChange({ ...value, ...patch }); }
  return <fieldset disabled={disabled} className="quest-context-editor">
    <legend>목표와 퀘스트 역할</legend>
    {([['goal', '이 퀘스트가 기여하는 목표'], ['reason', '이 일을 하는 이유'],
      ['nextAction', '다음 행동'], ['successCriteria', '성공 조건']] as const).map(([key, label]) =>
      <label key={key}>{label}<input value={value[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}
    <div className="editor-grid">
      <label>목표와의 관계<select value={value.role} onChange={e => update({ role: e.target.value as QuestContext['role'] })}>
        {Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>반복 분류<select value={value.cadence} onChange={e => update({ cadence: e.target.value as QuestContext['cadence'] })}>
        {Object.entries(cadences).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>도전 성격<select value={value.challenge} onChange={e => update({ challenge: e.target.value as QuestContext['challenge'] })}>
        {Object.entries(challenges).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>수행 예정 시간<input type="datetime-local" value={value.scheduledAt} onChange={e => update({ scheduledAt: e.target.value })} /></label>
    </div>
    <label><input type="checkbox" checked={value.tracked} onChange={e => update({ tracked: e.target.checked })} /> 할 일 화면에서 추적</label>
    <p className="section-note">일일·주간은 분류입니다. 다음 회차는 자동 생성되지 않습니다.</p>
    <p>연결된 작업·결과물·일정</p>
    {value.links.map((link, index) => <div className="editor-grid" key={index}>
      <label>연결 종류<select value={link.kind} onChange={e => update({ links: value.links.map((item, i) => i === index ? { ...item, kind: e.target.value as typeof link.kind } : item) })}>
        {Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>원본 URL<input type="url" required pattern="https?://.*" value={link.url} onChange={e => update({ links: value.links.map((item, i) => i === index ? { ...item, url: e.target.value } : item) })} /></label>
      <button type="button" className="row-action" onClick={() => update({ links: value.links.filter((_, i) => i !== index) })}>연결 제거</button>
    </div>)}
    <button type="button" className="row-action" onClick={() => update({ links: [...value.links, { kind: "issue", url: "" }] })}>외부 항목 연결</button>
  </fieldset>;
}

export function QuestContextSummary({ task }: { task: Task }) {
  const [linkError, setLinkError] = useState(false);
  const quest = task.quest;
  if (!quest) return null;
  return <div className="quest-context-summary">
    <div className="card-tags">{quest.acceptance === "pending" && <span>미수락</span>}<span>{roles[quest.role]}</span><span>{cadences[quest.cadence]}</span>
      {quest.challenge !== "normal" && <span>{challenges[quest.challenge]}</span>}
      {quest.tracked && task.status !== "done" && <span>추적 중</span>}
    </div>
    {quest.goal && <p>목표: {quest.goal}</p>}
    {quest.reason && <p>이유: {quest.reason}</p>}
    {quest.nextAction && <p>다음 행동: {quest.nextAction}</p>}
    {quest.successCriteria && <p>성공 조건: {quest.successCriteria}</p>}
    {quest.scheduledAt && <p>수행 예정: <time dateTime={quest.scheduledAt}>{quest.scheduledAt.replace("T", " ")}</time></p>}
    {quest.links.filter(link => /^https?:\/\//i.test(link.url)).map((link, index) =>
      <button type="button" className="row-action" key={index} onClick={() => {
        setLinkError(false);
        void openUrl(link.url).catch(() => setLinkError(true));
      }}>{kinds[link.kind]} ↗</button>)}
    {linkError && <p role="alert">원본 링크를 열지 못했습니다. 다시 시도하세요.</p>}
  </div>;
}
