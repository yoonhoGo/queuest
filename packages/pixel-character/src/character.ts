import { Vector3 } from "three";
import type { Object3D } from "three";
import { BODY_KEYS, DEFAULT_BODY, validateBodyShape } from "./body.ts";
import type { BodyShape, RigDimensions } from "./body.ts";
import { CharacterRig, JOINT_NAMES } from "./rig.ts";
import { CharacterAppearance } from "./appearance.ts";
import { CharacterAnimator } from "./animator.ts";
const FOOT_NAMES = ["leftFoot", "rightFoot"] as const;
const CORNERS = [-0.5, 0.5] as const;
/** GLB adapters may implement this contract. Body morph support is explicitly optional.
 * Adapter owns its model resources. A loader must map its bones and native rest axes. */
export interface CharacterAdapter {
  readonly root: Object3D;
  readonly animator: CharacterAnimator;
  readonly dimensions: RigDimensions;
  readonly supportsBodyShape: boolean;
  update(dt: number): void;
  setBodyShape?(shape: Partial<BodyShape>): void;
  setShadingSteps(steps: number): void;
  dispose(): void;
}
export class ProceduralCharacter implements CharacterAdapter {
  readonly rig: CharacterRig;
  readonly appearance: CharacterAppearance;
  readonly animator = new CharacterAnimator();
  readonly supportsBodyShape = true;
  readonly current: BodyShape = { ...DEFAULT_BODY };
  private target: BodyShape = { ...DEFAULT_BODY };
  private dirty = false;
  private readonly point = new Vector3();
  private readonly origin = new Vector3();
  scale = 1;
  targetScale = 1;
  bodyUpdateMs = 0;
  constructor(body: Partial<BodyShape> = {}) {
    this.target = validateBodyShape(body);
    Object.assign(this.current, this.target);
    this.rig = new CharacterRig(this.current);
    this.appearance = new CharacterAppearance(this.rig, this.current);
  }
  get root() {
    return this.rig.root;
  }
  get dimensions() {
    return this.rig.dimensions;
  }
  getBodyShape() {
    return { ...this.target };
  }
  setBodyShape(body: Partial<BodyShape>) {
    this.target = validateBodyShape(body, this.target);
    this.dirty = true;
  }
  setShadingSteps(n: number) {
    this.appearance.setShadingSteps(n);
  }
  update(dt: number) {
    this.bodyUpdateMs = 0;
    if (this.dirty) {
      const start = performance.now(),
        alpha = this.animator.neutral || dt === 0 ? 1 : 1 - Math.exp(-dt * 18);
      let pending = false;
      for (const k of BODY_KEYS) {
        const delta = this.target[k] - this.current[k];
        if (Math.abs(delta) < 0.00001) this.current[k] = this.target[k];
        else {
          this.current[k] += delta * alpha;
          pending = true;
        }
      }
      this.rig.updateRest(this.current);
      this.appearance.update(this.current);
      this.dirty = pending;
      this.bodyUpdateMs = performance.now() - start;
    }
    const ds = this.targetScale - this.scale;
    this.scale =
      Math.abs(ds) < 0.00001
        ? this.targetScale
        : this.scale +
          ds * (this.animator.neutral || dt === 0 ? 1 : 1 - Math.exp(-dt * 18));
    this.root.scale.setScalar(this.scale);
    this.animator.update(dt, this.dimensions, this.scale);
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      const j = this.rig.joints[JOINT_NAMES[i]],
        p = this.animator.pose;
      j.rotation.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    this.rig.motion.position.y = this.animator.rootY;
    // Ground constraint after blending: lowest actual foot corner, not a guessed offset.
    this.root.updateMatrixWorld(true);
    this.root.getWorldPosition(this.origin);
    let min = Infinity;
    for (const name of FOOT_NAMES) {
      const foot = this.appearance.parts[name];
      for (const x of CORNERS)
        for (const y of CORNERS)
          for (const z of CORNERS) {
            this.point.set(x, y, z).applyMatrix4(foot.matrixWorld);
            min = Math.min(min, this.point.y);
          }
    }
    min -= this.origin.y;
    if (min < this.animator.jumpHeight) {
      this.rig.motion.position.y +=
        (this.animator.jumpHeight - min) / this.scale;
      this.root.updateMatrixWorld(true);
    }
    this.appearance.face(
      this.animator.blink,
      this.animator.gazeX,
      this.animator.gazeY,
      this.current,
    );
  }
  dispose() {
    this.root.removeFromParent();
    this.appearance.dispose();
  }
}
