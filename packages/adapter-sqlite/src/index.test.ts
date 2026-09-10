import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type Database from "@tauri-apps/plugin-sql";
import type {
  Character,
  Loadout,
  Milestone,
  PluginConnection,
  Project,
  Task,
  TaskComment,
  Workspace,
} from "@queuest/domain";
import { SqliteTaskRepository } from "./index.ts";

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindQuery(query: string, values: unknown[]): string {
  return query.replace(/\$(\d+)/g, (_match, index: string) =>
    sqlLiteral(values[Number(index) - 1]),
  );
}

class SqliteCliDatabase {
  private readonly path: string;

  public constructor(path: string) {
    this.path = path;
  }

  public async execute(
    query: string,
    values: unknown[] = [],
  ): Promise<{ rowsAffected: number; lastInsertId: number }> {
    execFileSync("sqlite3", [this.path, `PRAGMA foreign_keys = ON; ${bindQuery(query, values)}`], {
      encoding: "utf8",
    });
    return { rowsAffected: 0, lastInsertId: 0 };
  }

  public async select<T>(query: string, values: unknown[] = []): Promise<T> {
    const output = execFileSync(
      "sqlite3",
      ["-json", this.path, `PRAGMA foreign_keys = ON; ${bindQuery(query, values)}`],
      { encoding: "utf8" },
    ).trim();
    return (output ? JSON.parse(output) : []) as T;
  }
}

