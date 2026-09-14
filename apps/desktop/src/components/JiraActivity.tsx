import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadPluginConnections } from "../data/plugin";

interface MonitorView {
  notices: { id: number; title: string; detail: string; url: string }[];
  errors: Record<string, string>;
  lastChecked: number | null;
  connectionCount: number;
}

/** The native service owns polling; mounting this view never resets its baseline. */
export function JiraActivity() {
  const [view, setView] = useState<MonitorView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let revision = 0;
    const update = (next: MonitorView) => { if (!disposed) setView(next); };
    const subscription = listen<MonitorView>("jira-monitor-updated", event => update(event.payload));
    async function configure() {
      const currentRevision = ++revision;
      try {
        const connections = await loadPluginConnections();
        if (disposed || currentRevision !== revision) return;
        await invoke("jira_monitor_configure", { queries: connections
          .filter(c => c.pluginId === "com.queuest.jira" && c.credentialStored)
          .map(c => ({ connectionId: c.connectionId, projectKey: c.config.projectKey,
            siteUrl: c.config.siteUrl, email: c.config.email,
            boardId: null, backlogOnly: false, cursor: null, approved: true })) });
        update(await invoke<MonitorView>("jira_monitor_status"));
        if (!disposed) setError("");
      } catch { if (!disposed) setError("Jira 백그라운드 조회를 시작하지 못했습니다. 연결 설정을 확인하세요."); }
    }
    const changed = () => { void configure(); };
    window.addEventListener("plugin-connections-changed", changed);
    void subscription.then(() => { if (!disposed) void configure(); }).catch(() => {
      if (!disposed) setError("Jira 알림을 연결하지 못했습니다.");
    });
    return () => { disposed = true; window.removeEventListener("plugin-connections-changed", changed); void subscription.then(unlisten => unlisten()).catch(() => undefined); };
  }, []);
  if (!error && !view?.connectionCount && !view?.notices.length) return null;
  return <section className="editor-panel" aria-label="Jira 알림">
    <div className="section-heading"><h3>Jira 알림</h3>
      {!!view?.notices.length && <button type="button" className="small-button" onClick={() => {
        void invoke("jira_monitor_clear").then(() => invoke<MonitorView>("jira_monitor_status")).then(setView)
          .catch(() => setError("알림을 지우지 못했습니다."));
      }}>알림 지우기</button>}
    </div>
    <p className="field-hint">앱 실행 중 5분마다 연결된 Jira 프로젝트를 확인합니다. 첫 조회는 비교 기준으로 저장하며, 이후 새 티켓과 상태 변경을 알립니다. 본문은 Jira 원문에서 확인하세요.</p>
    <p className="section-note" role="status">{view?.lastChecked ? `마지막 확인 ${new Date(view.lastChecked * 1000).toLocaleTimeString("ko-KR")}` : "첫 조회 대기 중"}{view ? ` · 알림 ${view.notices.length}개` : ""}</p>
    {error && <p role="alert" className="validation-note">{error}</p>}
    {Object.entries(view?.errors ?? {}).map(([id, message]) => <p role="alert" className="validation-note" key={id}>{id}: {message}</p>)}
    {!!view?.notices.length && <details><summary>최근 Jira 변경 보기</summary>
      <div className="github-issue-list">{view.notices.map(notice => <article className="github-issue-row" key={notice.id}>
        <div className="github-issue-copy"><strong>{notice.title}</strong><small>{notice.detail}</small></div>
        <button type="button" className="row-action jira-source-link" onClick={() => void openUrl(notice.url).catch(() => setError("Jira 링크를 열지 못했습니다."))}>Jira 원문 ↗</button>
      </article>)}</div>
    </details>}
  </section>;
}
