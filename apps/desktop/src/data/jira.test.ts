import assert from "node:assert/strict";
import test from "node:test";
import { jiraIssueToTask } from "./jira.ts";
import type { JiraIssue } from "./jira.ts";
const project = { id: "p", workspaceId: "w", name: "Test", skills: ["typescript"] };
const issue: JiraIssue = { key: "Q-1", title: "Fix", body: "details", status: "To Do", statusCategory: "new", externalRef: "jira:team.atlassian.net/Q-1", url: "https://team.atlassian.net/browse/Q-1", backlog: true };

test("backlog import preserves identity and starts pending without tracking", () => {
  const task = jiraIssueToTask(issue, project, "m");
  assert.equal(task.milestoneId, "m");
  assert.equal(task.status, "todo");
  assert.equal(task.quest?.acceptance, "pending");
  assert.equal(task.quest?.tracked, false);
  assert.equal(task.externalRef, issue.externalRef);
  assert.deepEqual(task.quest?.links, [{ kind: "jira", url: issue.url }]);
  assert.equal(jiraIssueToTask(issue, project, "other").externalRef, task.externalRef);
});

test("normal import maps progress but never bypasses human completion", () => {
  assert.equal(jiraIssueToTask({ ...issue, backlog: false, statusCategory: "indeterminate" }, project, "m").status, "doing");
  const done = jiraIssueToTask({ ...issue, backlog: false, statusCategory: "done" }, project, "m");
  assert.equal(done.status, "review");
  assert.equal(done.quest?.acceptance, "accepted");
});
