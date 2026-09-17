import {
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from "three";
import {
  BODY_PRESETS,
  CHARACTER_SCALE,
  finiteRange,
  parseBody,
  serializeBody,
} from "./body.ts";
import type { BodyPreset, BodyShape } from "./body.ts";
import { ProceduralCharacter } from "./character.ts";
import type { Action, PoseOverride } from "./animator.ts";
import { PixelRenderer } from "./renderer.ts";
import type { Resolution } from "./renderer.ts";
import { DEFAULT_STYLE, validateStyle } from "./style.ts";
import type { PixelStyle } from "./style.ts";
export interface EngineOptions {
  container: HTMLElement;
  resolution?: Resolution;
  /** CSS integer zoom, not world scale. */ scale?: number;
  transparent?: boolean;
  autoStart?: boolean;
}
export interface Movement {
  x: number;
  z: number;
  /** H per second, world space. Direction normalized. */ speed: number;
}
export class PixelCharacterEngine {
  readonly rendering: PixelRenderer;
  readonly character = new ProceduralCharacter();
  readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private resolution: Resolution;
  private displayScale: number;
  private style: PixelStyle = { ...DEFAULT_STYLE };
  private movement: Movement = { x: 0, z: 0, speed: 0 };
  private raf = 0;
  private lastTime = 0;
  private disposed = false;
  private running = false;
  private visible = true;
  private paused = false;
  private resize: ResizeObserver;
  private intersection: IntersectionObserver;
  private readonly guides: LineSegments;
  private readonly guideGroup = new Group();
  private readonly shadowGeometry = new CircleGeometry(1, 24);
  private readonly shadowMaterial = new MeshBasicMaterial({
    color: 0x39251f,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  private readonly shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
  private readonly extras: ProceduralCharacter[] = [];
  private guidesOn = false;
  private pixelSnap = false;
  private worldX = 0;
  private worldZ = 0;
  private stats = { animationMs: 0, bodyUpdateMs: 0, frameMs: 0 };
  constructor(options: EngineOptions) {
    this.container = options.container;
    this.resolution = this.validateResolution(options.resolution ?? 256);
    this.displayScale = this.validateDisplayScale(options.scale ?? 3);
    this.rendering = new PixelRenderer(
      this.resolution,
      options.transparent ?? true,
    );
    this.canvas = this.rendering.renderer.domElement;
    this.canvas.setAttribute("aria-label", "실시간 3D 도트 캐릭터");
    this.canvas.setAttribute("role", "img");
    this.rendering.scene.add(this.character.root, this.guideGroup, this.shadow);
    this.shadow.scale.set(0.5, 0.055, 1);
    this.shadow.position.set(0, 0.025, -0.4);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(36), 3),
    );
    this.guides = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0xa44835, depthTest: false }),
    );
    this.guides.renderOrder = 10;
    this.guideGroup.add(this.guides);
    this.guideGroup.visible = false;
    this.setStyle({});
    this.rendering.fit(1.5);
    this.container.append(this.canvas);
    this.layout();
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.container);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? true;
      this.syncLoop();
    });
    this.intersection.observe(this.container);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.character.update(0);
    this.rendering.render(0);
    if (options.autoStart !== false) this.start();
  }
  private assertAlive() {
    if (this.disposed) throw new Error("엔진이 이미 dispose되었습니다.");
  }
  /** Static edits still repaint while paused, without advancing animation clocks. */
  private refresh() {
    if (this.paused && !this.disposed) this.step(0);
  }
  private validateResolution(n: number): Resolution {
    if (n !== 128 && n !== 256)
      throw new RangeError("해상도는 128 또는 256입니다.");
    return n;
  }
  private validateDisplayScale(n: number) {
    finiteRange(n, 1, 6, "화면 확대 배율");
    if (!Number.isInteger(n))
      throw new RangeError("확대 배율은 정수여야 합니다.");
    return n;
  }
  private layout() {
    const available = this.container.clientWidth || this.resolution;
    const actual = Math.max(
      1,
      Math.min(this.displayScale, Math.floor(available / this.resolution)),
    );
    this.canvas.style.width = `${this.resolution * actual}px`;
    this.canvas.style.height = `${this.resolution * actual}px`;
  }
  private visibilityChanged = () => this.syncLoop();
  private syncLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastTime = 0;
    if (
      this.running &&
      !this.paused &&
      this.visible &&
      !document.hidden &&
      !this.disposed
    )
      this.raf = requestAnimationFrame(this.tick);
  }
  private tick = (time: number) => {
    if (this.disposed) return;
    const dt = this.lastTime
      ? Math.min(0.05, (time - this.lastTime) / 1000)
      : 0;
    this.lastTime = time;
    this.step(dt);
    this.raf = requestAnimationFrame(this.tick);
  };
  start() {
    this.assertAlive();
    this.running = true;
    this.syncLoop();
  }
  stop() {
    this.running = false;
    this.syncLoop();
  }
  setPaused(on: boolean) {
    this.paused = on;
    this.syncLoop();
  }
  /** Manual stepping for hosts/benchmark. Stop automatic RAF first. dt in seconds. */
  step(dt: number) {
    this.assertAlive();
    finiteRange(dt, 0, 60, "delta time");
    dt = Math.min(dt, 0.05);
    const started = performance.now(),
      c = this.character;
    if (!c.animator.neutral) {
      this.worldX += this.movement.x * this.movement.speed * dt;
      this.worldZ += this.movement.z * this.movement.speed * dt;
    }
    c.root.position.set(this.worldX, 0, this.worldZ);
    if (this.pixelSnap) {
      const unit =
        (this.rendering.camera.right - this.rendering.camera.left) /
        this.resolution;
      c.root.position.x = Math.round(this.worldX / unit) * unit;
    }
    c.update(dt);
    let bodyMs = c.bodyUpdateMs;
    for (let i = 0; i < this.extras.length; i++) {
      const extra = this.extras[i];
      extra.animator.targetX = Math.sin(extra.animator.time * 0.7 + i);
      extra.animator.targetY = Math.cos(extra.animator.time * 0.4 + i) * 0.4;
      extra.update(dt);
      bodyMs += extra.bodyUpdateMs;
    }
    const animationMs = performance.now() - started - bodyMs;
    this.shadow.position.x = c.root.position.x;
    this.shadow.scale.set(0.5 * c.scale, 0.055 * c.scale, 1);
    this.shadowMaterial.opacity = 0.12 / (1 + c.animator.jumpHeight * 2);
    if (this.guidesOn) this.updateGuides();
    this.rendering.render(dt);
    this.stats.animationMs = Math.max(0, animationMs);
    this.stats.bodyUpdateMs = bodyMs;
    this.stats.frameMs = performance.now() - started;
  }
  setAction(action: Action) {
    this.assertAlive();
    if (action !== "idle" && action !== "walk")
      throw new TypeError("action: idle 또는 walk");
    this.character.animator.action = action;
    if (action === "idle") this.movement = { x: 0, z: 0, speed: 0 };
    this.refresh();
  }
  setWalkSpeed(speed: number) {
    this.character.animator.speed = finiteRange(speed, 0, 2, "보행 속도");
  }
  setMovement(m: Movement) {
    this.assertAlive();
    const x = finiteRange(m.x, -1, 1, "movement.x"),
      z = finiteRange(m.z, -1, 1, "movement.z"),
      speed = finiteRange(m.speed, 0, 2, "movement.speed");
    const length = Math.hypot(x, z);
    this.movement = {
      x: length ? x / length : 0,
      z: length ? z / length : 0,
      speed: length ? speed : 0,
    };
    this.character.animator.speed = speed;
    this.character.animator.action = length && speed ? "walk" : "idle";
    if (length) this.setDirection(Math.atan2(x, z));
  }
  resetPosition() {
    this.worldX = 0;
    this.worldZ = 0;
    this.character.root.position.set(0, 0, 0);
    this.refresh();
  }
  lookAt(p: { x: number; y: number }) {
    this.assertAlive();
    const x = finiteRange(p.x, -1, 1, "lookAt.x"),
      y = finiteRange(p.y, -1, 1, "lookAt.y");
    this.character.animator.targetX = x;
    this.character.animator.targetY = y;
    this.refresh();
  }
  playGesture(name: "wave") {
    this.assertAlive();
    if (name !== "wave") throw new TypeError("지원하는 제스처: wave");
    this.character.animator.wave();
  }
  jump() {
    this.assertAlive();
    return this.character.animator.jump(this.character.scale);
  }
  setPose(pose: PoseOverride) {
    this.assertAlive();
    this.character.animator.setPose(pose);
    this.refresh();
  }
  clearPose() {
    this.character.animator.clearPose();
    this.refresh();
  }
  setDirection(radians: number) {
    this.assertAlive();
    this.character.root.rotation.y = finiteRange(
      radians,
      -Math.PI * 2,
      Math.PI * 2,
      "방향 (rad)",
    );
    this.refresh();
  }
  setNeutralPose(on: boolean) {
    this.character.animator.neutral = on;
    this.refresh();
  }
  setGuides(on: boolean) {
    this.guidesOn = on;
    this.guideGroup.visible = on;
    this.refresh();
  }
  setPixelSnap(on: boolean) {
    this.pixelSnap = on;
  }
  setResolution(n: Resolution) {
    this.assertAlive();
    this.resolution = this.validateResolution(n);
    this.rendering.setResolution(n);
    this.layout();
    this.refresh();
  }
  setDisplayScale(n: number) {
    this.assertAlive();
    this.displayScale = this.validateDisplayScale(n);
    this.layout();
  }
  setStyle(patch: Partial<PixelStyle>) {
    this.assertAlive();
    this.style = validateStyle(patch, this.style);
    this.rendering.setStyle(this.style);
    this.character.setShadingSteps(this.style.shadingSteps);
    this.refresh();
    for (const c of this.extras) c.setShadingSteps(this.style.shadingSteps);
  }
  getStyle() {
    return { ...this.style };
  }
  setBodyShape(patch: Partial<BodyShape>) {
    this.assertAlive();
    this.character.setBodyShape(patch);
    this.refresh();
  }
  getBodyShape() {
    return this.character.getBodyShape();
  }
  setCharacterScale(n: number) {
    this.assertAlive();
    this.character.targetScale = finiteRange(
      n,
      CHARACTER_SCALE.min,
      CHARACTER_SCALE.max,
      "캐릭터 크기",
    );
    this.refresh();
  }
  getCharacterScale() {
    return this.character.targetScale;
  }
  applyBodyPreset(name: BodyPreset) {
    if (!Object.hasOwn(BODY_PRESETS, name))
      throw new TypeError("알 수 없는 프리셋");
    this.setBodyShape(BODY_PRESETS[name]);
  }
  resetBodyShape() {
    this.applyBodyPreset("default");
    this.setCharacterScale(1);
  }
  exportBodyJSON() {
    return serializeBody(this.getBodyShape(), this.character.targetScale);
  }
  importBodyJSON(json: string) {
    const data = parseBody(json);
    this.setBodyShape(data.body);
    this.setCharacterScale(data.characterScale);
  }
  fitToView() {
    this.rendering.fit(this.character.targetScale);
    this.refresh();
  }
  setOfficialBaseline(on: boolean) {
    this.rendering.setBaseline(on);
    this.refresh();
  }
  getDiagnostics() {
    return {
      ...this.rendering.diagnostics(),
      ...this.stats,
      resolution: this.resolution,
      displaySize: parseInt(this.canvas.style.width),
      requestedDisplayScale: this.displayScale,
      characterCount: 1 + this.extras.length,
      phase: this.character.animator.phase,
      jumpStage: this.character.animator.jumpStage,
      jumpHeight: this.character.animator.jumpHeight,
      body: { ...this.character.current },
      dimensions: { ...this.character.dimensions },
      worldPosition: { x: this.worldX, z: this.worldZ },
      running: this.running && !this.paused && this.visible && !document.hidden,
      disposed: this.disposed,
    };
  }
  private updateGuides() {
    const s = this.character.scale,
      p = this.guides.geometry.getAttribute("position");
    const x = this.character.root.position.x;
    const lines = [
      x - 1.05,
      0,
      1,
      x - 1.05,
      3 * s,
      1,
      x - 1.15,
      0,
      1,
      x + 1.15,
      0,
      1,
      x - 1.15,
      2 * s,
      1,
      x + 1.15,
      2 * s,
      1,
      x - 1.15,
      3 * s,
      1,
      x + 1.15,
      3 * s,
      1,
      x + 1.05,
      2 * s,
      1,
      x + 1.05,
      3 * s,
      1,
      x - 0.1,
      1 * s,
      1,
      x + 0.1,
      1 * s,
      1,
    ];
    for (let i = 0; i < lines.length; i++) p.array[i] = lines[i];
    p.needsUpdate = true;
    this.guides.geometry.computeBoundingSphere();
  }
  /** Benchmark-only shared scene: all counts use the same 8×7 camera envelope. */
  configureBenchmark(count: 1 | 10 | 50, mixed: boolean) {
    this.stop();
    for (const c of this.extras) c.dispose();
    this.extras.length = 0;
    this.character.setBodyShape(BODY_PRESETS.default);
    this.character.targetScale = 1;
    const a = this.character.animator;
    a.clearPose();
    a.phase = 0;
    a.time = 0;
    a.jumpTime = -1;
    a.waveTime = -1;
    a.walkWeight = 1;
    a.speed = 0.8;
    a.targetX = 0;
    a.targetY = 0;
    this.character.root.rotation.set(0, 0, 0);
    this.setGuides(false);
    this.setNeutralPose(false);
    this.shadow.visible = false;
    this.resetPosition();
    this.character.animator.action = "walk";
    this.character.update(0);
    const presets = Object.keys(BODY_PRESETS) as BodyPreset[];
    for (let i = 1; i < count; i++) {
      const c = new ProceduralCharacter(
        mixed ? BODY_PRESETS[presets[i % presets.length]] : {},
      );
      c.animator.action = "walk";
      c.animator.speed = 0.5 + (i % 7) * 0.18;
      c.animator.phase = i * 0.7;
      c.animator.time = i * 0.13;
      c.root.rotation.y = (i % 5) * 0.38;
      c.root.position.set(((i % 8) - 3.5) * 3.3, 0, -Math.floor(i / 8) * 0.1);
      c.rig.root.position.y = Math.floor(i / 8) * 3.5;
      this.extras.push(c);
      this.rendering.scene.add(c.root);
    }
    this.rendering.camera.left = -15;
    this.rendering.camera.right = 15;
    this.rendering.camera.bottom = -1;
    this.rendering.camera.top = 29;
    this.rendering.camera.updateProjectionMatrix();
    this.setStyle({});
  }
  perturbBenchmarkShapes(frame: number) {
    if (frame % 30 !== 0) return;
    const shape = {
      headWidth: frame % 60 === 0 ? 0.9 : 1.05,
      legLengthRatio: frame % 60 === 0 ? 0.52 : 0.62,
    };
    for (let i = 0; i < this.extras.length; i++)
      this.extras[i].setBodyShape(shape);
    this.setBodyShape(shape);
  }
  dispose() {
    if (this.disposed) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.intersection.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    for (const c of this.extras) c.dispose();
    this.character.dispose();
    this.guides.geometry.dispose();
    (this.guides.material as LineBasicMaterial).dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.rendering.dispose();
    this.disposed = true;
  }
}
