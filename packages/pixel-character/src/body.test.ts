import test from "node:test";
import assert from "node:assert/strict";
import {
  BODY_KEYS,
  BODY_PARAMETERS,
  BODY_PRESETS,
  DEFAULT_BODY,
  deriveDimensions,
  validateBodyShape,
  serializeBody,
  parseBody,
} from "./body.ts";
import { ProceduralCharacter } from "./character.ts";
import { Box3, Vector3 } from "three";
import { CharacterAnimator } from "./animator.ts";
const near = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
test("Every min/max corner of parameter space keeps 3H and positive lengths", () => {
  for (let mask = 0; mask < 2 ** BODY_KEYS.length; mask++) {
    const shape = { ...DEFAULT_BODY };
    for (let i = 0; i < BODY_KEYS.length; i++) {
      const k = BODY_KEYS[i];
      shape[k] = BODY_PARAMETERS[k][mask & (1 << i) ? "max" : "min"];
    }
    const d = deriveDimensions(shape);
    near(d.height, 3 * d.head);
    near(d.neck + d.torso + d.pelvis + d.thigh + d.calf + d.foot, 2);
    for (const n of Object.values(d)) assert.ok(Number.isFinite(n) && n > 0);
  }
});
test("Partial updates are atomic, validated, and copy-owned", () => {
  const s = validateBodyShape({ waistWidth: 0.6 });
  assert.equal(s.waistWidth, 0.6);
  assert.equal(DEFAULT_BODY.waistWidth, 0.52);
  for (const bad of [
    null,
    [],
    { headWidth: NaN },
    { headWidth: Infinity },
    { headWidth: 0 },
    { unknown: 1 },
    { headWidth: "1" },
  ])
    assert.throws(() => validateBodyShape(bad));
  const c = new ProceduralCharacter();
  assert.throws(() => c.setBodyShape({ headWidth: 0.9, armLength: 999 }));
  assert.deepEqual(c.getBodyShape(), DEFAULT_BODY);
  const copy = c.getBodyShape();
  copy.headWidth = 0.8;
  assert.equal(c.getBodyShape().headWidth, 1);
  c.dispose();
  c.dispose();
});
test("JSON round trips all presets and rejects missing, unknown and wrong version fields", () => {
  for (const body of Object.values(BODY_PRESETS)) {
    const decoded = parseBody(serializeBody(body, 1.2));
    assert.deepEqual(decoded.body, body);
    assert.equal(decoded.characterScale, 1.2);
  }
  for (const bad of [
    "{",
    "null",
    "[]",
    '{"version":2}',
    '{"version":1,"body":{}}',
    serializeBody({ ...DEFAULT_BODY }).replace(
      '"headWidth": 1',
      '"headWidth": -1',
    ),
  ])
    assert.throws(() => parseBody(bad));
});
test("Neutral mesh bounds, actual joint endpoints, ground and restoration", () => {
  const c = new ProceduralCharacter();
  c.animator.neutral = true;
  const a = new Vector3(),
    b = new Vector3(),
    box = new Box3();
  const cases = [
    ...Object.values(BODY_PRESETS),
    ...BODY_KEYS.flatMap((k) => [
      validateBodyShape({ [k]: BODY_PARAMETERS[k].min }),
      validateBodyShape({ [k]: BODY_PARAMETERS[k].max }),
    ]),
    validateBodyShape(
      Object.fromEntries(BODY_KEYS.map((k) => [k, BODY_PARAMETERS[k].max])),
    ),
    validateBodyShape(
      Object.fromEntries(BODY_KEYS.map((k) => [k, BODY_PARAMETERS[k].min])),
    ),
  ];
  for (const s of cases) {
    c.setBodyShape(s);
    c.update(1 / 60);
    const j = c.rig.joints,
      d = c.dimensions;
    box.setFromObject(c.appearance.parts.head, true);
    near(box.max.y - box.min.y, 1, 1e-6);
    near(box.max.y, 3, 1e-6);
    for (const side of ["left", "right"] as const) {
      for (const [parent, child, length] of [
        [j[`${side}Shoulder`], j[`${side}Elbow`], d.upperArm],
        [j[`${side}Elbow`], j[`${side}Wrist`], d.forearm],
        [j[`${side}Hip`], j[`${side}Knee`], d.thigh],
        [j[`${side}Knee`], j[`${side}Ankle`], d.calf],
      ] as const) {
        parent.getWorldPosition(a);
        child.getWorldPosition(b);
        near(a.distanceTo(b), length);
        assert.deepEqual(parent.scale.toArray(), [1, 1, 1]);
      }
      box.setFromObject(c.appearance.parts[`${side}Foot`], true);
      near(box.min.y, 0, 1e-6);
    }
    assert.ok(c.appearance.parts.shoulderBridge.scale.x >= d.shoulderSpread);
  }
  c.setBodyShape(DEFAULT_BODY);
  c.update(1 / 60);
  assert.deepEqual(c.dimensions, deriveDimensions(DEFAULT_BODY));
  assert.deepEqual(c.current, DEFAULT_BODY);
  c.dispose();
});
test("Jump rejects repeated input and survives morphing and scale changes", () => {
  const c = new ProceduralCharacter();
  c.animator.action = "walk";
  c.animator.wave();
  assert.equal(c.animator.jump(), true);
  assert.equal(c.animator.jump(), false);
  for (let i = 0; i < 25; i++) c.update(1 / 60);
  const height = c.animator.jumpHeight,
    time = c.animator.jumpTime,
    phase = c.animator.phase;
  c.setBodyShape(BODY_PRESETS.slim);
  c.targetScale = 1.4;
  c.update(1 / 60);
  assert.ok(c.animator.jumpTime > time);
  assert.ok(c.animator.jumpHeight >= height - 0.05);
  assert.ok(c.animator.phase > phase);
  const bounds = new Box3();
  for (let i = 0; i < 120; i++) {
    c.update(1 / 60);
    for (const side of ["left", "right"]) {
      bounds.setFromObject(c.appearance.parts[`${side}Foot`], true);
      assert.ok(bounds.min.y >= -1e-7);
    }
    assert.ok(c.animator.pose.every(Number.isFinite));
  }
  assert.equal(c.animator.jumpStage, "grounded");
  c.dispose();
});
test("Delta-time gait remains consistent at 30/60/120Hz; return delta is capped", () => {
  const phases = [30, 60, 120].map((fps) => {
    const a = new CharacterAnimator();
    a.action = "walk";
    a.walkWeight = 1;
    for (let i = 0; i < fps * 3; i++)
      a.update(1 / fps, deriveDimensions(DEFAULT_BODY), 1);
    return a.phase;
  });
  near(phases[0], phases[1], 1e-8);
  near(phases[1], phases[2], 1e-8);
  const a = new CharacterAnimator();
  a.update(100, deriveDimensions(DEFAULT_BODY), 1);
  near(a.time, 0.05);
});
