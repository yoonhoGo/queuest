import type {
  EntityId,
  Milestone,
  Project,
  ProjectGraph,
  Task,
  Workspace,
} from "@queuest/domain";
import { getRepository } from "./repository";

export async function loadProjectGraphs(): Promise<ProjectGraph[]> {
  return (await getRepository()).listProjectGraphs();
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const repository = await getRepository();
  await repository.saveWorkspace(workspace);
}

export async function saveProject(project: Project): Promise<void> {
  const repository = await getRepository();
  await repository.saveProject(project);
}

export async function saveMilestone(milestone: Milestone): Promise<void> {
  const repository = await getRepository();
  await repository.saveMilestone(milestone);
}

export async function saveTask(task: Task): Promise<void> {
  const repository = await getRepository();
  await repository.saveTask(task);
}

export interface NewProjectInput {
  name: string;
  firstTaskTitle?: string;
}

export interface CreatedProject {
  workspace: Workspace;
  project: Project;
  milestone: Milestone;
  task?: Task;
}

export async function createProject(input: NewProjectInput): Promise<CreatedProject> {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: "내 원정",
  };
  const project: Project = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    name: input.name.trim(),
    skills: [],
  };
  const milestone: Milestone = {
    id: crypto.randomUUID(),
    projectId: project.id,
    name: "첫 스테이지",
    order: 1,
  };

  await saveWorkspace(workspace);
  await saveProject(project);
  await saveMilestone(milestone);

  const firstTaskTitle = input.firstTaskTitle?.trim();
  if (!firstTaskTitle) {
    return { workspace, project, milestone };
  }

  const task: Task = {
    id: crypto.randomUUID(),
    milestoneId: milestone.id,
    title: firstTaskTitle,
    body: "",
    status: "todo",
    assignee: "human",
    skills: [],
    blocked: false,
  };
  await saveTask(task);

  return { workspace, project, milestone, task };
}

export function graphForProject(
  graphs: ProjectGraph[],
  projectId: EntityId,
): ProjectGraph | undefined {
  return graphs.find((graph) => graph.project.id === projectId);
}
