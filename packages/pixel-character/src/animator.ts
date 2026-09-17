import { JOINT_NAMES } from "./rig.ts";
import type { JointName } from "./rig.ts";
import type { RigDimensions } from "./body.ts";
export type Action = "idle" | "walk";
export type JointRotation = { x: number; y: number; z: number };
export type PoseOverride = Partial<Record<JointName, Partial<JointRotation>>>;
export const JOINT_LIMITS: Record<JointName, [number, number]> = {
  pelvis: [-0.3, 0.3],
  torso: [-0.4, 0.4],
  neck: [-0.3, 0.3],
  head: [-0.65, 0.65],
  leftShoulder: [-2.6, 2.6],
  rightShoulder: [-2.6, 2.6],
  leftElbow: [-2.2, 2.2],
  rightElbow: [-2.2, 2.2],
  leftWrist: [-0.8, 0.8],
  rightWrist: [-0.8, 0.8],
  leftHip: [-1.4, 1.4],
  rightHip: [-1.4, 1.4],
  leftKnee: [0, 2.3],
  rightKnee: [0, 2.3],
  leftAnkle: [-1.5, 1.5],
  rightAnkle: [-1.5, 1.5],
};
const index = Object.fromEntries(
  JOINT_NAMES.map((k, i) => [k, i * 3]),
) as Record<JointName, number>;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  n = clamp(n, 0, 1);
  return n * n * (3 - 2 * n);
};
const SIDES = [
  ["left", 0, 1],
  ["right", Math.PI, -1],
] as const;
/** Pure numeric pose calculation: no renderer, DOM or per-frame vector allocations. */
export class CharacterAnimator {
  readonly pose = new Float64Array(JOINT_NAMES.length * 3);
  private readonly desired = new Float64Array(JOINT_NAMES.length * 3);
  private readonly overrides = new Map<JointName, Partial<JointRotation>>();
  action: Action = "idle";
  time = 0;
  phase = 0;
  speed = 0.8;
  walkWeight = 0;
  gazeX = 0;
  gazeY = 0;
  targetX = 0;
  targetY = 0;
  waveTime = -1;
  jumpTime = -1;
  jumpHeight = 0;
  rootY = 0;
  blink = 0;
  neutral = false;
  private launchHeight = 0.55;
  get jumpStage() {
    const t = this.jumpTime;
    return t < 0
      ? "grounded"
      : t < 0.18
        ? "prepare"
        : t < 0.505
          ? "ascending"
          : t < 0.83
            ? "descending"
            : t < 0.99
              ? "landing"
              : "recovery";
  }
  jump(scale = 1) {
    if (this.jumpTime >= 0 || this.neutral) return false;
    this.jumpTime = 0;
    this.launchHeight = 0.55 * scale;
    return true;
  }
  wave() {
    if (!this.neutral) this.waveTime = 0;
  }
  setPose(pose: PoseOverride) {
    const pending: Array<[JointName, Partial<JointRotation>]> = [];
    for (const [key, rot] of Object.entries(pose)) {
      if (
        !Object.hasOwn(index, key) ||
        !rot ||
        typeof rot !== "object" ||
        Array.isArray(rot)
      )
        throw new TypeError(`잘못된 관절: ${key}`);
      const name = key as JointName,
        [min, max] = JOINT_LIMITS[name];
      for (const [axis, value] of Object.entries(rot))
        if (
          !["x", "y", "z"].includes(axis) ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < min ||
          value > max
        )
          throw new RangeError(`${key}: 회전 범위 ${min}–${max} rad`);
      pending.push([name, { ...this.overrides.get(name), ...rot }]);
    }
    for (const [name, rot] of pending) this.overrides.set(name, rot);
  }
  clearPose() {
    this.overrides.clear();
  }
  private put(j: JointName, x = 0, y = 0, z = 0) {
    const i = index[j];
    this.desired[i] = x;
    this.desired[i + 1] = y;
    this.desired[i + 2] = z;
  }
  update(dt: number, d: RigDimensions, scale: number) {
    dt = clamp(dt, 0, 0.05);
    this.desired.fill(0);
    if (this.neutral) {
      this.pose.fill(0);
      this.rootY = 0;
      this.blink = 0;
      return;
    }
    this.time += dt;
    const blend = dt === 0 ? 1 : 1 - Math.exp(-dt * 12);
    this.walkWeight +=
      (Number(this.action === "walk") - this.walkWeight) * blend;
    this.gazeX += (this.targetX - this.gazeX) * blend;
    this.gazeY += (this.targetY - this.gazeY) * blend;
    // World distance / stride length: changing legs keeps the accumulated phase.
    const stride = d.leg * scale * 0.85;
    this.phase =
      (this.phase +
        ((dt * this.speed) / stride) * Math.PI * 2 * this.walkWeight) %
      (Math.PI * 2);
    let crouch = 0;
    this.jumpHeight = 0;
    if (this.jumpTime >= 0) {
      this.jumpTime += dt;
      const t = this.jumpTime;
      if (t < 0.18) crouch = 0.12 * smooth(t / 0.18);
      else if (t < 0.83) {
        const u = (t - 0.18) / 0.65;
        this.jumpHeight = 4 * this.launchHeight * u * (1 - u);
      } else if (t < 0.99)
        crouch = 0.14 * Math.sin((((t - 0.83) / 0.16) * Math.PI) / 2);
      else if (t < 1.19) crouch = 0.14 * (1 - smooth((t - 0.99) / 0.2));
      else this.jumpTime = -1;
    }
    const airborne = this.jumpTime >= 0.18 && this.jumpTime < 0.83;
    const walk = this.walkWeight * (this.jumpTime >= 0 ? 0 : 1);
    this.rootY = this.jumpHeight / scale - crouch;
    // Breathing rotates the chest subtly; feet remain at the ground plane.
    this.put(
      "torso",
      Math.sin(this.time * 2) * 0.012,
      0,
      Math.sin(this.time * 1.3) * 0.012 * (1 - walk),
    );
    this.put("head", -this.gazeY * 0.38, this.gazeX * 0.6, 0);
    for (const [side, offset, sign] of SIDES) {
      const p = this.phase + offset,
        lift = Math.max(0, Math.sin(p)) * d.leg * 0.16 * walk;
      const z = Math.cos(p) * d.leg * 0.2 * walk;
      const down = d.leg - crouch - lift - (airborne ? 0.06 : 0);
      const dist = clamp(Math.hypot(down, z), 0.1, d.leg - 0.000001);
      const knee =
        Math.PI -
        Math.acos(
          clamp(
            (d.thigh * d.thigh + d.calf * d.calf - dist * dist) /
              (2 * d.thigh * d.calf),
            -1,
            1,
          ),
        );
      const hip =
        Math.atan2(-z, down) -
        Math.acos(
          clamp(
            (d.thigh * d.thigh + dist * dist - d.calf * d.calf) /
              (2 * d.thigh * dist),
            -1,
            1,
          ),
        );
      this.put(`${side}Hip`, hip);
      this.put(`${side}Knee`, knee);
      this.put(`${side}Ankle`, -hip - knee);
      const arm =
        Math.cos(p) *
        Math.min(0.65, (d.leg * 0.38) / (d.upperArm + d.forearm)) *
        walk;
      this.put(`${side}Shoulder`, arm - (airborne ? 0.5 : 0), 0, sign * 0.12);
      this.put(`${side}Elbow`, -0.08 - Math.abs(arm) * 0.5);
    }
    if (this.waveTime >= 0) {
      this.waveTime += dt;
      const t = this.waveTime,
        weight = smooth(t / 0.25) * (1 - smooth((t - 1.65) / 0.35));
      const i = index.leftShoulder;
      this.desired[i] *= 1 - weight;
      this.desired[i + 2] = this.desired[i + 2] * (1 - weight) + 2.35 * weight;
      this.put("leftElbow", -0.2 * weight, 0, Math.sin(t * 15) * 0.3 * weight);
      this.put("leftWrist", 0, 0, Math.sin(t * 15 + 0.5) * 0.35 * weight);
      if (t >= 2) this.waveTime = -1;
    }
    // Explicit manual pose is last. Gaze/gestures continue on non-overridden axes.
    for (const [j, rot] of this.overrides) {
      const i = index[j];
      if (rot.x !== undefined) this.desired[i] = rot.x;
      if (rot.y !== undefined) this.desired[i + 1] = rot.y;
      if (rot.z !== undefined) this.desired[i + 2] = rot.z;
    }
    for (let j = 0; j < JOINT_NAMES.length; j++) {
      const [min, max] = JOINT_LIMITS[JOINT_NAMES[j]];
      for (let a = 0; a < 3; a++) {
        const i = j * 3 + a;
        this.pose[i] +=
          (clamp(this.desired[i], min, max) - this.pose[i]) * blend;
      }
    }
    const blinkPhase = this.time % 4.1;
    this.blink =
      blinkPhase > 3.85 ? Math.sin(((blinkPhase - 3.85) / 0.25) * Math.PI) : 0;
  }
}
