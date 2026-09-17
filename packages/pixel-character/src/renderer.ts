import {
  NearestFilter,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { AlphaPixelPass } from "./pixel-pass.ts";
import { GpuTimer } from "./gpu-timer.ts";
import type { PixelStyle } from "./style.ts";
export type Resolution = 128 | 256;
export class PixelRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-2.6, 2.6, 4.5, -0.7, 0.1, 60);
  readonly composer: EffectComposer;
  readonly pixel: AlphaPixelPass;
  readonly official: RenderPixelatedPass;
  readonly output = new OutputPass();
  readonly timer: GpuTimer;
  baseline = false;
  constructor(resolution: Resolution, transparent: boolean) {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.style.imageRendering = "pixelated";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.background = transparent
      ? "transparent"
      : "#c8dff9";
    this.camera.position.set(0, 0, 12);
    this.camera.updateMatrixWorld();
    const target = new WebGLRenderTarget(resolution, resolution, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(1);
    this.pixel = new AlphaPixelPass(this.scene, this.camera);
    this.official = new RenderPixelatedPass(1, this.scene, this.camera);
    this.official.enabled = false;
    // Each first pass renders the scene itself. Never prepend a RenderPass.
    this.composer.addPass(this.pixel);
    this.composer.addPass(this.official);
    this.composer.addPass(this.output);
    this.timer = new GpuTimer(
      this.renderer.getContext() as WebGL2RenderingContext,
    );
    this.setResolution(resolution);
  }
  setResolution(n: Resolution) {
    this.renderer.setSize(n, n, false);
    this.composer.setSize(n, n);
  }
  setStyle(s: PixelStyle) {
    this.pixel.setStyle(s);
    this.official.depthEdgeStrength = s.depthEdgeStrength;
    this.official.normalEdgeStrength = s.normalEdgeStrength;
  }
  setBaseline(on: boolean) {
    this.baseline = on;
    this.pixel.enabled = !on;
    this.official.enabled = on;
  }
  fit(scale: number, columns = 1, rows = 1) {
    const span = 4.6 * scale;
    this.camera.left = (-span * columns) / 2;
    this.camera.right = (span * columns) / 2;
    this.camera.top = (span * rows) / 2 + 1.65 * scale;
    this.camera.bottom = (-span * rows) / 2 + 1.65 * scale;
    this.camera.updateProjectionMatrix();
  }
  render(dt: number) {
    this.renderer.info.reset();
    this.timer.poll();
    this.timer.begin();
    try {
      this.composer.render(dt);
    } finally {
      this.timer.end();
    }
  }
  diagnostics() {
    const c = this.composer,
      r = this.renderer;
    return {
      drawingBuffer: [r.domElement.width, r.domElement.height],
      composer: [c.readBuffer.width, c.readBuffer.height],
      beauty: [this.pixel.beauty.width, this.pixel.beauty.height],
      normals: [this.pixel.normals.width, this.pixel.normals.height],
      pixelSize: 1,
      dpr: r.getPixelRatio(),
      normalRenders: this.baseline ? 1 : this.pixel.normalRenders,
      passes: 2,
      drawCalls: r.info.render.calls,
      triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      gpuMs: this.timer.latestMs,
      gpuSampleId: this.timer.sampleId,
      gpuSupported: !!this.timer.extension,
    };
  }
  dispose() {
    this.timer.dispose();
    this.pixel.dispose();
    this.official.dispose();
    this.output.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
