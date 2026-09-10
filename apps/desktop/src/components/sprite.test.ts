import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeSpriteAppearance,
  resolveSpriteAppearance,
  refineSpritePixels,
  SPRITE_HEIGHT,
  SPRITE_JOBS,
  SPRITE_STATES,
  SPRITE_WIDTH,
  composeSpriteFrame,
  deriveSpriteState,
  resolveSpriteJob,
  spriteFrameToPixels,
} from "./sprite.ts";

test("every job/state/frame composes to a 12x14 grid with known palette keys", () => {
  for (const job of SPRITE_JOBS) {
    for (const state of SPRITE_STATES) {
      for (const frame of [0, 1] as const) {
        const grid = composeSpriteFrame(job, state, frame);
        assert.equal(grid.length, SPRITE_HEIGHT, `${job}/${state}/${frame} rows`);
        for (const row of grid) assert.equal(row.length, SPRITE_WIDTH, `${job}/${state}/${frame} cols`);
        assert.doesNotThrow(() => spriteFrameToPixels(job, grid));
      }
    }
  }
});

test("jobs render visually distinct sprites", () => {
  const frames = SPRITE_JOBS.map((job) => composeSpriteFrame(job, "idle", 0).join("\n"));
  assert.equal(new Set(frames).size, SPRITE_JOBS.length);
  const outfit = (job: (typeof SPRITE_JOBS)[number]) =>
    spriteFrameToPixels(job, composeSpriteFrame(job, "idle", 0)).find((pixel) => pixel.x === 5 && pixel.y === 7)?.fill;
  assert.equal(outfit("developer"), "#176b68");
  assert.equal(outfit("planner"), "#f4d98b");
  assert.equal(outfit("designer"), "#d88955");
});

test("each state has a motion frame that differs from its rest frame", () => {
  for (const state of SPRITE_STATES) {
    assert.notDeepEqual(composeSpriteFrame("developer", state, 0), composeSpriteFrame("developer", state, 1), state);
  }
});

test("resolveSpriteJob keeps stored spriteId and falls back to job for legacy ids", () => {
  assert.equal(resolveSpriteJob({ job: "developer", spriteId: "planner" }), "planner");
  assert.equal(resolveSpriteJob({ job: "designer", spriteId: "legacy-hero" }), "designer");
});

test("deriveSpriteState ranks blocked > doing > review > done > idle", () => {
  assert.equal(deriveSpriteState([]), "idle");
  assert.equal(deriveSpriteState([{ status: "todo", blocked: false }]), "idle");
  assert.equal(deriveSpriteState([{ status: "done", blocked: false }]), "done");
  assert.equal(deriveSpriteState([{ status: "review", blocked: false }, { status: "done", blocked: false }]), "review");
  assert.equal(deriveSpriteState([{ status: "doing", blocked: false }, { status: "review", blocked: false }]), "doing");
  assert.equal(deriveSpriteState([{ status: "doing", blocked: false }, { status: "todo", blocked: true }]), "blocked");
  assert.equal(deriveSpriteState([{ status: "done", blocked: true }]), "done");
});

test("custom appearance round trips independently of job and rejects malformed storage", () => {
  const appearance = { style: "planner" as const, skin: "#ad7550", hair: "#252528", outfit: "#865b91" };
  const character = { job: "designer" as const, spriteId: encodeSpriteAppearance(appearance) };
  assert.deepEqual(resolveSpriteAppearance(character), appearance);
  assert.equal(resolveSpriteJob(character), "planner");
  const pixels = spriteFrameToPixels("planner", composeSpriteFrame("planner", "idle", 0), appearance);
  assert.ok(pixels.some((pixel) => pixel.fill === appearance.skin));
  assert.ok(pixels.some((pixel) => pixel.fill === appearance.outfit));
  assert.equal(resolveSpriteAppearance({ ...character, spriteId: "v1:planner:invalid:#252528:#865b91" }).style, "designer");
});

test("refined sprites preserve every occupied cell and add surface shading at twice the resolution", () => {
  for (const job of SPRITE_JOBS) for (const state of SPRITE_STATES) for (const frame of [0, 1] as const) {
    const original = spriteFrameToPixels(job, composeSpriteFrame(job, state, frame));
    const refined = refineSpritePixels(original);
    assert.equal(refined.length, original.length * 4);
    assert.deepEqual(new Set(refined.map(({ x, y }) => `${Math.floor(x / 2)},${Math.floor(y / 2)}`)),
      new Set(original.map(({ x, y }) => `${x},${y}`)));
    assert.ok(refined.every(({ x, y, fill }) => x < 24 && y < 28 && /^#[0-9a-f]{6}$/.test(fill)));
    assert.ok(new Set(refined.map(({ fill }) => fill)).size > new Set(original.map(({ fill }) => fill)).size);
  }
});
