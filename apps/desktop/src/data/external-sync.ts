import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PluginConnection } from "@queuest/domain";
import { getRepository } from "./repository";
import { jiraIssueToTask, type JiraPage } from "./jira";
import { syncConnections, type WorkPage } from "./external-sync-core";

export const EXTERNAL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const SYNC_UPDATED = "queuest:external-work-updated";
interface SyncSnapshot { running: boolean; lastSuccess: string | null; errors: string[] }
let snapshot: SyncSnapshot = { running: false, lastSuccess: null, errors: [] };
const listeners = new Set<() => void>();
let running: Promise<void> | undefined;
export const getSyncSnapshot = () => snapshot;
export function subscribeSync(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(next: SyncSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }

async function fetchPage(connection: PluginConnection, cursor?: string): Promise<WorkPage> {
  if (connection.pluginId === "com.queuest.jira") {
    const page = await invoke<JiraPage>("jira_issue_list", { query: {
      connectionId: connection.connectionId, ...connection.config,
      boardId: connection.config.boardId ? Number(connection.config.boardId) : undefined,
      backlogOnly: false, cursor, approved: true,
    } });
    return { nextCursor: page.nextCursor, items: page.items.map(issue => jiraIssueToTask(issue,
      { id: "", workspaceId: "", name: "", skills: [] }, "")) };
  }
  const reviews = cursor?.startsWith("reviews:") ?? false;
  const page = await invoke<WorkPage>("github_connection_work", { connectionId: connection.connectionId,
    repository: connection.config.repository, page: cursor ? Number(cursor.replace("reviews:", "")) : 1, reviews });
  return { items: page.items, nextCursor: reviews
    ? (page.nextCursor ? `reviews:${page.nextCursor}` : null)
    : (page.nextCursor ?? "reviews:1") };

}

export function refreshExternalWork(afterCurrent = false): Promise<void> {
  if (running) return afterCurrent ? running.then(() => refreshExternalWork()) : running;
  publish({ ...snapshot, running: true, errors: [] });
  running = (async () => {
    try {
      const result = await syncConnections(await getRepository(), fetchPage);
      publish({ running: false, lastSuccess: result.errors.length ? snapshot.lastSuccess : new Date().toISOString(), errors: result.errors });
    } catch {
      publish({ ...snapshot, running: false, errors: ["연결 설정을 읽지 못했습니다. 다시 새로고침하세요."] });
    } finally {
      // Also reload partially saved pages if a later request failed.
      window.dispatchEvent(new Event(SYNC_UPDATED));
      running = undefined;
    }
  })();
  return running;
}

export function startExternalSync() {
  if (!isTauri()) return () => {};
  void refreshExternalWork();
  const timer = window.setInterval(() => void refreshExternalWork(), EXTERNAL_SYNC_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
