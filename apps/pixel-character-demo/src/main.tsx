import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PixelCharacterEngine,
  BODY_KEYS,
  BODY_PARAMETERS,
  BODY_PRESETS,
  DEFAULT_BODY,
  DEFAULT_STYLE,
  JOINT_NAMES,
  JOINT_LIMITS,
} from "@queuest/pixel-character";
import type {
  BodyShape,
  BodyPreset,
  PixelStyle,
  JointName,
} from "@queuest/pixel-character";
import { Button, Panel, Field, CheckRow } from "./controls";
import { runBenchmark } from "./benchmark";
import "../../desktop/src/styles/tokens.css";
import "./controls.css";
import "./style.css";

declare global {
  interface Window {
    pixelEngine?: PixelCharacterEngine;
    PixelCharacterEngine: typeof PixelCharacterEngine;
    runPixelBenchmark: typeof runBenchmark;
  }
}
window.PixelCharacterEngine = PixelCharacterEngine;
window.runPixelBenchmark = runBenchmark;
const tabs = ["동작", "체형", "렌더링", "벤치마크"] as const;
function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = "",
  onChange,
  onReset,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className="slider-field">
      <div className="slider-heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {Number(value.toFixed(2))} {unit}
        </output>
        {onReset && (
          <button
            className="reset-value"
            aria-label={`${label} 초기화`}
            onClick={onReset}
          >
            ↺
          </button>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
function App() {
  const mount = useRef<HTMLDivElement>(null),
    benchHost = useRef<HTMLDivElement>(null),
    engine = useRef<PixelCharacterEngine | null>(null),
    abort = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("동작"),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [body, setBody] = useState<BodyShape>({ ...DEFAULT_BODY }),
    [style, setStyle] = useState<PixelStyle>({ ...DEFAULT_STYLE });
  const [resolution, setResolution] = useState<128 | 256>(256),
    [zoom, setZoom] = useState(2),
    [scale, setScale] = useState(1),
    [action, setAction] = useState<"idle" | "walk">("idle");
  const [direction, setDirection] = useState(0),
    [tracking, setTracking] = useState(true),
    [neutral, setNeutral] = useState(false),
    [guides, setGuides] = useState(false),
    [checker, setChecker] = useState(true),
    [baseline, setBaseline] = useState(false),
    [paused, setPaused] = useState(false),
    [speed, setSpeed] = useState(0.8);
  const [json, setJson] = useState(""),
    [notice, setNotice] = useState(""),
    [stats, setStats] = useState<ReturnType<
      PixelCharacterEngine["getDiagnostics"]
    > | null>(null);
  const [joint, setJoint] = useState<JointName>("leftShoulder"),
    [angle, setAngle] = useState(0),
    [benchmark, setBenchmark] = useState(""),
    [benchResult, setBenchResult] = useState<Awaited<
      ReturnType<typeof runBenchmark>
    > | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const e = new PixelCharacterEngine({
        container: mount.current!,
        resolution: 256,
        scale: 2,
        transparent: true,
      });
      engine.current = e;
      window.pixelEngine = e;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        e.setPaused(true);
        setPaused(true);
      }
      setReady(true);
      const timer = setInterval(() => setStats(e.getDiagnostics()), 300);
      const resize = new ResizeObserver(() => setStats(e.getDiagnostics()));
      resize.observe(mount.current!);
      return () => {
        clearInterval(timer);
        resize.disconnect();
        abort.current?.abort();
        e.dispose();
        delete window.pixelEngine;
      };
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const applyStyle = (patch: Partial<PixelStyle>) => {
    engine.current!.setStyle(patch);
    setStyle(engine.current!.getStyle());
  };
  const applyBody = (patch: Partial<BodyShape>) => {
    engine.current!.setBodyShape(patch);
    setBody(engine.current!.getBodyShape());
  };
  const turn = (degrees: number) => {
    setDirection(degrees);
    engine.current!.setDirection((degrees * Math.PI) / 180);
  };
  const refreshBody = () => {
    setBody(engine.current!.getBodyShape());
    setScale(engine.current!.getCharacterScale());
  };
  const download = (content: string, name: string) => {
    const blob = new Blob([content], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const startBenchmark = async () => {
    setBusy(true);
    setBenchResult(null);
    setError("");
    engine.current!.setPaused(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await runBenchmark(
        benchHost.current!,
        setBenchmark,
        controller.signal,
      );
      setBenchResult(result);
      setBenchmark("24개 조건 측정 완료");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      engine.current?.setPaused(paused);
    }
  };
  return (
    <main className="lab-shell">
      <header className="lab-title">
        <span className="pixel-mark" aria-hidden="true">
          Q
        </span>
        <div>
          <p className="eyebrow">QUEUEST / CHARACTER WORKSHOP</p>
          <h1>도트 캐릭터 실험실</h1>
        </div>
        <span className="version">REALTIME · 3D → PIXEL</span>
      </header>
      <div className="lab-layout">
        <Panel className="preview-panel">
          <div className="panel-bar">
            <h2>캐릭터 프리뷰</h2>
            <span className="live-tag">
              {paused ? "일시 정지" : neutral ? "중립 자세" : "실시간"}
            </span>
          </div>
          <div
            ref={mount}
            className={`character-stage ${checker ? "checker" : ""}`}
            onPointerMove={(event) => {
              if (!tracking || !engine.current) return;
              const r = engine.current.canvas.getBoundingClientRect();
              engine.current.lookAt({
                x: Math.max(
                  -1,
                  Math.min(1, ((event.clientX - r.left) / r.width) * 2 - 1),
                ),
                y: Math.max(
                  -1,
                  Math.min(1, 1 - ((event.clientY - r.top) / r.height) * 2),
                ),
              });
            }}
            onPointerLeave={() => engine.current?.lookAt({ x: 0, y: 0 })}
          />
          <div className="preview-info">
            <span>
              {resolution} × {resolution} 내부
            </span>
            <span>
              {stats?.displaySize ?? "—"} × {stats?.displaySize ?? "—"} 표시
            </span>
            <span>DPR 1 · nearest</span>
          </div>
          <div className="view-buttons" aria-label="캐릭터 보기">
            {[
              ["정면", 0],
              ["측면", 90],
              ["후면", 180],
            ].map(([name, n]) => (
              <Button
                key={name}
                disabled={!ready}
                size="small"
                aria-pressed={direction === n}
                onClick={() => turn(Number(n))}
              >
                {name}
              </Button>
            ))}
            <Button
              size="small"
              disabled={!ready}
              onClick={() => engine.current!.fitToView()}
            >
              화면에 맞추기
            </Button>
            <Button
              size="small"
              disabled={!ready}
              aria-pressed={paused}
              onClick={() => {
                engine.current!.setPaused(!paused);
                setPaused(!paused);
              }}
            >
              {paused ? "재생" : "일시 정지"}
            </Button>
          </div>
          <p className="preview-note">
            외부 모델 없이 코드로 만든 3등신 모험가.
            <br />
            포인터를 따라 시선이 움직입니다.
          </p>
          {guides && (
            <p className="ratio-note">
              머리 1H · 머리 아래 2H · 전체{" "}
              {(stats?.dimensions.height ?? 3).toFixed(3)}H<br />
              장식 제외 / 중립 자세에서 비율 확인
            </p>
          )}
          <div className="mini-stats">
            <span>
              드로 콜 <b>{stats?.drawCalls ?? "—"}</b>
            </span>
            <span>
              삼각형 <b>{stats?.triangles ?? "—"}</b>
            </span>
            <span>
              GPU{" "}
              <b>
                {stats?.gpuMs == null
                  ? "측정 불가"
                  : `${stats.gpuMs.toFixed(2)} ms`}
              </b>
            </span>
          </div>
        </Panel>
        <Panel className="controls-panel">
          <nav className="lab-tabs" aria-label="캐릭터 제어">
            {tabs.map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                disabled={busy}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <fieldset disabled={!ready || busy} className="controls-body">
            {tab === "동작" && (
              <>
                <p className="section-kicker">01 / MOTION</p>
                <h2>움직임을 만들어 보세요</h2>
                <p className="muted">
                  보행 중에도 손 흔들기와 시선을 함께 조절할 수 있습니다.
                </p>
                <div className="action-grid">
                  <Button
                    aria-pressed={action === "idle"}
                    onClick={() => {
                      engine.current!.setAction("idle");
                      setAction("idle");
                    }}
                  >
                    Idle · 대기
                  </Button>
                  <Button
                    aria-pressed={action === "walk"}
                    onClick={() => {
                      engine.current!.setAction("walk");
                      setAction("walk");
                    }}
                  >
                    Walk · 제자리 보행
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => engine.current!.playGesture("wave")}
                  >
                    Wave · 손 흔들기
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const accepted = engine.current!.jump();
                      setNotice(
                        accepted
                          ? "점프 시작"
                          : "점프 중이거나 중립 자세입니다.",
                      );
                    }}
                  >
                    Jump · 점프
                  </Button>
                </div>
                <p className="muted small">
                  점프 중 반복 입력은 무시합니다. {stats?.jumpStage}
                </p>
                <Slider
                  id="speed"
                  label="보행 속도"
                  value={speed}
                  min={0}
                  max={2}
                  unit="H/s"
                  onChange={(n) => {
                    setSpeed(n);
                    engine.current!.setWalkSpeed(n);
                  }}
                />
                <Slider
                  id="direction"
                  label="캐릭터 방향"
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                  value={direction}
                  onChange={turn}
                />
                <CheckRow
                  checked={tracking}
                  onChange={(e) => {
                    setTracking(e.target.checked);
                    if (!e.target.checked)
                      engine.current!.lookAt({ x: 0, y: 0 });
                  }}
                >
                  포인터 시선 추적
                </CheckRow>
                <CheckRow
                  checked={neutral}
                  onChange={(e) => {
                    setNeutral(e.target.checked);
                    engine.current!.setNeutralPose(e.target.checked);
                  }}
                >
                  비율 확인용 중립 자세
                </CheckRow>
                <CheckRow
                  checked={guides}
                  onChange={(e) => {
                    setGuides(e.target.checked);
                    engine.current!.setGuides(e.target.checked);
                  }}
                >
                  머리·신장 가이드
                </CheckRow>
                <details>
                  <summary>직접 관절 제어 / 실제 이동</summary>
                  <Field id="joint" label="관절">
                    <select
                      id="joint"
                      value={joint}
                      onChange={(e) => {
                        setJoint(e.target.value as JointName);
                        setAngle(0);
                      }}
                    >
                      {JOINT_NAMES.map((j) => (
                        <option key={j}>{j}</option>
                      ))}
                    </select>
                  </Field>
                  <Slider
                    id="joint-angle"
                    label="X축 회전"
                    unit="rad"
                    min={JOINT_LIMITS[joint][0]}
                    max={JOINT_LIMITS[joint][1]}
                    value={angle}
                    onChange={(n) => {
                      setAngle(n);
                      engine.current!.setPose({ [joint]: { x: n } });
                    }}
                  />
                  <Button
                    size="small"
                    onClick={() => {
                      engine.current!.clearPose();
                      setAngle(0);
                    }}
                  >
                    수동 포즈 해제
                  </Button>
                  <p className="muted small">
                    수동 포즈가 해당 축을 우선합니다. 아래 이동은 월드 좌표를
                    바꾸므로 화면 밖으로 나갈 수 있습니다.
                  </p>
                  <div className="view-buttons">
                    <Button
                      size="small"
                      onClick={() => {
                        engine.current!.setMovement({ x: 1, z: 0, speed });
                        setAction("walk");
                        setDirection(90);
                      }}
                    >
                      오른쪽으로 이동
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        engine.current!.setMovement({ x: 0, z: 0, speed: 0 });
                        engine.current!.resetPosition();
                        setAction("idle");
                      }}
                    >
                      정지·위치 초기화
                    </Button>
                  </div>
                </details>
              </>
            )}
            {tab === "체형" && (
              <>
                <p className="section-kicker">02 / PROPORTIONS</p>
                <h2>같은 3등신, 다른 개성</h2>
                <p className="muted">
                  기본 3등신 유지. 다리 비중은 머리 아래 2H 안에서 몸통과
                  나눕니다.
                </p>
                <Field id="preset" label="체형 프리셋">
                  <select
                    id="preset"
                    defaultValue="default"
                    onChange={(e) => {
                      engine.current!.applyBodyPreset(
                        e.target.value as BodyPreset,
                      );
                      refreshBody();
                    }}
                  >
                    {Object.keys(BODY_PRESETS).map((p, i) => (
                      <option key={p} value={p}>
                        {["기본형", "슬림형", "통통형", "넓은 어깨형"][i]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Slider
                  id="world-scale"
                  label="전체 크기 (균일 스케일)"
                  min={0.65}
                  max={1.5}
                  value={scale}
                  unit="×"
                  onChange={(n) => {
                    engine.current!.setCharacterScale(n);
                    setScale(n);
                  }}
                  onReset={() => {
                    engine.current!.setCharacterScale(1);
                    setScale(1);
                  }}
                />
                <div className="body-sliders">
                  {BODY_KEYS.map((k) => {
                    const p = BODY_PARAMETERS[k];
                    return (
                      <Slider
                        key={k}
                        id={k}
                        label={p.label}
                        min={p.min}
                        max={p.max}
                        value={body[k]}
                        step={p.step}
                        unit={p.unit}
                        onChange={(n) => applyBody({ [k]: n })}
                        onReset={() => applyBody({ [k]: p.default })}
                      />
                    );
                  })}
                </div>
                <Button
                  onClick={() => {
                    engine.current!.resetBodyShape();
                    refreshBody();
                  }}
                >
                  전체 체형 초기화
                </Button>
                <details>
                  <summary>체형 JSON 저장 / 불러오기</summary>
                  <div className="view-buttons">
                    <Button
                      size="small"
                      onClick={() => setJson(engine.current!.exportBodyJSON())}
                    >
                      JSON 표시
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        download(
                          engine.current!.exportBodyJSON(),
                          "character-body.json",
                        )
                      }
                    >
                      파일 내보내기
                    </Button>
                  </div>
                  <Field id="body-json" label="체형 JSON">
                    <textarea
                      id="body-json"
                      value={json}
                      onChange={(e) => setJson(e.target.value)}
                      rows={8}
                    />
                  </Field>
                  <Button
                    onClick={() => {
                      try {
                        engine.current!.importBodyJSON(json);
                        refreshBody();
                        setError("");
                        setNotice("체형을 불러왔습니다.");
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    JSON 적용
                  </Button>
                  <Field id="body-file" label="JSON 파일 불러오기">
                    <input
                      id="body-file"
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          if (file.size > 20000)
                            throw new Error(
                              "JSON 파일은 20KB 이하여야 합니다.",
                            );
                          const text = await file.text();
                          engine.current!.importBodyJSON(text);
                          setJson(text);
                          refreshBody();
                          setError("");
                        } catch (error) {
                          setError(String(error));
                        }
                      }}
                    />
                  </Field>
                </details>
              </>
            )}
            {tab === "렌더링" && (
              <>
                <p className="section-kicker">03 / PIXEL FINISH</p>
                <h2>작은 픽셀, 또렷한 표정</h2>
                <Field id="resolution" label="내부 해상도">
                  <select
                    id="resolution"
                    value={resolution}
                    onChange={(e) => {
                      const n = Number(e.target.value) as 128 | 256;
                      engine.current!.setResolution(n);
                      setResolution(n);
                    }}
                  >
                    <option value="128">128 × 128</option>
                    <option value="256">256 × 256</option>
                  </select>
                </Field>
                <Slider
                  id="zoom"
                  label="화면 정수 확대 배율"
                  min={1}
                  max={6}
                  step={1}
                  unit="×"
                  value={zoom}
                  onChange={(n) => {
                    engine.current!.setDisplayScale(n);
                    setZoom(n);
                  }}
                />
                <p className="muted small">
                  좁은 화면에서는 들어가는 최대 정수 배율을 사용합니다.
                </p>
                <CheckRow
                  checked={style.outline}
                  onChange={(e) => applyStyle({ outline: e.target.checked })}
                >
                  실루엣 외곽선 · 내부 1픽셀
                </CheckRow>
                <Slider
                  id="depth"
                  label="깊이 경계"
                  min={0}
                  max={1}
                  value={style.depthEdgeStrength}
                  onChange={(n) => applyStyle({ depthEdgeStrength: n })}
                />
                <Slider
                  id="normal"
                  label="노멀 경계"
                  min={0}
                  max={1}
                  value={style.normalEdgeStrength}
                  onChange={(n) => applyStyle({ normalEdgeStrength: n })}
                />
                <Slider
                  id="shading"
                  label="명암 단계"
                  min={2}
                  max={8}
                  step={1}
                  value={style.shadingSteps}
                  onChange={(n) => applyStyle({ shadingSteps: n })}
                />
                <Slider
                  id="palette"
                  label="팔레트 제한 강도"
                  min={0}
                  max={1}
                  value={style.paletteStrength}
                  onChange={(n) => applyStyle({ paletteStrength: n })}
                />
                <CheckRow
                  checked={checker}
                  onChange={(e) => setChecker(e.target.checked)}
                >
                  투명도 확인용 체크무늬 배경
                </CheckRow>
                <CheckRow
                  checked={baseline}
                  onChange={(e) => {
                    setBaseline(e.target.checked);
                    engine.current!.setOfficialBaseline(e.target.checked);
                  }}
                >
                  공식 RenderPixelatedPass 비교
                </CheckRow>
                {baseline && (
                  <p className="muted small">
                    공식 원본 비교: 실루엣·팔레트 효과는 적용되지 않으며 경계가
                    알파를 변경할 수 있습니다.
                  </p>
                )}
              </>
            )}
          </fieldset>
          {tab === "벤치마크" && (
            <div className="controls-body">
              <p className="section-kicker">04 / MEASURE</p>
              <h2>성능은 측정한 만큼만</h2>
              <p className="muted">
                1·10·50개 × 128·256 × 경계 OFF·ON × 기본·혼합 체형. 하나의 WebGL
                컨텍스트와 고정 카메라에서 독립적으로 움직입니다.
              </p>
              <p className="muted small">
                조건마다 30프레임 워밍업 + 120프레임 측정. 활성 탭을 유지하세요.
                저성능 환경에서는 수 분 걸릴 수 있습니다.
              </p>
              <div ref={benchHost} className="benchmark-stage" />
              <div className="view-buttons">
                <Button disabled={busy || !ready} onClick={startBenchmark}>
                  24개 조건 측정
                </Button>
                {busy && (
                  <Button onClick={() => abort.current?.abort()}>
                    측정 중단
                  </Button>
                )}
              </div>
              <p role="status">{benchmark}</p>
              {benchResult && (
                <>
                  <Button
                    onClick={() =>
                      download(
                        JSON.stringify(benchResult, null, 2),
                        "pixel-benchmark.json",
                      )
                    }
                  >
                    측정 결과 JSON 저장
                  </Button>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>조건</th>
                          <th>중앙값</th>
                          <th>p95</th>
                          <th>GPU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {benchResult.results.map((r, i) => (
                          <tr key={i}>
                            <td>
                              {r.count} / {r.resolution} /{" "}
                              {r.edges ? "경계" : "없음"} /{" "}
                              {r.mixed ? "혼합" : "기본"}
                            </td>
                            <td>{r.medianMs.toFixed(1)}</td>
                            <td>{r.p95Ms.toFixed(1)}</td>
                            <td>{r.gpuMedianMs?.toFixed(2) ?? "불가"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small">
                    단위 ms. CPU·체형 갱신·전체 패스 통계와 환경은 JSON에
                    포함됩니다.
                  </p>
                </>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </Panel>
      </div>
      <footer>
        실시간 메시 · 절차적 리그 · GPU 도트 스타일{" "}
        <span>스프라이트 시트 없이 렌더링합니다.</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
