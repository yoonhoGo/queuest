import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.PIXEL_OUTPUT || "/tmp/queuest-pixel-character";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.PIXEL_URL || "http://127.0.0.1:1430/");
  await page.waitForFunction(() => !!window.pixelEngine);
  await page
    .getByRole("button", { name: "Walk · 제자리 보행", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wave · 손 흔들기", exact: true })
    .click();
  await page
    .locator("canvas")
    .first()
    .hover({ position: { x: 180, y: 80 } });
  const composed = await page.evaluate(() => {
    const e = window.pixelEngine;
    e.stop();
    for (let i = 0; i < 25; i++) e.step(1 / 60);
    return {
      phase: e.getDiagnostics().phase,
      wave: e.character.animator.waveTime,
      gaze: e.character.animator.gazeX,
    };
  });
  assert(
    composed.phase > 0 && composed.wave > 0 && Math.abs(composed.gaze) > 0.01,
  );
  const renderChecks = await page.evaluate(() => {
    const e = window.pixelEngine;
    e.setNeutralPose(true);
    e.setGuides(false);
    const capture = () => {
      e.step(1 / 60);
      const gl = e.rendering.renderer.getContext(),
        n = e.canvas.width,
        pixels = new Uint8Array(n * n * 4);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let covered = 0,
        opaque = 0,
        minX = n,
        minY = n,
        maxX = 0,
        maxY = 0;
      const alpha = [];
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const a = pixels[(y * n + x) * 4 + 3];
          alpha.push(a);
          if (a) {
            covered++;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          if (a === 255) opaque++;
        }
      return { covered, opaque, minX, minY, maxX, maxY, alpha };
    };
    const results = [];
    for (const n of [128, 256]) {
      e.setResolution(n);
      e.setStyle({
        outline: false,
        depthEdgeStrength: 0,
        normalEdgeStrength: 0,
      });
      const off = capture(),
        d0 = e.getDiagnostics();
      e.setStyle({ depthEdgeStrength: 1, normalEdgeStrength: 1 });
      const edges = capture(),
        d1 = e.getDiagnostics();
      if (off.alpha.some((a, i) => a !== edges.alpha[i]))
        throw new Error("Edges changed alpha");
      e.setStyle({ outline: true });
      const outline = capture();
      // Every newly opaque pixel must be a 4-neighbor of the original opaque mask.
      for (let i = 0; i < outline.alpha.length; i++)
        if (outline.alpha[i] === 255 && edges.alpha[i] !== 255) {
          if (![i - 1, i + 1, i - n, i + n].some((j) => edges.alpha[j] === 255))
            throw new Error("Outline is thicker than one pixel");
        }
      if (outline.opaque <= edges.opaque) throw new Error("Missing silhouette");
      if (
        d0.normalRenders !== 0 ||
        d1.normalRenders !== 1 ||
        d1.drawCalls <= d0.drawCalls
      )
        throw new Error("Normal rendering not skipped");
      e.setOfficialBaseline(true);
      capture();
      const official = e.rendering.official;
      const baselineTarget = [
        official._beautyRenderTarget.width,
        official._beautyRenderTarget.height,
      ];
      e.setOfficialBaseline(false);
      results.push({
        n,
        diagnostics: d1,
        baselineTarget,
        outlineExtra: outline.opaque - edges.opaque,
        bounds: [outline.minX, outline.minY, outline.maxX, outline.maxY],
      });
    }
    return results;
  });
  for (const r of renderChecks) {
    assert.deepEqual(r.diagnostics.drawingBuffer, [r.n, r.n]);
    assert.deepEqual(r.diagnostics.composer, [r.n, r.n]);
    assert.deepEqual(r.diagnostics.beauty, [r.n, r.n]);
    assert.deepEqual(r.baselineTarget, [r.n, r.n]);
    assert.equal(r.diagnostics.dpr, 1);
    assert(
      r.bounds[0] > 0 &&
        r.bounds[1] > 0 &&
        r.bounds[2] < r.n - 1 &&
        r.bounds[3] < r.n - 1,
    );
  }
  const transitions = await page.evaluate(() => {
    const e = window.pixelEngine;
    e.setNeutralPose(false);
    e.setStyle({
      outline: true,
      depthEdgeStrength: 0.25,
      normalEdgeStrength: 0,
    });
    e.setAction("idle");
    for (let i = 0; i < 90; i++) e.step(1 / 60);
    e.setAction("walk");
    for (let i = 0; i < 30; i++) e.step(1 / 60);
    e.playGesture("wave");
    e.lookAt({ x: 0.8, y: 0.3 });
    e.jump();
    const repeated = e.jump(),
      stages = new Set(),
      phase = e.getDiagnostics().phase;
    let minMargin = 256;
    e.setCharacterScale(1.5);
    e.setBodyShape({
      legLengthRatio: 0.65,
      armLength: 0.96,
      headWidth: 1.18,
      shoulderWidth: 1.15,
    });
    for (let i = 0; i < 120; i++) {
      e.step(1 / 60);
      stages.add(e.getDiagnostics().jumpStage);
      if (i % 10 === 0) {
        const gl = e.rendering.renderer.getContext(),
          n = e.canvas.width,
          data = new Uint8Array(n * n * 4);
        gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, data);
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++)
            if (data[(y * n + x) * 4 + 3] === 255)
              minMargin = Math.min(minMargin, x, y, n - 1 - x, n - 1 - y);
      }
    }
    e.setAction("idle");
    for (let i = 0; i < 100; i++) e.step(1 / 60);
    return {
      repeated,
      stages: [...stages],
      phaseBefore: phase,
      phaseAfter: e.getDiagnostics().phase,
      minMargin,
      weight: e.character.animator.walkWeight,
    };
  });
  assert.equal(transitions.repeated, false);
  for (const stage of [
    "prepare",
    "ascending",
    "descending",
    "landing",
    "recovery",
    "grounded",
  ])
    assert(transitions.stages.includes(stage));
  assert(transitions.minMargin > 0);
  assert(transitions.weight < 0.001);
  await page.getByRole("button", { name: "체형", exact: true }).click();
  await page.getByLabel("체형 프리셋").selectOption("round");
  await page.getByLabel("머리 너비", { exact: true }).fill("1.12");
  assert.equal(
    await page.evaluate(() => window.pixelEngine.getBodyShape().headWidth),
    1.12,
  );
  await page.getByText("체형 JSON 저장 / 불러오기", { exact: true }).click();
  await page.getByLabel("체형 JSON", { exact: true }).fill('{"version":3}');
  await page.getByRole("button", { name: "JSON 적용", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "JSON 표시", exact: true }).click();
  await page.getByRole("button", { name: "JSON 적용", exact: true }).click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page
    .getByRole("button", { name: "전체 체형 초기화", exact: true })
    .click();
  await page.evaluate(() => {
    const e = window.pixelEngine;
    e.setNeutralPose(true);
    e.setDirection(0);
    e.step(1 / 60);
  });
  for (const [width, height] of [
    [375, 640],
    [420, 640],
    [768, 900],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "동작", exact: true }).click();
    await page.evaluate(() => window.pixelEngine.step(1 / 60));
    await page.waitForFunction(() =>
      document
        .querySelector(".preview-info")
        .textContent.includes(
          `${window.pixelEngine.getDiagnostics().displaySize} × ${window.pixelEngine.getDiagnostics().displaySize}`,
        ),
    );
    await page.screenshot({
      path: `${output}/demo-${width}.png`,
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `horizontal overflow ${width}`,
    );
    await page.getByRole("button", { name: "렌더링", exact: true }).click();
    await page.getByLabel("내부 해상도").selectOption("128");
    await page.evaluate(() => window.pixelEngine.step(1 / 60));
    await page.getByLabel("깊이 경계", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert(
      await page
        .getByLabel("노멀 경계", { exact: true })
        .evaluate((e) => e.matches(":focus-visible")),
    );
    await page.screenshot({
      path: `${output}/render-${width}.png`,
      fullPage: true,
    });
  }
  for (const [label, angle] of [
    ["front", 0],
    ["side", Math.PI / 2],
    ["back", Math.PI],
  ]) {
    await page.evaluate((angle) => {
      window.pixelEngine.setDirection(angle);
      window.pixelEngine.step(1 / 60);
    }, angle);
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `${output}/${label}-128.png` });
  }
  // Actual UI guide/neutral controls, paused edits, and offscreen RAF suspension.
  await page.getByRole("button", { name: "동작", exact: true }).click();
  await page.getByLabel("비율 확인용 중립 자세").check();
  await page.getByLabel("머리·신장 가이드").check();
  await page.evaluate(() => {
    window.pixelEngine.setDirection(0);
    window.pixelEngine.step(0);
  });
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: `${output}/guides-128.png` });
  const paused = await page.evaluate(() => {
    const e = window.pixelEngine;
    e.setPaused(true);
    const t = e.character.animator.time;
    e.setBodyShape({ legLengthRatio: 0.65 });
    e.setResolution(256);
    return {
      before: t,
      after: e.character.animator.time,
      ratio: e.character.current.legLengthRatio,
      width: e.canvas.width,
    };
  });
  assert.equal(paused.before, paused.after);
  assert.equal(paused.ratio, 0.65);
  assert.equal(paused.width, 256);
  await page.setViewportSize({ width: 375, height: 640 });
  await page.evaluate(() => {
    const e = window.pixelEngine;
    e.setPaused(false);
    e.setNeutralPose(false);
    e.start();
  });
  await page.getByRole("button", { name: "체형", exact: true }).click();
  await page.getByLabel("발 크기", { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => !window.pixelEngine.getDiagnostics().running,
  );
  const sleepPhase = await page.evaluate(
    () => window.pixelEngine.character.animator.time,
  );
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.pixelEngine.character.animator.time),
    sleepPhase,
  );
  await page.locator("canvas").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.pixelEngine.getDiagnostics().running);
  await page.evaluate(() => window.pixelEngine.stop());
  await page.setViewportSize({ width: 1280, height: 900 });
  const lifecycle = await page.evaluate(() => {
    const parent = document.createElement("div");
    parent.style.width = "300px";
    document.body.append(parent);
    const records = [];
    for (let i = 0; i < 12; i++) {
      const e = new window.PixelCharacterEngine({
        container: parent,
        resolution: i % 2 ? 128 : 256,
        autoStart: false,
      });
      e.step(0.016);
      records.push(e.getDiagnostics().geometries);
      e.dispose();
      e.dispose();
      if (parent.querySelector("canvas")) throw new Error("Canvas leak");
    }
    parent.remove();
    return records;
  });
  if (process.env.PIXEL_BENCHMARK === "1") {
    await page.getByRole("button", { name: "벤치마크", exact: true }).click();
    const result = await page.evaluate(async () => {
      window.pixelEngine.stop();
      return window.runPixelBenchmark(
        document.querySelector(".benchmark-stage"),
        () => {},
        new AbortController().signal,
      );
    });
    await writeFile(
      `${output}/benchmark.json`,
      JSON.stringify(result, null, 2),
    );
  }
  assert.deepEqual(errors, []);
  const report = {
    renderChecks,
    transitions,
    lifecycle,
    errors,
    browser: await browser.version(),
    dpr: 2,
  };
  await writeFile(`${output}/smoke.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: true,
        output,
        browser: report.browser,
        alphaAndTargets: renderChecks.map((r) => ({
          resolution: r.n,
          outlinePixels: r.outlineExtra,
        })),
        transitions,
        lifecycle,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
