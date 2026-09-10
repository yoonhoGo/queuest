import { createQuestContext } from "@queuest/domain";
import type { Project, Task } from "@queuest/domain";

export interface JiraIssue {
  key: string;
  title: string;
  body: string;
  status: string;
  statusCategory: "new" | "indeterminate" | "done";
  externalRef: string;
  url: string;
  backlog: boolean;
}

export interface JiraPage { items: JiraIssue[]; nextCursor: string | null }

export function jiraIssueToTask(issue: JiraIssue, project: Project, milestoneId: string): Task {
  return {
    id: crypto.randomUUID(), milestoneId, title: `${issue.key} · ${issue.title}`,
    body: issue.body, status: issue.backlog ? "todo" : issue.statusCategory === "done" ? "review"
      : issue.statusCategory === "indeterminate" ? "doing" : "todo",
    assignee: "human", skills: [...project.skills], blocked: false,
    externalRef: issue.externalRef, sourceUrl: issue.url,
    quest: { ...createQuestContext(), acceptance: issue.backlog ? "pending" : "accepted",
      links: [{ kind: "jira", url: issue.url }] },
  };
}
