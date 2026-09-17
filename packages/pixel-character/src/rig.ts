import { Group, Object3D } from "three";
import { deriveDimensions } from "./body.ts";
import type { BodyShape, RigDimensions } from "./body.ts";
export const JOINT_NAMES = [
  "pelvis",
  "torso",
  "neck",
  "head",
  "leftShoulder",
  "leftElbow",
  "leftWrist",
  "rightShoulder",
  "rightElbow",
  "rightWrist",
  "leftHip",
  "leftKnee",
  "leftAnkle",
  "rightHip",
  "rightKnee",
  "rightAnkle",
] as const;
export type JointName = (typeof JOINT_NAMES)[number];
export type JointMap = Record<JointName, Object3D>;
/** Only root has uniform scale. Joint scales are always (1,1,1). */
export class CharacterRig {
  readonly root = new Group();
  readonly motion = new Group();
  readonly joints = Object.fromEntries(
    JOINT_NAMES.map((k) => {
      const o = new Object3D();
      o.name = k;
      return [k, o];
    }),
  ) as JointMap;
  dimensions: RigDimensions;
  private initialized = false;
  constructor(body: BodyShape) {
    this.dimensions = deriveDimensions(body);
    this.root.add(this.motion);
    const j = this.joints;
    this.motion.add(j.pelvis);
    j.pelvis.add(j.torso, j.leftHip, j.rightHip);
    j.torso.add(j.neck, j.leftShoulder, j.rightShoulder);
    j.neck.add(j.head);
    for (const side of ["left", "right"] as const) {
      j[`${side}Shoulder`].add(j[`${side}Elbow`]);
      j[`${side}Elbow`].add(j[`${side}Wrist`]);
      j[`${side}Hip`].add(j[`${side}Knee`]);
      j[`${side}Knee`].add(j[`${side}Ankle`]);
    }
    this.updateRest(body);
  }
  updateRest(body: BodyShape) {
    const next = deriveDimensions(body);
    if (
      this.initialized &&
      (Object.keys(next) as (keyof RigDimensions)[]).every(
        (k) => next[k] === this.dimensions[k],
      )
    )
      return;
    this.initialized = true;
    const d = (this.dimensions = next),
      j = this.joints;
    j.pelvis.position.set(0, d.hipY, 0);
    j.torso.position.set(0, d.pelvis, 0);
    j.neck.position.set(0, d.torso, 0);
    j.head.position.set(0, d.neck, 0);
    for (const [side, sign] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      j[`${side}Shoulder`].position.set(
        (sign * d.shoulderSpread) / 2,
        d.torso - 0.12,
        0,
      );
      j[`${side}Elbow`].position.set(0, -d.upperArm, 0);
      j[`${side}Wrist`].position.set(0, -d.forearm, 0);
      j[`${side}Hip`].position.set((sign * d.hipSpread) / 2, 0, 0);
      j[`${side}Knee`].position.set(0, -d.thigh, 0);
      j[`${side}Ankle`].position.set(0, -d.calf, 0);
    }
    this.root.updateMatrixWorld(true);
  }
}
