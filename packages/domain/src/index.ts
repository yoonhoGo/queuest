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
}

export interface SkillSummary {
  name: string;
  level: number;
  emphasized: boolean;
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

export function canAssignToAi(project: Project, loadout: Loadout): boolean {
  return Boolean(project.repoPath && loadout.agentTool === "claude");
}
