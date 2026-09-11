import { invoke } from "@tauri-apps/api/core";
import type { Milestone, PluginConnection, Project, ProjectGraph, Task, Workspace } from "@queuest/domain";
import type { GithubIssue } from "@queuest/adapter-github";
import { githubIssueExternalRef, githubIssueToTask } from "@queuest/adapter-github";
import { jiraIssueToTask, type JiraIssue, type JiraPage } from "./jira";
import { loadPluginConnections } from "./plugin";
import { loadProjectGraphs, loadWorkspaces, saveMilestone, saveProject, saveTask, saveWorkspace } from "./project";

export const EXTERNAL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface ExternalSyncResult { connections: number; created: number; updated: number }

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function ensureWorkspace(id: string, name: string, workspaces: Workspace[]): Promise<Workspace> {
  const existing = workspaces.find(item => item.id === id);
  if (existing) return existing;
  const workspace = { id, name };
  await saveWorkspace(workspace);
  workspaces.push(workspace);
  return workspace;
}

async function ensureProject(
  id: string,
  name: string,
  workspace: Workspace,
  graphs: ProjectGraph[],
  repoPath?: string,
): Promise<{ project: Project; milestone: Milestone; tasks: Task[] }> {
  const graph = graphs.find(item => item.project.id === id);
  if (graph) {
    const milestone = graph.milestones[0] ?? { id: `${id}-inbox`, projectId: id, name: "가져온 퀘스트", order: 1 };
    if (!graph.milestones.length) await saveMilestone(milestone);
    return { project: graph.project, milestone, tasks: graph.tasks };
  }
  const project: Project = { id, workspaceId: workspace.id, name, skills: [], ...(repoPath ? { repoPath } : {}) };
  const milestone: Milestone = { id: `${id}-inbox`, projectId: id, name: "가져온 퀘스트", order: 1 };
  await saveProject(project);
  await saveMilestone(milestone);
  graphs.push({ workspace, project, milestones: [milestone], tasks: [] });
  return { project, milestone, tasks: [] };
}

async function fetchAllJira(connection: PluginConnection): Promise<JiraIssue[]> {
  const items: JiraIssue[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await invoke<JiraPage>("jira_issue_list", { query: {
      connectionId: connection.connectionId,
      siteUrl: connection.config.siteUrl,
      email: connection.config.email,
      boardId: connection.config.boardId ? Number(connection.config.boardId) : undefined,
      backlogOnly: false,
      cursor,
      approved: true,
    } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && !seen.add(cursor)) throw new Error("Jira 페이지가 반복되었습니다.");
  } while (cursor);
  return items;
}

async function upsertTask(next: Task, existing: Task | undefined): Promise<"created" | "updated" | "unchanged"> {
  if (!existing) {
    await saveTask(next);
    return "created";
  }
  const updated = {
    ...existing,
    title: next.title,
    body: next.body,
    status: next.status,
    sourceUrl: next.sourceUrl,
    ...(next.status === "done" && existing.quest
      ? { quest: { ...existing.quest, acceptance: "accepted" as const } }
      : {}),
  };
  if (JSON.stringify(updated) === JSON.stringify(existing)) return "unchanged";
  await saveTask(updated);
  return "updated";
}

async function syncJira(connection: PluginConnection, workspaces: Workspace[], graphs: ProjectGraph[]): Promise<ExternalSyncResult> {
  const issues = await fetchAllJira(connection);
  const workspace = await ensureWorkspace(`sync-jira-${safeId(connection.connectionId)}`, `Jira · ${connection.label}`, workspaces);
  const epics = new Map(issues.filter(issue => issue.isEpic).map(issue => [issue.key, issue]));
  let created = 0;
  let updated = 0;
  for (const epic of epics.values()) {
    await ensureProject(`sync-jira-${safeId(connection.connectionId)}-${safeId(epic.key)}`, `${epic.key} · ${epic.title}`, workspace, graphs);
  }
  for (const issue of issues) {
    if (issue.isEpic) continue;
    const expeditionKey = issue.parentKey ?? "assigned";
    const epic = issue.parentKey ? epics.get(issue.parentKey) : undefined;
    const target = await ensureProject(
      `sync-jira-${safeId(connection.connectionId)}-${safeId(expeditionKey)}`,
      epic ? `${epic.key} · ${epic.title}` : issue.parentKey ? `Epic ${issue.parentKey}` : `내 Jira 퀘스트 · ${connection.label}`,
      workspace,
      graphs,
    );
    const existing = graphs.flatMap(graph => graph.tasks).find(task => task.externalRef === issue.externalRef);
    const result = await upsertTask(jiraIssueToTask(issue, target.project, target.milestone.id), existing);
    if (result === "created") created += 1;
    if (result === "updated") updated += 1;
  }
  return { connections: 1, created, updated };
}

async function syncGithub(connection: PluginConnection, workspaces: Workspace[], graphs: ProjectGraph[]): Promise<ExternalSyncResult> {
  const repository = connection.config.repository;
  if (!repository) throw new Error(`${connection.label}: GitHub 저장소가 없습니다.`);
  const issues = await invoke<GithubIssue[]>("github_connection_issue_list", { connectionId: connection.connectionId, repository });
  const workspace = await ensureWorkspace(`sync-github-${safeId(connection.connectionId)}`, `GitHub · ${connection.label}`, workspaces);
  const target = await ensureProject(`sync-github-${safeId(connection.connectionId)}`, repository, workspace, graphs);
  let created = 0;
  let updated = 0;
  for (const issue of issues) {
    const externalRef = githubIssueExternalRef(issue);
    const existing = graphs.flatMap(graph => graph.tasks).find(task => task.externalRef === externalRef);
    const result = await upsertTask(githubIssueToTask(issue, target.project, target.milestone.id), existing);
    if (result === "created") created += 1;
    if (result === "updated") updated += 1;
  }
  return { connections: 1, created, updated };
}

export async function syncExternalConnections(only?: PluginConnection): Promise<ExternalSyncResult> {
  const [connections, workspaces, graphs] = await Promise.all([loadPluginConnections(), loadWorkspaces(), loadProjectGraphs()]);
  const selected = (only ? [only] : connections).filter(connection =>
    connection.credentialStored && (connection.pluginId === "com.queuest.jira" || connection.pluginId === "com.queuest.github"));
  const total: ExternalSyncResult = { connections: 0, created: 0, updated: 0 };
  for (const connection of selected) {
    const result = connection.pluginId === "com.queuest.jira"
      ? await syncJira(connection, workspaces, graphs)
      : await syncGithub(connection, workspaces, graphs);
    total.connections += result.connections;
    total.created += result.created;
    total.updated += result.updated;
  }
  return total;
}
