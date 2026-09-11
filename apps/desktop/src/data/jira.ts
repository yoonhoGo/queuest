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
  issueType: string;
  isEpic: boolean;
  parentKey?: string;
}

export interface JiraPage { items: JiraIssue[]; nextCursor: string | null }

export function jiraIssueToTask(issue: JiraIssue, project: Project, milestoneId: string): Task {
  return {
    id: crypto.randomUUID(), milestoneId, title: `${issue.key} · ${issue.title}`,
    body: issue.body, status: issue.statusCategory === "done" ? "done" : issue.backlog ? "todo"
      : issue.statusCategory === "indeterminate" ? "doing" : "todo",
    assignee: "human", skills: [...project.skills], blocked: false,
    externalRef: issue.externalRef, sourceUrl: issue.url,
    quest: { ...createQuestContext(), acceptance: issue.backlog && issue.statusCategory !== "done" ? "pending" : "accepted",
      links: [{ kind: "jira", url: issue.url }] },
  };
}
