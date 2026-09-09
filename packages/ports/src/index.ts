import type {
  Character,
  EntityId,
  InboxTodo,
  Loadout,
  Milestone,
  Project,
  ProjectGraph,
  Task,
  TaskComment,
  Workspace,
} from "@queuest/domain";

export interface TaskCommentRepository {
  listTaskComments(taskId: EntityId): Promise<TaskComment[]>;
  saveTaskComment(comment: TaskComment): Promise<void>;
  deleteTaskComment(commentId: EntityId): Promise<void>;
}

export interface CharacterRepository {
  getCharacter(): Promise<Character | undefined>;
  saveCharacter(character: Character): Promise<void>;
}

export interface LoadoutRepository {
  getLoadout(projectId: EntityId): Promise<Loadout | undefined>;
  saveLoadout(loadout: Loadout): Promise<void>;
  deleteLoadout(projectId: EntityId): Promise<void>;
}

export interface TaskRepository extends TaskCommentRepository {
  initialize(): Promise<void>;
  listProjectGraphs(): Promise<ProjectGraph[]>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: EntityId): Promise<void>;
  saveMilestone(milestone: Milestone): Promise<void>;
  deleteMilestone(milestoneId: EntityId): Promise<void>;
  saveTask(task: Task): Promise<void>;
  deleteTask(taskId: EntityId): Promise<void>;
}

export interface InboxTodoRepository {
  listInboxTodos(): Promise<InboxTodo[]>;
  saveInboxTodo(todo: InboxTodo): Promise<void>;
  deleteInboxTodo(todoId: EntityId): Promise<void>;
}

export interface QueuestRepository
  extends TaskRepository, CharacterRepository, LoadoutRepository, InboxTodoRepository {}

export interface AppData {
  inboxTodos: InboxTodo[];
  projectGraphs: ProjectGraph[];
}

/**
 * Load the startup snapshot in todo-first order. The inbox is independent of
 * the project graph, so an empty graph must not prevent captured todos from
 * being restored.
 */
export async function loadAppData(repository: QueuestRepository): Promise<AppData> {
  const [inboxTodos, projectGraphs] = await Promise.all([
    repository.listInboxTodos(),
    repository.listProjectGraphs(),
  ]);

  return { inboxTodos, projectGraphs };
}

export interface AgentRunInput {
  task: Task;
  project: Project;
}

export interface AgentRunResult {
  summary: string;
  rawOutput?: string;
}

export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  cancel(taskId: EntityId): Promise<void>;
}

export interface IntegrationPort {
  importTasks(project: Project): Promise<Task[]>;
}
