export type EntityId = string;

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ASSIGNEES = ["human", "ai"] as const;
export type Assignee = (typeof ASSIGNEES)[number];

export const JOBS = ["developer", "planner", "designer"] as const;
export type Job = (typeof JOBS)[number];

export type ProjectStatus = "not-started" | "active" | "complete";

export interface Workspace {
  id: EntityId;
  name: string;
}

/**
 * A quick-capture item that does not require a workspace or project yet.
 *
 * Inbox todos deliberately stay separate from project tasks: a captured idea
 * can be persisted before the user has decided where it belongs.
 */
export interface InboxTodo {
  id: EntityId;
  title: string;
  completed: boolean;
  createdAt: string;
}

export interface Project {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  repoPath?: string;
  skills: string[];
}

export interface Milestone {
  id: EntityId;
  projectId: EntityId;
  name: string;
  order: number;
}

export interface TaskComment {
  id: EntityId;
  taskId: EntityId;
  body: string;
  author: Assignee;
  createdAt: string;
}

export interface Task {
  id: EntityId;
  milestoneId: EntityId;
  title: string;
  body: string;
  status: TaskStatus;
  assignee: Assignee;
  skills: string[];
  blocked: boolean;
  externalRef?: string;
  comments?: TaskComment[];
}

export interface Character {
  name: string;
  job: Job;
  spriteId: string;
}

export interface Loadout {
  projectId: EntityId;
  agentTool?: "claude";
  sourceTool?: "gh";
}

export interface ProjectGraph {
  workspace: Workspace;
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  character?: Character;
  loadout?: Loadout;
}

export interface SkillSummary {
  name: string;
  level: number;
  emphasized: boolean;
}

export interface TaskStatusTransitionOptions {
  confirmedByHuman?: boolean;
}

const STATUS_ORDER: readonly TaskStatus[] = TASK_STATUSES;

export function getMilestoneTasks(milestoneId: EntityId, tasks: Task[]): Task[] {
  return tasks.filter((task) => task.milestoneId === milestoneId);
}

export function isMilestoneComplete(milestoneId: EntityId, tasks: Task[]): boolean {
  const milestoneTasks = getMilestoneTasks(milestoneId, tasks);
  return milestoneTasks.length > 0 && milestoneTasks.every((task) => task.status === "done");
}

export function isMilestoneUnlocked(
  milestoneId: EntityId,
  milestones: Milestone[],
  tasks: Task[],
): boolean {
  const ordered = [...milestones].sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((milestone) => milestone.id === milestoneId);

  if (index <= 0) {
    return index === 0;
  }

  return ordered
    .slice(0, index)
    .every((milestone) => isMilestoneComplete(milestone.id, tasks));
}

export function calculateMilestoneProgress(milestoneId: EntityId, tasks: Task[]): number {
  const milestoneTasks = getMilestoneTasks(milestoneId, tasks);
  if (milestoneTasks.length === 0) {
    return 0;
  }

  const done = milestoneTasks.filter((task) => task.status === "done").length;
  return Math.round((done / milestoneTasks.length) * 100);
}

export function calculateProjectProgress(milestones: Milestone[], tasks: Task[]): number {
  const milestoneIds = new Set(milestones.map((milestone) => milestone.id));
  const projectTasks = tasks.filter((task) => milestoneIds.has(task.milestoneId));

  if (projectTasks.length === 0) {
    return 0;
  }

  const done = projectTasks.filter((task) => task.status === "done").length;
  return Math.round((done / projectTasks.length) * 100);
}

export function calculateProjectStatus(
  milestones: Milestone[],
  tasks: Task[],
): ProjectStatus {
  const projectTasks = tasks.filter((task) =>
    milestones.some((milestone) => milestone.id === task.milestoneId),
  );

  if (projectTasks.length === 0) {
    return "not-started";
  }

  return projectTasks.every((task) => task.status === "done") ? "complete" : "active";
}

export function calculateExperience(
  milestones: Milestone[],
  tasks: Task[],
): number {
  const doneTasks = tasks.filter((task) => task.status === "done");
  const completedMilestones = milestones.filter((milestone) =>
    isMilestoneComplete(milestone.id, tasks),
  );
  const projectComplete =
    tasks.length > 0 && tasks.every((task) => task.status === "done");

  return doneTasks.length * 10 + completedMilestones.length * 50 + (projectComplete ? 200 : 0);
}

export function calculateLevel(experience: number): number {
  return Math.floor(Math.sqrt(experience / 100));
}

export function experienceForLevel(level: number): number {
  return level * level * 100;
}

export function experienceToNextLevel(experience: number): number {
  const level = calculateLevel(experience);
  return Math.max(0, experienceForLevel(level + 1) - experience);
}

export function calculateLevelProgress(experience: number): number {
  const level = calculateLevel(experience);
  const currentLevelExperience = experienceForLevel(level);
  const nextLevelExperience = experienceForLevel(level + 1);

  return Math.min(
    100,
    Math.max(
      0,
      ((experience - currentLevelExperience) /
        (nextLevelExperience - currentLevelExperience)) *
        100,
    ),
  );
}

export function effectiveTaskSkills(task: Task, project: Project): string[] {
  return task.skills.length > 0 ? task.skills : project.skills;
}

export function calculateSkillSummaries(
  project: Project,
  milestones: Milestone[],
  tasks: Task[],
  character: Character,
): SkillSummary[] {
  const projectMilestoneIds = new Set(milestones.map((milestone) => milestone.id));
  const projectTasks = tasks.filter((task) => projectMilestoneIds.has(task.milestoneId));
  const skillNames = new Set([
    ...project.skills,
    ...projectTasks.flatMap((task) => effectiveTaskSkills(task, project)),
  ]);

  return [...skillNames]
    .sort()
    .map((name) => ({
      name,
      level: projectTasks.filter(
        (task) =>
          task.status === "done" && effectiveTaskSkills(task, project).includes(name),
      ).length,
      emphasized:
        character.job === "developer"
          ? ["typescript", "rust", "tauri", "javascript"].includes(name)
          : character.job === "planner"
            ? ["research", "writing", "planning"].includes(name)
            : ["design", "css", "ui"].includes(name),
    }));
}

export function activeTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => task.status === "doing").length;
}

export function advanceTaskStatus(status: TaskStatus): TaskStatus {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[Math.min(index + 1, STATUS_ORDER.length - 1)];
}

export function retreatTaskStatus(status: TaskStatus): TaskStatus {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[Math.max(index - 1, 0)];
}

export function canTransitionTaskStatus(
  task: Task,
  nextStatus: TaskStatus,
  options: TaskStatusTransitionOptions = {},
): boolean {
  if (task.status === nextStatus) {
    return true;
  }

  if (nextStatus === "done") {
    return task.status === "review" && Boolean(options.confirmedByHuman);
  }

  return true;
}

export function transitionTaskStatus(
  task: Task,
  nextStatus: TaskStatus,
  options: TaskStatusTransitionOptions = {},
): Task {
  if (!canTransitionTaskStatus(task, nextStatus, options)) {
    if (nextStatus === "done" && task.status !== "review") {
      throw new Error("퀘스트는 검토 대기 상태를 거친 뒤 완료할 수 있습니다.");
    }

    throw new Error("퀘스트는 사람의 확인 후에만 완료할 수 있습니다.");
  }

  return { ...task, status: nextStatus };
}

export function canAssignToAi(project: Project, loadout: Loadout): boolean {
  return Boolean(project.repoPath && loadout.agentTool === "claude");
}
