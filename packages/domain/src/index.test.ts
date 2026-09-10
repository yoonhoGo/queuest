import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTaskStatus,
  createQuestContext,
  getTrackedQuests,
  canTransitionTaskStatus,
  calculateExperience,
  calculateLevel,
  calculateLevelProgress,
  calculateMilestoneProgress,
  calculateProjectProgress,
  calculateProjectStatus,
  experienceToNextLevel,
  isMilestoneComplete,
  isMilestoneUnlocked,
  retreatTaskStatus,
  transitionTaskStatus,
} from "./index.ts";
import type { Milestone, Task, ProjectTodo } from "./index.ts";

test("quest tracking excludes completed work and external links do not multiply XP", () => {
  const task: Task = { id: "q", milestoneId: "m", title: "출시", body: "", status: "review",
    assignee: "human", skills: [], blocked: false,
    quest: { ...createQuestContext(), role: "main", tracked: true } };
  const item: ProjectTodo = { task, workspace: { id: "w", name: "개인" },
    project: { id: "p", workspaceId: "w", name: "베타", skills: [] },
    milestone: { id: "m", projectId: "p", name: "출시", order: 1 } };
  assert.deepEqual(getTrackedQuests([item]), [item]);
  assert.deepEqual(getTrackedQuests([{ ...item, task: { ...task, status: "done" } }]), []);
  const done: Task = { ...task, status: "done" };
  const linked: Task = { ...done, quest: { ...task.quest!, links: [
    { kind: "pr", url: "https://github.com/example/repo/pull/1" },
    { kind: "jira", url: "https://example.atlassian.net/browse/Q-1" },
  ] } };
  assert.equal(calculateExperience([], [done]), calculateExperience([], [linked]));
});

const firstMilestone: Milestone = {
  id: "milestone-1",
  projectId: "project-1",
  name: "첫 스테이지",
  order: 1,
};

const secondMilestone: Milestone = {
  id: "milestone-2",
  projectId: "project-1",
  name: "두 번째 스테이지",
  order: 2,
};

function task(status: Task["status"] = "todo", milestoneId = firstMilestone.id): Task {
  return {
    id: `task-${status}-${milestoneId}`,
    milestoneId,
    title: "테스트 퀘스트",
    body: "",
    status,
    assignee: "human",
    skills: [],
    blocked: false,
  };
}

test("status helpers move within the four-state queue", () => {
  assert.equal(advanceTaskStatus("todo"), "doing");
  assert.equal(advanceTaskStatus("done"), "done");
  assert.equal(retreatTaskStatus("done"), "review");
  assert.equal(retreatTaskStatus("todo"), "todo");
});

test("review cannot become done without an explicit human confirmation", () => {
  const reviewTask = task("review");

  assert.equal(canTransitionTaskStatus(reviewTask, "done"), false);
  assert.throws(() => transitionTaskStatus(reviewTask, "done"), /사람의 확인/);
  assert.deepEqual(
    transitionTaskStatus(reviewTask, "done", { confirmedByHuman: true }),
    { ...reviewTask, status: "done" },
  );
  assert.equal(canTransitionTaskStatus(task("doing"), "done", { confirmedByHuman: true }), false);
  assert.throws(
    () => transitionTaskStatus(task("doing"), "done", { confirmedByHuman: true }),
    /검토 대기/,
  );
});

test("milestones unlock only after every task in the previous stage is done", () => {
  const milestones = [firstMilestone, secondMilestone];
  const firstTask = task("doing");

  assert.equal(isMilestoneComplete(firstMilestone.id, [firstTask]), false);
  assert.equal(isMilestoneUnlocked(secondMilestone.id, milestones, [firstTask]), false);
  assert.equal(
    isMilestoneUnlocked(secondMilestone.id, milestones, [{ ...firstTask, status: "done" }]),
    true,
  );
});

test("progress and experience calculations use the saved task graph", () => {
  const milestones = [firstMilestone, secondMilestone];
  const tasks = [task("done"), task("doing", secondMilestone.id)];

  assert.equal(calculateMilestoneProgress(firstMilestone.id, tasks), 100);
  assert.equal(calculateProjectProgress(milestones, tasks), 50);
  assert.equal(calculateProjectStatus(milestones, tasks), "active");
  assert.equal(calculateExperience(milestones, tasks), 60);
});

test("level progress uses the same quadratic thresholds as level calculation", () => {
  assert.equal(calculateLevel(60), 0);
  assert.equal(experienceToNextLevel(60), 40);
  assert.equal(calculateLevelProgress(60), 60);

  assert.equal(calculateLevel(100), 1);
  assert.equal(experienceToNextLevel(100), 300);
  assert.equal(calculateLevelProgress(100), 0);
  assert.equal(calculateLevelProgress(250), 50);
});

test("pending backlog quests require acceptance and do not affect active progress or XP", () => {
  const pending: Task = { ...task("todo"), id: "pending", quest: { ...createQuestContext(), acceptance: "pending", tracked: true } };
  assert.equal(canTransitionTaskStatus(pending, "doing"), false);
  assert.equal(canTransitionTaskStatus(pending, "review"), false);
  assert.equal(canTransitionTaskStatus(pending, "done", { confirmedByHuman: true }), false);
  assert.throws(() => transitionTaskStatus(pending, "doing"), /수락/);
  const accepted = { ...pending, quest: { ...pending.quest!, acceptance: "accepted" as const } };
  assert.equal(transitionTaskStatus(accepted, "doing").status, "doing");
  assert.equal(calculateProjectStatus([firstMilestone], [pending]), "not-started");
  assert.equal(calculateMilestoneProgress(firstMilestone.id, [task("done"), pending]), 100);
  assert.equal(calculateExperience([firstMilestone], [task("done"), pending]), calculateExperience([firstMilestone], [task("done")]));
  assert.equal(calculateExperience([firstMilestone], [{ ...pending, status: "done" }]), 0);
  assert.deepEqual(getTrackedQuests([{ task: pending } as ProjectTodo]), []);
});
