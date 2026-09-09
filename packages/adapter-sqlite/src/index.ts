import Database from "@tauri-apps/plugin-sql";
import type {
  Character,
  EntityId,
  InboxTodo,
  Loadout,
  Milestone,
  PluginConnection,
  Project,
  ProjectGraph,
  ProjectTodo,
  Task,
  TaskComment,
  Workspace,
} from "@queuest/domain";
import type { InboxTodoRepository, QueuestRepository } from "@queuest/ports";

export const DATABASE_PATH = "sqlite:queuest.db";

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    repo_path TEXT,
    skills TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    milestone_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'review', 'done')),
    assignee TEXT NOT NULL CHECK (assignee IN ('human', 'ai')),
    skills TEXT NOT NULL DEFAULT '[]',
    blocked INTEGER NOT NULL DEFAULT 0,
    external_ref TEXT,
    source_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('human', 'ai')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    job TEXT NOT NULL CHECK (job IN ('developer', 'planner', 'designer')),
    sprite_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS loadouts (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    agent_tool TEXT,
    source_tool TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS inbox_todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_connections (
    plugin_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    label TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    credential_stored INTEGER NOT NULL DEFAULT 0 CHECK (credential_stored IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, connection_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id)",
  "CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks(milestone_id)",
  "CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id)",
  "CREATE INDEX IF NOT EXISTS idx_inbox_todos_created_at ON inbox_todos(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_plugin_connections_updated_at ON plugin_connections(updated_at)",
];

interface WorkspaceRow {
  id: string;
  name: string;
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  repo_path: string | null;
  skills: string;
}

interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  milestone_order: number;
}

interface TaskRow {
  id: string;
  milestone_id: string;
  title: string;
  body: string;
  status: Task["status"];
  assignee: Task["assignee"];
  skills: string;
  blocked: number | boolean;
  external_ref: string | null;
  source_url: string | null;
}

interface ProjectTodoRow {
  task_id: string;
  task_milestone_id: string;
  task_title: string;
  task_body: string;
  task_status: Task["status"];
  task_assignee: Task["assignee"];
  task_skills: string;
  task_blocked: number | boolean;
  task_external_ref: string | null;
  task_source_url: string | null;
  milestone_id: string;
  milestone_project_id: string;
  milestone_name: string;
  milestone_order: number;
  project_id: string;
  project_workspace_id: string;
  project_name: string;
  project_repo_path: string | null;
  project_skills: string;
  workspace_id: string;
  workspace_name: string;
}

interface TaskCommentRow {
  id: string;
  task_id: string;
  body: string;
  author: TaskComment["author"];
  created_at: string;
}

interface CharacterRow {
  name: string;
  job: Character["job"];
  sprite_id: string;
}

interface LoadoutRow {
  project_id: string;
  agent_tool: string | null;
  source_tool: string | null;
}

interface InboxTodoRow {
  id: string;
  title: string;
  completed: number | boolean;
  created_at: string;
}

interface PluginConnectionRow {
  plugin_id: string;
  connection_id: string;
  label: string;
  config: string;
  credential_stored: number | boolean;
  updated_at: string;
}

function readSkills(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    title: row.title,
    body: row.body,
    status: row.status,
    assignee: row.assignee,
    skills: readSkills(row.skills),
    blocked: Boolean(row.blocked),
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
  };
}

function toProjectTodo(row: ProjectTodoRow): ProjectTodo {
  return {
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
    },
    project: {
      id: row.project_id,
      workspaceId: row.project_workspace_id,
      name: row.project_name,
      ...(row.project_repo_path ? { repoPath: row.project_repo_path } : {}),
      skills: readSkills(row.project_skills),
    },
    milestone: {
      id: row.milestone_id,
      projectId: row.milestone_project_id,
      name: row.milestone_name,
      order: row.milestone_order,
    },
    task: {
      id: row.task_id,
      milestoneId: row.task_milestone_id,
      title: row.task_title,
      body: row.task_body,
      status: row.task_status,
      assignee: row.task_assignee,
      skills: readSkills(row.task_skills),
      blocked: Boolean(row.task_blocked),
      ...(row.task_external_ref ? { externalRef: row.task_external_ref } : {}),
      ...(row.task_source_url ? { sourceUrl: row.task_source_url } : {}),
    },
  };
}

function toTaskComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    author: row.author,
    createdAt: row.created_at,
  };
}

function toCharacter(row: CharacterRow): Character {
  return {
    name: row.name,
    job: row.job,
    spriteId: row.sprite_id,
  };
}

function toLoadout(row: LoadoutRow): Loadout {
  return {
    projectId: row.project_id,
    ...(row.agent_tool === "claude" ? { agentTool: "claude" } : {}),
    ...(row.source_tool === "gh" ? { sourceTool: "gh" } : {}),
  };
}

function toInboxTodo(row: InboxTodoRow): InboxTodo {
  return {
    id: row.id,
    title: row.title,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
  };
}

function readConnectionConfig(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function toPluginConnection(row: PluginConnectionRow): PluginConnection {
  return {
    pluginId: row.plugin_id,
    connectionId: row.connection_id,
    label: row.label,
    config: readConnectionConfig(row.config),
    credentialStored: Boolean(row.credential_stored),
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskRepository implements QueuestRepository, InboxTodoRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  public async initialize(): Promise<void> {
    await this.database.execute("PRAGMA foreign_keys = ON");

    for (const statement of SCHEMA_STATEMENTS) {
      await this.database.execute(statement);
    }

    // The source URL was added after the first MVP schema. Keep existing local
    // databases usable without requiring a destructive migration.
    const taskColumns = await this.database.select<Array<{ name: string }>>(
      "PRAGMA table_info(tasks)",
    );
    if (!taskColumns.some((column) => column.name === "source_url")) {
      await this.database.execute("ALTER TABLE tasks ADD COLUMN source_url TEXT");
    }
  }

  public async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.database.select<WorkspaceRow[]>(
      "SELECT id, name FROM workspaces ORDER BY name, id",
    );
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  public async listProjectGraphs(): Promise<ProjectGraph[]> {
    const [
      workspaceRows,
      projectRows,
      milestoneRows,
      taskRows,
      commentRows,
      loadoutRows,
    ] = await Promise.all([
      this.database.select<WorkspaceRow[]>("SELECT id, name FROM workspaces ORDER BY name"),
      this.database.select<ProjectRow[]>(
        "SELECT id, workspace_id, name, repo_path, skills FROM projects ORDER BY name",
      ),
      this.database.select<MilestoneRow[]>(
        "SELECT id, project_id, name, milestone_order FROM milestones ORDER BY milestone_order",
      ),
      this.database.select<TaskRow[]>(
        "SELECT id, milestone_id, title, body, status, assignee, skills, blocked, external_ref, source_url FROM tasks ORDER BY title",
      ),
      this.database.select<TaskCommentRow[]>(
        "SELECT id, task_id, body, author, created_at FROM task_comments ORDER BY created_at, id",
      ),
      this.database.select<LoadoutRow[]>(
        "SELECT project_id, agent_tool, source_tool FROM loadouts",
      ),
    ]);

    const workspaces = new Map<EntityId, Workspace>(
      workspaceRows.map((row) => [row.id, { id: row.id, name: row.name }]),
    );
    const commentsByTaskId = new Map<EntityId, TaskComment[]>();
    for (const row of commentRows) {
      const comments = commentsByTaskId.get(row.task_id) ?? [];
      comments.push(toTaskComment(row));
      commentsByTaskId.set(row.task_id, comments);
    }
    const tasks = taskRows.map((row) => {
      const task = toTask(row);
      const comments = commentsByTaskId.get(task.id);
      return comments?.length ? { ...task, comments } : task;
    });
    const loadouts = new Map<EntityId, Loadout>(
      loadoutRows.map((row) => [row.project_id, toLoadout(row)]),
    );

    return projectRows.flatMap((row) => {
      const workspace = workspaces.get(row.workspace_id);
      if (!workspace) {
        return [];
      }

      const project: Project = {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        ...(row.repo_path ? { repoPath: row.repo_path } : {}),
        skills: readSkills(row.skills),
      };
      const milestones: Milestone[] = milestoneRows
        .filter((milestone) => milestone.project_id === project.id)
        .map((milestone) => ({
          id: milestone.id,
          projectId: milestone.project_id,
          name: milestone.name,
          order: milestone.milestone_order,
        }));
      const milestoneIds = new Set(milestones.map((milestone) => milestone.id));

      return [
        {
          workspace,
          project,
          milestones,
          tasks: tasks.filter((task) => milestoneIds.has(task.milestoneId)),
          ...(loadouts.has(project.id) ? { loadout: loadouts.get(project.id) } : {}),
        },
      ];
    });
  }

  public async listTaskComments(taskId: EntityId): Promise<TaskComment[]> {
    const rows = await this.database.select<TaskCommentRow[]>(
      "SELECT id, task_id, body, author, created_at FROM task_comments WHERE task_id = $1 ORDER BY created_at, id",
      [taskId],
    );
    return rows.map(toTaskComment);
  }

  public async saveTaskComment(comment: TaskComment): Promise<void> {
    await this.database.execute(
      `INSERT INTO task_comments (id, task_id, body, author, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         body = excluded.body,
         author = excluded.author,
         created_at = excluded.created_at`,
      [comment.id, comment.taskId, comment.body, comment.author, comment.createdAt],
    );
  }

  public async deleteTaskComment(commentId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM task_comments WHERE id = $1", [commentId]);
  }

  public async getCharacter(): Promise<Character | undefined> {
    const rows = await this.database.select<CharacterRow[]>(
      "SELECT name, job, sprite_id FROM characters WHERE id = 1",
    );
    return rows[0] ? toCharacter(rows[0]) : undefined;
  }

  public async saveCharacter(character: Character): Promise<void> {
    await this.database.execute(
      `INSERT INTO characters (id, name, job, sprite_id) VALUES (1, $1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         job = excluded.job,
         sprite_id = excluded.sprite_id`,
      [character.name, character.job, character.spriteId],
    );
  }

  public async getLoadout(projectId: EntityId): Promise<Loadout | undefined> {
    const rows = await this.database.select<LoadoutRow[]>(
      "SELECT project_id, agent_tool, source_tool FROM loadouts WHERE project_id = $1",
      [projectId],
    );
    return rows[0] ? toLoadout(rows[0]) : undefined;
  }

  public async saveLoadout(loadout: Loadout): Promise<void> {
    await this.database.execute(
      `INSERT INTO loadouts (project_id, agent_tool, source_tool)
       VALUES ($1, $2, $3)
       ON CONFLICT(project_id) DO UPDATE SET
         agent_tool = excluded.agent_tool,
         source_tool = excluded.source_tool`,
      [loadout.projectId, loadout.agentTool ?? null, loadout.sourceTool ?? null],
    );
  }

  public async deleteLoadout(projectId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM loadouts WHERE project_id = $1", [projectId]);
  }

  public async listPluginConnections(): Promise<PluginConnection[]> {
    const rows = await this.database.select<PluginConnectionRow[]>(
      `SELECT plugin_id, connection_id, label, config, credential_stored, updated_at
       FROM plugin_connections
       ORDER BY label, plugin_id, connection_id`,
    );
    return rows.map(toPluginConnection);
  }

  public async savePluginConnection(connection: PluginConnection): Promise<void> {
    await this.database.execute(
      `INSERT INTO plugin_connections
         (plugin_id, connection_id, label, config, credential_stored, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(plugin_id, connection_id) DO UPDATE SET
         label = excluded.label,
         config = excluded.config,
         credential_stored = excluded.credential_stored,
         updated_at = excluded.updated_at`,
      [
        connection.pluginId,
        connection.connectionId,
        connection.label,
        JSON.stringify(connection.config),
        connection.credentialStored ? 1 : 0,
        connection.updatedAt,
      ],
    );
  }

  public async deletePluginConnection(pluginId: string, connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM plugin_connections WHERE plugin_id = $1 AND connection_id = $2",
      [pluginId, connectionId],
    );
  }

  public async saveWorkspace(workspace: Workspace): Promise<void> {
    await this.database.execute(
      `INSERT INTO workspaces (id, name) VALUES ($1, $2)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
      [workspace.id, workspace.name],
    );
  }

  public async deleteWorkspace(workspaceId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  }

  public async saveProject(project: Project): Promise<void> {
    await this.database.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, skills)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         name = excluded.name,
         repo_path = excluded.repo_path,
         skills = excluded.skills`,
      [
        project.id,
        project.workspaceId,
        project.name,
        project.repoPath ?? null,
        JSON.stringify(project.skills),
      ],
    );
  }

  public async deleteProject(projectId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM projects WHERE id = $1", [projectId]);
  }

  public async saveMilestone(milestone: Milestone): Promise<void> {
    await this.database.execute(
      `INSERT INTO milestones (id, project_id, name, milestone_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         name = excluded.name,
         milestone_order = excluded.milestone_order`,
      [milestone.id, milestone.projectId, milestone.name, milestone.order],
    );
  }

  public async deleteMilestone(milestoneId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM milestones WHERE id = $1", [milestoneId]);
  }

  public async saveTask(task: Task): Promise<void> {
    await this.database.execute(
      `INSERT INTO tasks
         (id, milestone_id, title, body, status, assignee, skills, blocked, external_ref, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(id) DO UPDATE SET
         milestone_id = excluded.milestone_id,
         title = excluded.title,
         body = excluded.body,
         status = excluded.status,
         assignee = excluded.assignee,
         skills = excluded.skills,
         blocked = excluded.blocked,
         external_ref = excluded.external_ref,
         source_url = excluded.source_url`,
      [
        task.id,
        task.milestoneId,
        task.title,
        task.body,
        task.status,
        task.assignee,
        JSON.stringify(task.skills),
        task.blocked ? 1 : 0,
        task.externalRef ?? null,
        task.sourceUrl ?? null,
      ],
    );

    if (task.comments) {
      await this.database.execute("DELETE FROM task_comments WHERE task_id = $1", [task.id]);
      for (const comment of task.comments) {
        await this.saveTaskComment(comment);
      }
    }
  }

  public async deleteTask(taskId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM tasks WHERE id = $1", [taskId]);
  }

  public async listInboxTodos(): Promise<InboxTodo[]> {
    const rows = await this.database.select<InboxTodoRow[]>(
      "SELECT id, title, completed, created_at FROM inbox_todos ORDER BY created_at",
    );
    return rows.map(toInboxTodo);
  }

  public async listProjectTodos(): Promise<ProjectTodo[]> {
    const rows = await this.database.select<ProjectTodoRow[]>(
      `SELECT
         t.id AS task_id,
         t.milestone_id AS task_milestone_id,
         t.title AS task_title,
         t.body AS task_body,
         t.status AS task_status,
         t.assignee AS task_assignee,
         t.skills AS task_skills,
         t.blocked AS task_blocked,
         t.external_ref AS task_external_ref,
         t.source_url AS task_source_url,
         m.id AS milestone_id,
         m.project_id AS milestone_project_id,
         m.name AS milestone_name,
         m.milestone_order AS milestone_order,
         p.id AS project_id,
         p.workspace_id AS project_workspace_id,
         p.name AS project_name,
         p.repo_path AS project_repo_path,
         p.skills AS project_skills,
         w.id AS workspace_id,
         w.name AS workspace_name
       FROM tasks t
       INNER JOIN milestones m ON m.id = t.milestone_id
       INNER JOIN projects p ON p.id = m.project_id
       INNER JOIN workspaces w ON w.id = p.workspace_id
       ORDER BY
         CASE t.status
           WHEN 'doing' THEN 0
           WHEN 'todo' THEN 1
           WHEN 'review' THEN 2
           ELSE 3
         END,
         p.name,
         m.milestone_order,
         t.title,
         t.id`,
    );
    return rows.map(toProjectTodo);
  }

  public async saveInboxTodo(todo: InboxTodo): Promise<void> {
    await this.database.execute(
      `INSERT INTO inbox_todos (id, title, completed, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         completed = excluded.completed,
         created_at = excluded.created_at`,
      [todo.id, todo.title, todo.completed ? 1 : 0, todo.createdAt],
    );
  }

  public async deleteInboxTodo(todoId: EntityId): Promise<void> {
    await this.database.execute("DELETE FROM inbox_todos WHERE id = $1", [todoId]);
  }
}

export async function createSqliteTaskRepository(
  path = DATABASE_PATH,
): Promise<SqliteTaskRepository> {
  const database = await Database.load(path);
  const repository = new SqliteTaskRepository(database);
  await repository.initialize();
  return repository;
}
