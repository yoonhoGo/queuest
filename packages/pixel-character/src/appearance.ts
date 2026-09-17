import {
  BoxGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import type { BufferGeometry, Object3D } from "three";
import type { BodyShape } from "./body.ts";
import type { CharacterRig } from "./rig.ts";
const SIDES = [
  ["left", 1],
  ["right", -1],
] as const;
/** Appearance owns shared geometry/materials; meshes borrow them. */
export class CharacterAppearance {
  readonly box = new BoxGeometry(1, 1, 1);
  readonly sphere = new SphereGeometry(0.5, 12, 8);
  readonly materials: ShaderMaterial[];
  readonly parts: Record<string, Mesh> = {};
  private disposed = false;
  readonly rig: CharacterRig;
  constructor(rig: CharacterRig, body: BodyShape) {
    this.rig = rig;
    this.materials = [
      "#edbd96",
      "#39776b",
      "#f6d571",
      "#39251f",
      "#fff5e7",
      "#665143",
    ].map(
      (color) =>
        new ShaderMaterial({
          uniforms: { base: { value: new Color(color) }, steps: { value: 4 } },
          vertexShader: `varying vec3 n; void main(){ n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
          fragmentShader: `uniform vec3 base; uniform float steps; varying vec3 n;
        void main(){ float l=clamp(dot(normalize(n),normalize(vec3(-.6,.85,1.))),0.,1.);
        l=floor(l*(steps-1.)+.5)/(steps-1.); gl_FragColor=vec4(base*(.48+.52*l),1.); }`,
        }),
    );
    const j = rig.joints;
    const add = (
      name: string,
      parent: Object3D,
      material: number,
      geometry: BufferGeometry = this.box,
    ) => {
      const mesh = new Mesh(geometry, this.materials[material]);
      mesh.name = name;
      parent.add(mesh);
      this.parts[name] = mesh;
    };
    add("head", j.head, 0, this.sphere);
    add("hair", j.head, 5, this.sphere);
    add("fringe", j.head, 5);
    add("nose", j.head, 0, this.sphere);
    add("mouth", j.head, 3);
    add("neck", j.neck, 0);
    add("chest", j.torso, 1);
    add("waist", j.torso, 1);
    add("pelvis", j.pelvis, 3);
    add("belt", j.pelvis, 2);
    add("badge", j.torso, 2);
    add("shoulderBridge", j.torso, 1);
    for (const side of ["left", "right"] as const) {
      add(`${side}Eye`, j.head, 3);
      add(`${side}Glint`, j.head, 4);
      add(`${side}Ear`, j.head, 0, this.sphere);
      add(`${side}UpperArm`, j[`${side}Shoulder`], 1);
      add(`${side}ShoulderCap`, j[`${side}Shoulder`], 1, this.sphere);
      add(`${side}Forearm`, j[`${side}Elbow`], 0);
      add(`${side}ElbowCap`, j[`${side}Elbow`], 0, this.sphere);
      add(`${side}Hand`, j[`${side}Wrist`], 0, this.sphere);
      add(`${side}Thigh`, j[`${side}Hip`], 3);
      add(`${side}HipCap`, j[`${side}Hip`], 3, this.sphere);
      add(`${side}Calf`, j[`${side}Knee`], 1);
      add(`${side}KneeCap`, j[`${side}Knee`], 3, this.sphere);
      add(`${side}Foot`, j[`${side}Ankle`], 5);
    }
    this.update(body);
  }
  update(s: BodyShape) {
    const d = this.rig.dimensions;
    const place = (
      key: string,
      w: number,
      h: number,
      depth: number,
      x = 0,
      y = 0,
      z = 0,
    ) => {
      const p = this.parts[key];
      if (p.scale.x !== w || p.scale.y !== h || p.scale.z !== depth)
        p.scale.set(w, h, depth);
      if (p.position.x !== x || p.position.y !== y || p.position.z !== z)
        p.position.set(x, y, z);
    };
    place("head", s.headWidth, 1, s.headDepth, 0, 0.5);
    place("hair", s.headWidth * 1.04, 0.42, s.headDepth * 1.02, 0, 0.87, -0.04);
    place(
      "fringe",
      s.headWidth * 0.76,
      0.18,
      0.14,
      0,
      0.84,
      s.headDepth * 0.36,
    );
    place("nose", 0.11, 0.12, 0.12, 0, 0.43, s.headDepth * 0.49);
    place("mouth", 0.11, 0.025, 0.028, 0, 0.32, s.headDepth * 0.465);
    place("neck", 0.23, d.neck + 0.05, 0.23, 0, d.neck / 2);
    place(
      "chest",
      s.chestWidth,
      d.torso * 0.62,
      s.chestDepth,
      0,
      d.torso * 0.69,
    );
    place(
      "shoulderBridge",
      d.shoulderSpread,
      0.16,
      Math.min(s.chestDepth, 0.32),
      0,
      d.torso - 0.12,
    );
    place(
      "waist",
      s.waistWidth,
      d.torso * 0.46,
      s.waistDepth,
      0,
      d.torso * 0.23,
    );
    // Short connector fills unequal chest/waist transitions without scaling joints.
    place("pelvis", s.pelvisWidth, d.pelvis, s.pelvisDepth, 0, d.pelvis / 2);
    place(
      "belt",
      Math.max(s.pelvisWidth, s.waistWidth) + 0.025,
      0.08,
      Math.max(s.pelvisDepth, s.waistDepth) + 0.025,
      0,
      d.pelvis - 0.015,
    );
    place(
      "badge",
      0.1,
      0.12,
      0.025,
      0.12,
      d.torso * 0.72,
      s.chestDepth / 2 + 0.015,
    );
    for (const [side, sign] of SIDES) {
      place(
        `${side}Eye`,
        0.085,
        0.115,
        0.035,
        sign * s.headWidth * 0.19,
        0.51,
        s.headDepth * 0.49,
      );
      place(
        `${side}Glint`,
        0.025,
        0.028,
        0.018,
        sign * s.headWidth * 0.19 - 0.014,
        0.54,
        s.headDepth * 0.515,
      );
      place(`${side}Ear`, 0.16, 0.24, 0.22, sign * s.headWidth * 0.48, 0.48);
      place(
        `${side}UpperArm`,
        s.upperArmThickness,
        d.upperArm,
        s.upperArmThickness,
        0,
        -d.upperArm / 2,
      );
      place(
        `${side}ShoulderCap`,
        s.upperArmThickness * 1.12,
        s.upperArmThickness * 1.12,
        s.upperArmThickness * 1.12,
      );
      place(
        `${side}Forearm`,
        s.forearmThickness,
        d.forearm,
        s.forearmThickness,
        0,
        -d.forearm / 2,
      );
      place(
        `${side}ElbowCap`,
        Math.max(s.upperArmThickness, s.forearmThickness),
        s.forearmThickness,
        s.forearmThickness,
      );
      place(
        `${side}Hand`,
        0.24 * s.handSize,
        0.27 * s.handSize,
        0.23 * s.handSize,
        0,
        -0.09 * s.handSize,
      );
      place(
        `${side}Thigh`,
        s.thighThickness,
        d.thigh,
        s.thighThickness,
        0,
        -d.thigh / 2,
      );
      place(
        `${side}HipCap`,
        s.thighThickness,
        s.thighThickness,
        s.thighThickness,
      );
      place(
        `${side}Calf`,
        s.calfThickness,
        d.calf,
        s.calfThickness,
        0,
        -d.calf / 2,
      );
      place(
        `${side}KneeCap`,
        Math.max(s.thighThickness, s.calfThickness),
        s.calfThickness,
        s.calfThickness,
      );
      place(
        `${side}Foot`,
        0.26 * s.footSize,
        d.foot,
        0.4 * s.footSize,
        0,
        -d.foot / 2,
        0.07 * s.footSize,
      );
    }
  }
  face(blink: number, lookX: number, lookY: number, s: BodyShape) {
    for (const [side, sign] of SIDES) {
      const eye = this.parts[`${side}Eye`],
        glint = this.parts[`${side}Glint`];
      eye.scale.y = 0.115 * Math.max(0.12, 1 - blink);
      eye.position.x = sign * s.headWidth * 0.19 + lookX * 0.025;
      eye.position.y = 0.51 + lookY * 0.018;
      glint.visible = blink < 0.3;
      glint.position.x = eye.position.x - 0.014;
      glint.position.y = eye.position.y + 0.03;
    }
  }
  setShadingSteps(n: number) {
    for (const m of this.materials) m.uniforms.steps.value = n;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.box.dispose();
    this.sphere.dispose();
    this.materials.forEach((m) => m.dispose());
  }
}
