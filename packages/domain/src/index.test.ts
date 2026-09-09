import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTaskStatus,
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
import type { Milestone, Task } from "./index.ts";

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