test("SQLite repository survives reload and cascades child records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "queuest-sqlite-test-"));
  const databasePath = join(directory, "queuest.db");

  try {
    const workspace: Workspace = { id: "workspace-1", name: "내 원정" };
    const renamedWorkspace: Workspace = { ...workspace, name: "수정된 원정" };
    const emptyWorkspace: Workspace = { id: "workspace-2", name: "빈 작업 공간" };
    const project: Project = {
      id: "project-1",
      workspaceId: workspace.id,
      name: "테스트 프로젝트",
      repoPath: directory,
      skills: ["typescript"],
    };
    const milestone: Milestone = {
      id: "milestone-1",
      projectId: project.id,
      name: "첫 스테이지",
      order: 1,
    };
    const comment: TaskComment = {
      id: "comment-1",
      taskId: "task-1",
      body: "검토 메모",
      author: "human",
      createdAt: "2026-09-09T00:00:00.000Z",
    };
    const savedTask: Task = {
      id: "task-1",
      milestoneId: milestone.id,
      title: "저장되는 퀘스트",
      quest: { acceptance: "accepted", goal: "베타 출시", reason: "사용자 피드백", nextAction: "테스트 작성",
        role: "main", cadence: "weekly", challenge: "boss", tracked: true,
        successCriteria: "첫 사용자 완료", scheduledAt: "2026-09-10T14:00",
        links: [{ kind: "jira", url: "https://example.atlassian.net/browse/Q-1" },
          { kind: "pr", url: "https://github.com/example/queuest/pull/2" }] },
      body: "저장소 round-trip",
      status: "review",
      assignee: "human",
      skills: ["typescript"],
      blocked: false,
      sourceUrl: "https://github.com/example/queuest/issues/1",
      comments: [comment],
    };
    const character: Character = {
      name: "원정대장",
      job: "planner",
      spriteId: "planner",
    };
    const loadout: Loadout = {
      projectId: project.id,
      agentTool: "claude",
    };
    const pluginConnection: PluginConnection = {
      pluginId: "com.queuest.github",
      connectionId: "github-personal",
      label: "개인 GitHub",
      config: { repository: "example/queuest" },
      credentialStored: true,
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    const updatedComment: TaskComment = {
      ...comment,
      body: "수정된 검토 메모",
    };
    const persistedTask: Task = {
      ...savedTask,
      comments: [updatedComment],
    };

    const database = new SqliteCliDatabase(databasePath);
    const repository = new SqliteTaskRepository(database as unknown as Database);
    await repository.initialize();
    await repository.saveWorkspace(workspace);
    assert.deepEqual(await repository.listWorkspaces(), [workspace]);
    await repository.saveWorkspace(renamedWorkspace);
    await repository.saveWorkspace(emptyWorkspace);
    assert.deepEqual(await repository.listWorkspaces(), [emptyWorkspace, renamedWorkspace]);
    await repository.saveProject(project);
    await repository.saveMilestone(milestone);
    await repository.saveTask(savedTask);
    await repository.saveTaskComment(updatedComment);
    await repository.saveCharacter(character);
    await repository.saveLoadout(loadout);
    await repository.savePluginConnection(pluginConnection);
    assert.deepEqual(await repository.listPluginConnections(), [pluginConnection]);
    const pluginConnectionRows = await database.select<{ config: string }[]>(
      "SELECT config FROM plugin_connections WHERE plugin_id = 'com.queuest.github'",
    );
    assert.deepEqual(pluginConnectionRows, [{ config: '{"repository":"example/queuest"}' }]);

    const reloadedDatabase = new SqliteCliDatabase(databasePath);
    const reloadedRepository = new SqliteTaskRepository(
      reloadedDatabase as unknown as Database,
    );
    await reloadedRepository.initialize();
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), [
      {
        workspace: renamedWorkspace,
        project,
        milestones: [milestone],
        tasks: [persistedTask],
        loadout,
      },
    ]);
    assert.deepEqual(await reloadedRepository.listProjectTodos(), [
      {
        workspace: renamedWorkspace,
        project,
        milestone,
        task: {
          id: persistedTask.id,
          milestoneId: persistedTask.milestoneId,
          title: persistedTask.title,
          body: persistedTask.body,
          status: persistedTask.status,
          assignee: persistedTask.assignee,
          skills: persistedTask.skills,
          blocked: persistedTask.blocked,
          sourceUrl: persistedTask.sourceUrl,
          quest: persistedTask.quest,
        },
      },
    ]);
    assert.deepEqual(await reloadedRepository.listTaskComments(savedTask.id), [updatedComment]);
    assert.deepEqual(await reloadedRepository.getCharacter(), character);
    assert.deepEqual(await reloadedRepository.getLoadout(project.id), loadout);
    assert.deepEqual(await reloadedRepository.listPluginConnections(), [pluginConnection]);
    await reloadedRepository.deleteTaskComment(updatedComment.id);
    assert.deepEqual(await reloadedRepository.listTaskComments(savedTask.id), []);
    await reloadedRepository.saveTaskComment(updatedComment);

    await reloadedRepository.savePluginConnection({
      ...pluginConnection,
      credentialStored: false,
      config: { repository: "example/queuest-updated" },
      updatedAt: "2026-09-09T01:00:00.000Z",
    });
    assert.deepEqual(await reloadedRepository.listPluginConnections(), [{
      ...pluginConnection,
      credentialStored: false,
      config: { repository: "example/queuest-updated" },
      updatedAt: "2026-09-09T01:00:00.000Z",
    }]);
    await reloadedRepository.deletePluginConnection(
      pluginConnection.pluginId,
      pluginConnection.connectionId,
    );
    assert.deepEqual(await reloadedRepository.listPluginConnections(), []);

    await reloadedRepository.deleteMilestone(milestone.id);
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), [
      {
        workspace: renamedWorkspace,
        project,
        milestones: [],
        tasks: [],
        loadout,
      },
    ]);
    const comments = await reloadedDatabase.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM task_comments",
    );
    assert.equal(comments[0]?.count, 0);

    await reloadedRepository.deleteProject(project.id);
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), []);

    const cascadeProject: Project = {
      ...project,
      id: "project-2",
      workspaceId: renamedWorkspace.id,
      name: "워크스페이스 삭제 프로젝트",
    };
    const cascadeMilestone: Milestone = {
      ...milestone,
      id: "milestone-2",
      projectId: cascadeProject.id,
    };
    const cascadeTask: Task = {
      id: "task-2",
      milestoneId: cascadeMilestone.id,
      title: savedTask.title,
      body: savedTask.body,
      status: savedTask.status,
      assignee: savedTask.assignee,
      skills: savedTask.skills,
      blocked: savedTask.blocked,
    };
    await reloadedRepository.saveProject(cascadeProject);
    await reloadedRepository.saveMilestone(cascadeMilestone);
    await reloadedRepository.saveTask(cascadeTask);
    await reloadedRepository.saveLoadout({ ...loadout, projectId: cascadeProject.id });
    assert.equal((await reloadedRepository.listProjectGraphs()).length, 1);

    await reloadedRepository.deleteWorkspace(renamedWorkspace.id);
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), []);
    assert.deepEqual(await reloadedRepository.listWorkspaces(), [emptyWorkspace]);
    await reloadedRepository.deleteWorkspace(emptyWorkspace.id);
    assert.deepEqual(await reloadedRepository.listWorkspaces(), []);
    const loadouts = await reloadedDatabase.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM loadouts",
    );
    assert.equal(loadouts[0]?.count, 0);
    const characters = await reloadedDatabase.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM characters",
    );
    assert.equal(characters[0]?.count, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("adds source URL support when opening a legacy tasks table", async () => {
  const directory = mkdtempSync(join(tmpdir(), "queuest-sqlite-migration-test-"));
  const databasePath = join(directory, "queuest.db");

  try {
    const database = new SqliteCliDatabase(databasePath);
    await database.execute(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        assignee TEXT NOT NULL,
        skills TEXT NOT NULL DEFAULT '[]',
        blocked INTEGER NOT NULL DEFAULT 0,
        external_ref TEXT
      )
    `);

    const repository = new SqliteTaskRepository(database as unknown as Database);
    await repository.initialize();
    const columns = await database.select<Array<{ name: string }>>(
      "PRAGMA table_info(tasks)",
    );
    assert.equal(columns.some((column) => column.name === "source_url"), true);

    const workspace: Workspace = { id: "legacy-workspace", name: "기존 작업 공간" };
    const project: Project = {
      id: "legacy-project",
      workspaceId: workspace.id,
      name: "기존 프로젝트",
      skills: [],
    };
    const milestone: Milestone = {
      id: "legacy-milestone",
      projectId: project.id,
      name: "기존 스테이지",
      order: 1,
    };
    const task: Task = {
      id: "legacy-task",
      milestoneId: milestone.id,
      title: "원본 링크가 있는 기존 태스크",
      body: "",
      status: "todo",
      assignee: "human",
      skills: [],
      blocked: false,
      sourceUrl: "https://github.com/example/queuest/issues/9",
    };
    await repository.saveWorkspace(workspace);
    await repository.saveProject(project);
    await repository.saveMilestone(milestone);
    await repository.saveTask(task);
    assert.equal((await repository.listProjectGraphs())[0]?.tasks[0]?.sourceUrl, task.sourceUrl);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("Jira backlog acceptance persists across repository reloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "queuest-jira-acceptance-"));
  try {
    const databasePath = join(directory, "test.db");
    const open = async () => {
      const repository = new SqliteTaskRepository(new SqliteCliDatabase(databasePath) as unknown as Database);
      await repository.initialize(); return repository;
    };
    const repository = await open();
    await repository.saveWorkspace({ id: "w", name: "Test" });
    await repository.saveProject({ id: "p", workspaceId: "w", name: "Test", skills: [] });
    await repository.saveMilestone({ id: "m", projectId: "p", name: "Stage", order: 1 });
    const pending: Task = { id: "jira-1", milestoneId: "m", title: "Q-1", body: "", status: "todo",
      assignee: "human", skills: [], blocked: false, externalRef: "jira:team.atlassian.net/Q-1",
      quest: { acceptance: "pending", goal: "", reason: "", nextAction: "", role: "side", cadence: "once",
        challenge: "normal", tracked: false, successCriteria: "", scheduledAt: "", links: [] } };
    await repository.saveTask(pending);
    const reloaded = await open();
    assert.deepEqual((await reloaded.listProjectGraphs())[0].tasks[0], pending);
    assert.equal((await reloaded.listProjectTodos())[0].task.quest?.acceptance, "pending");
    await reloaded.saveTask({ ...pending, quest: { ...pending.quest!, acceptance: "accepted" } });
    assert.equal((await (await open()).listProjectGraphs())[0].tasks[0].quest?.acceptance, "accepted");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
