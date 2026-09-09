import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "@queuest/domain";
import {
  githubIssueExternalRef,
  githubIssueToTask,
  type GithubIssue,
} from "./index.ts";

const project: Project = {
  id: "project-1",
  workspaceId: "workspace-1",
  name: "Queuest",
  skills: ["typescript", "tauri"],
};

const issue: GithubIssue = {
  number: 42,
  title: "가져올 이슈",
  body: "이슈 본문",
  state: "OPEN",
  url: "https://github.com/example/queuest/issues/42",
};

test("maps a GitHub issue to a source-linked local task", () => {
  assert.equal(githubIssueExternalRef(issue), "github:example/queuest#42");
  const task = githubIssueToTask(issue, project, "milestone-1");
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...task, id: "generated-id" },
    {
      id: "generated-id",
      milestoneId: "milestone-1",
      title: "가져올 이슈",
      body: "이슈 본문",
      status: "todo",
      assignee: "human",
      skills: ["typescript", "tauri"],
      blocked: false,
      externalRef: "github:example/queuest#42",
      sourceUrl: issue.url,
    },
  );
});

test("maps a closed GitHub issue to done without changing its source identity", () => {
  const closedIssue = { ...issue, state: "CLOSED" as const };
  const task = githubIssueToTask(closedIssue, project, "milestone-1");

  assert.equal(task.status, "done");
  assert.equal(task.externalRef, "github:example/queuest#42");
  assert.equal(task.sourceUrl, issue.url);
});
