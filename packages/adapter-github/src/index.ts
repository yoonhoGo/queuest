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

function externalRef(issue: GithubIssue): string {
  const match = issue.url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/);
  return `github:${match?.[1] ?? "unknown/unknown"}#${issue.number}`;
}

export class GithubIssuesAdapter implements IntegrationPort {
  public constructor(private readonly targetMilestoneId: string) {}

  public async importTasks(project: Project): Promise<Task[]> {
    if (!project.repoPath) {
      throw new Error("GitHub Issues 가져오기에는 프로젝트 repoPath가 필요합니다.");
    }

    const issues = await invoke<GithubIssue[]>("github_issue_list", {
      repoPath: project.repoPath,
    });

    return issues.map((issue) => ({
      id: crypto.randomUUID(),
      milestoneId: this.targetMilestoneId,
      title: issue.title,
      body: issue.body ?? "",
      status: issue.state === "CLOSED" ? "done" : "todo",
      assignee: "human",
      skills: project.skills,
      blocked: false,
      externalRef: externalRef(issue),
    }));
  }
}
