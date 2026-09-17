import { PixelCharacterEngine } from "@queuest/pixel-character";
export interface BenchmarkRow {
  count: number;
  resolution: number;
  edges: boolean;
  mixed: boolean;
  frames: number;
  medianMs: number;
  p95Ms: number;
  animationMedianMs: number;
  animationP95Ms: number;
  bodyMedianMs: number;
  bodyP95Ms: number;
  calls: number;
  triangles: number;
  gpuMedianMs: number | null;
  gpuSamples: number;
}
const percentile = (values: number[], q: number) => {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * q))] ?? 0;
};
const frame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
export async function runBenchmark(
  host: HTMLElement,
  onProgress: (message: string) => void,
  signal: AbortSignal,
  options = { warmup: 30, frames: 120 },
) {
  const results: BenchmarkRow[] = [];
  const engine = new PixelCharacterEngine({
    container: host,
    resolution: 128,
    scale: 2,
    autoStart: false,
  });
  const gl = engine.rendering.renderer.getContext(),
    debug = gl.getExtension("WEBGL_debug_renderer_info");
  const environment = {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight],
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unavailable",
    webgl: gl.getParameter(gl.VERSION),
    timerSupported: engine.getDiagnostics().gpuSupported,
    ...options,
    conditions:
      "One shared WebGL2 context, fixed 30H square camera, independent walk/gaze, mixed bodies perturb every 30 frames. No instancing. RAF intervals include presentation.",
  };
  try {
    for (const resolution of [128, 256] as const)
      for (const edges of [false, true])
        for (const mixed of [false, true])
          for (const count of [1, 10, 50] as const) {
            if (signal.aborted)
              throw new DOMException("벤치마크 중단", "AbortError");
            onProgress(
              `${results.length + 1}/24 · ${count}개 · ${resolution}px · 경계 ${edges ? "ON" : "OFF"} · ${mixed ? "혼합" : "기본"} 체형`,
            );
            engine.configureBenchmark(count, mixed);
            engine.setResolution(resolution);
            engine.setStyle({
              outline: edges,
              depthEdgeStrength: edges ? 0.3 : 0,
              normalEdgeStrength: edges ? 0.3 : 0,
            });
            const intervals: number[] = [],
              animation: number[] = [],
              body: number[] = [],
              gpu: number[] = [];
            let calls = 0,
              triangles = 0,
              last = await frame(),
              gpuId = engine.getDiagnostics().gpuSampleId;
            for (let i = -options.warmup; i < options.frames; i++) {
              if (signal.aborted)
                throw new DOMException("벤치마크 중단", "AbortError");
              if (document.hidden)
                throw new Error(
                  "탭이 숨겨져 측정을 중단했습니다. 활성 탭에서 다시 실행하세요.",
                );
              const now = await frame(),
                dt = (now - last) / 1000;
              last = now;
              if (mixed) engine.perturbBenchmarkShapes(i + options.warmup);
              engine.step(dt);
              const d = engine.getDiagnostics();
              if (i >= 0) {
                intervals.push(dt * 1000);
                animation.push(d.animationMs);
                body.push(d.bodyUpdateMs);
                calls += d.drawCalls;
                triangles += d.triangles;
                if (d.gpuSampleId !== gpuId && d.gpuMs !== null)
                  gpu.push(d.gpuMs);
              }
              gpuId = d.gpuSampleId;
            }
            results.push({
              count,
              resolution,
              edges,
              mixed,
              frames: options.frames,
              medianMs: percentile(intervals, 0.5),
              p95Ms: percentile(intervals, 0.95),
              animationMedianMs: percentile(animation, 0.5),
              animationP95Ms: percentile(animation, 0.95),
              bodyMedianMs: percentile(body, 0.5),
              bodyP95Ms: percentile(body, 0.95),
              calls: Math.round(calls / options.frames),
              triangles: Math.round(triangles / options.frames),
              gpuMedianMs: gpu.length ? percentile(gpu, 0.5) : null,
              gpuSamples: gpu.length,
            });
          }
    return { environment, results };
  } finally {
    engine.dispose();
  }
}
