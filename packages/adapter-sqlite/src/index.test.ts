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
      body: "저장소 round-trip",
      status: "review",
      assignee: "human",
      skills: ["typescript"],
      blocked: false,
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
    await repository.saveProject(project);
    await repository.saveMilestone(milestone);
    await repository.saveTask(savedTask);
    await repository.saveTaskComment(updatedComment);
    await repository.saveCharacter(character);
    await repository.saveLoadout(loadout);

    const reloadedDatabase = new SqliteCliDatabase(databasePath);
    const reloadedRepository = new SqliteTaskRepository(
      reloadedDatabase as unknown as Database,
    );
    await reloadedRepository.initialize();
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), [
      {
        workspace,
        project,
        milestones: [milestone],
        tasks: [persistedTask],
        character,
        loadout,
      },
    ]);
    assert.deepEqual(await reloadedRepository.listTaskComments(savedTask.id), [updatedComment]);
    assert.deepEqual(await reloadedRepository.getCharacter(), character);
    assert.deepEqual(await reloadedRepository.getLoadout(project.id), loadout);
    await reloadedRepository.deleteTaskComment(updatedComment.id);
    assert.deepEqual(await reloadedRepository.listTaskComments(savedTask.id), []);
    await reloadedRepository.saveTaskComment(updatedComment);

    await reloadedRepository.deleteMilestone(milestone.id);
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), [
      {
        workspace,
        project,
        milestones: [],
        tasks: [],
        character,
        loadout,
      },
    ]);
    const comments = await reloadedDatabase.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM task_comments",
    );
    assert.equal(comments[0]?.count, 0);

    await reloadedRepository.deleteProject(project.id);
    assert.deepEqual(await reloadedRepository.listProjectGraphs(), []);
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
