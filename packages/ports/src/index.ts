import type {
  EntityId,
  Milestone,
  Project,
  ProjectGraph,
  Task,
  Workspace,
} from "@queuest/domain";

export interface TaskRepository {
  initialize(): Promise<void>;
  listProjectGraphs(): Promise<ProjectGraph[]>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  saveProject(project: Project): Promise<void>;
  saveMilestone(milestone: Milestone): Promise<void>;
  saveTask(task: Task): Promise<void>;
  deleteTask(taskId: EntityId): Promise<void>;
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
