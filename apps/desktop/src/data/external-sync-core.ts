import type { PluginConnection, ProjectGraph, Task } from "@queuest/domain";

export interface SyncStore {
  listPluginConnections(): Promise<PluginConnection[]>;
  listProjectGraphs(): Promise<ProjectGraph[]>;
  saveWorkspace(workspace: ProjectGraph["workspace"]): Promise<void>;
  saveProject(project: ProjectGraph["project"]): Promise<void>;
  saveMilestone(milestone: ProjectGraph["milestones"][number]): Promise<void>;
  saveTask(task: Task): Promise<void>;
}
export type RemoteTask = Omit<Task, "id" | "milestoneId">;
export interface WorkPage { items: RemoteTask[]; nextCursor: string | null }
export const isWorkConnection = (connection: PluginConnection) =>
  ["com.queuest.jira", "com.queuest.github"].includes(connection.pluginId);

/** Single-flight caller; append only, so human edits and completion are never overwritten. */
export async function syncConnections(store: SyncStore, fetchPage: (connection: PluginConnection, cursor?: string) => Promise<WorkPage>) {
  const errors: string[] = [];
  let added = 0;
  for (const connection of (await store.listPluginConnections()).filter(isWorkConnection)) {
    try {
      if (!connection.credentialStored) throw new Error("credential missing");
      const key = `${connection.pluginId}:${connection.connectionId}`;
      const workspace = { id: `sync:${key}`, name: connection.label };
      const project = { id: `sync:${key}`, workspaceId: workspace.id, name: connection.label, skills: [] };
      const milestone = { id: `sync:${key}`, projectId: project.id, name: "퀘스트", order: 1 };
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let pageNumber = 0; ; pageNumber++) {
        if (pageNumber >= 100) throw new Error("page limit");
        const page = await fetchPage(connection, cursor);
        // A connection may be edited/deleted while its request is in flight.
        const current = (await store.listPluginConnections()).find(item => item.pluginId === connection.pluginId && item.connectionId === connection.connectionId);
        if (!current || current.updatedAt !== connection.updatedAt) break;
        const graphs = await store.listProjectGraphs();
        const existing = new Set(graphs.flatMap(graph => graph.tasks.map(task => task.externalRef)));
        const fresh = page.items.filter(task => task.externalRef && !existing.has(task.externalRef));
        if (fresh.length) {
          const target = graphs.find(graph => graph.project.id === project.id);
          if (!target) {
            await store.saveWorkspace(workspace);
            await store.saveProject(project);
            await store.saveMilestone(milestone);
          } else if (!target.milestones.some(item => item.id === milestone.id)) {
            await store.saveMilestone(milestone);
          }
          for (const task of fresh) {
            if (existing.has(task.externalRef)) continue;
            await store.saveTask({ ...task, id: crypto.randomUUID(), milestoneId: milestone.id,
              status: task.status === "done" ? "review" : task.status });
            existing.add(task.externalRef);
            added++;
          }
        }
        if (!page.nextCursor) break;
        if (seen.has(page.nextCursor)) throw new Error("repeated cursor");
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    } catch {
      // Never display provider response bodies, credentials or transport errors.
      errors.push(`${connection.label}: 작업을 확인하지 못했습니다. 연결 정보와 조회 권한을 확인하고 다시 새로고침하세요.`);
    }
  }
  return { added, errors };
}
