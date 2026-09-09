import { invoke } from "@tauri-apps/api/core";
import type { Project, Task } from "@queuest/domain";
import type { IntegrationPort } from "@queuest/ports";

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "OPEN" | "CLOSED";
  url: string;
}

export function githubIssueExternalRef(issue: GithubIssue): string {
  const match = issue.url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/);
  return `github:${match?.[1] ?? "unknown/unknown"}#${issue.number}`;
}

export async function listGithubIssues(project: Project): Promise<GithubIssue[]> {
  if (!project.repoPath) {
    throw new Error("GitHub Issues 가져오기에는 프로젝트 repoPath가 필요합니다.");
  }

  return invoke<GithubIssue[]>("github_issue_list", {
    repoPath: project.repoPath,
  });
}

export function githubIssueToTask(
  issue: GithubIssue,
  project: Project,
  targetMilestoneId: string,
): Task {
  return {
    id: crypto.randomUUID(),
    milestoneId: targetMilestoneId,
    title: issue.title,
    body: issue.body ?? "",
    status: issue.state === "CLOSED" ? "done" : "todo",
    assignee: "human",
    skills: project.skills,
    blocked: false,
    externalRef: githubIssueExternalRef(issue),
    sourceUrl: issue.url,
  };
}

export class GithubIssuesAdapter implements IntegrationPort {
  private readonly targetMilestoneId: string;

  public constructor(targetMilestoneId: string) {
    this.targetMilestoneId = targetMilestoneId;
  }

  public async importTasks(project: Project): Promise<Task[]> {
    const issues = await listGithubIssues(project);
    return issues.map((issue) => githubIssueToTask(issue, project, this.targetMilestoneId));
  }
}
