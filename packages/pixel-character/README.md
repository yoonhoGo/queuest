# 실시간 3D → 2D 도트 캐릭터

외부 모델·스프라이트 시트 없이 코드로 만든 3등신 캐릭터를 WebGL2에서 실시간 렌더링한다. 엔진은 DOM 컨테이너와 Three.js만 필요하며 React에 의존하지 않는다. 데모는 기존 Queuest 디자인 토큰과 데모 내부의 최소 React 컨트롤을 사용해 공용 UI 작업과 독립적으로 빌드된다. Tauri 캐릭터 화면이나 사용자 DB를 변경하지 않는다.

## 실행

저장소 루트에서 실행한다. 검증 환경은 Node 24.10.0, npm 11 계열이다.

```sh
npm ci
npm run dev:pixel
# http://127.0.0.1:1430

npm run build:pixel
npm run test:pixel
# Chrome이 설치된 환경에서 개발 서버를 켜고:
npm run smoke:pixel
PIXEL_BENCHMARK=1 npm run smoke:pixel
```

프로덕션 데모: `npm run preview --workspace @queuest/pixel-character-demo` (개발 서버와 같은 1430 포트이므로 하나만 실행). 엔진 배포 파일은 `packages/pixel-character/dist`, 데모는 `apps/pixel-character-demo/dist`다. 데모 스모크 출력은 `/tmp/queuest-pixel-character`; `PIXEL_OUTPUT`·`PIXEL_URL`로 변경한다. 브라우저 드라이버는 Playwright 1.58.2, 실제 브라우저는 설치된 Chrome 채널이다.

Three.js·타입 0.186.0, TypeScript 6.0.3, Vite 8.2.2, React 19.2.8을 명시하고 루트 `package-lock.json`에 고정했다. Three.js r186의 실제 설치 소스 `RenderPixelatedPass.js`, `EffectComposer.js`, `OutputPass.js`와 공식 문서를 대조했다. WebGL1·WebGPU·Rust/WASM·ossos 의존성은 없다.

## 구조와 외부 프로젝트 삽입

| 파일 | 책임 |
|---|---|
| `src/body.ts` | 순수 체형 데이터, 범위, 3등신 계산, JSON |
| `src/rig.ts` | 단위 스케일 관절 계층과 rest 위치 |
| `src/appearance.ts` | 코드 생성 메시·재질, GPU 명암 단계 |
| `src/animator.ts` | 렌더링과 분리된 숫자 포즈 계산 |
| `src/character.ts` | 체형 보간, 리그·외형·포즈 연결, 발 지면 보정 |
| `src/pixel-pass.ts`, `renderer.ts` | 저해상도 렌더 타깃, 경계·팔레트·출력 |
| `src/gpu-timer.ts` | 비동기 GPU 시간 측정 |
| `src/engine.ts` | 임베딩 API, RAF, 컨테이너 크기, 리소스 수명 |
| `apps/pixel-character-demo/src` | React 데모와 공유 렌더러 벤치마크 |

엔진 워크스페이스를 빌드한 뒤 로컬 패키지로 설치하거나 `npm pack --workspace @queuest/pixel-character`로 패키징한다. 외부 프로젝트에서 패키지의 `dist/index.js`·타입 선언을 사용한다. 소스는 `.ts` 상대 경로를 사용하고 빌드 시 `.js`로 변환된다. 데모는 개발 중 소스 alias를 사용한다.

```ts
import { PixelCharacterEngine } from '@queuest/pixel-character';

const engine = new PixelCharacterEngine({
  container: document.querySelector<HTMLElement>('#character')!,
  resolution: 256,
  scale: 3,             // CSS 확대 배율. 캐릭터 체형 스케일과 별개.
  transparent: true,
});
engine.setAction('walk');             // 제자리 보행
engine.lookAt({ x: .3, y: .2 });
engine.playGesture('wave');
engine.jump();
engine.setBodyShape({ shoulderWidth: 1.1, waistWidth: .6, legLengthRatio: .6 });
engine.setCharacterScale(1.2);
engine.setResolution(128);
engine.setStyle({ outline: true, shadingSteps: 4 });
const body = engine.getBodyShape();   // 복사본
const json = engine.exportBodyJSON();
engine.importBodyJSON(json);
// 호스트 화면이 제거될 때:
engine.dispose();
```

호스트는 컨테이너에 최소 256 CSS px(256 모드) 또는 128 CSS px를 확보한다. 엔진은 화면 폭에 들어가는 가장 큰 정수 확대 배율로 canvas를 줄이며 1배보다 축소하지 않는다. 가운데 정렬은 호스트의 flex/grid로 지정한다. 데모는 이를 적용한다. `transparent:false`는 canvas의 CSS 배경을 불투명 파랑으로 표시한다. 렌더 타깃 알파는 두 모드 모두 보존되어 외곽선 계산이 같다.

## 좌표·API·충돌 규칙

- 오른손 좌표계. +Y 위, +Z 캐릭터 정면, +X 캐릭터 왼쪽. 발바닥은 월드 Y=0. 1H는 기본 머리 높이 1 월드 단위다. 월드의 머리 높이는 `characterScale × H`.
- `lookAt({x,y})`: 카메라 기준 정규화 입력, 각각 −1…1. x는 화면 오른쪽, y는 화면 위쪽. 머리 회전 yaw ±0.6, pitch ±0.38 rad와 작은 눈 이동으로 변환한다. 캐릭터를 회전했을 때도 입력은 캐릭터 로컬 시선 오프셋으로 적용되며, 월드 타깃 역변환은 제공하지 않는다.
- `setAction('idle'|'walk')`: 포즈 전환. `idle`은 실제 이동도 정지한다. `walk` 자체는 위치를 바꾸지 않으며 기존 이동 벡터가 있다면 유지한다.
- `setWalkSpeed(0…2)`: 보행 계산용 H/s. `setMovement({x,z,speed})`: x,z는 −1…1, 정규화한 방향으로 월드 이동; speed는 0…2H/s. 이동 방향으로 회전한다. 영벡터 또는 speed=0은 idle. 카메라가 추적하지 않으므로 장거리 이동 시 화면 밖으로 나간다. `resetPosition()`으로 원점 복귀.
- `setDirection(radians)`: −2π…2π, Y축 방향. `setPose({leftElbow:{x:-1}})`는 해당 관절·축만 덮어쓴다. rad 단위이고 `JOINT_LIMITS`를 넘으면 거절. 수동 포즈가 애니메이션보다 우선하며 `clearPose()`로 해제한다. 일반 모델 편집기나 임의 포즈의 자기 충돌 해법은 아니다.
- 합성 순서: rest → 호흡·보행 → 시선 → 왼팔 wave → 명시한 수동 축 → 제한·시간 기반 블렌딩 → 발 지면 보정. Wave는 왼팔만 차지해 보행과 시선이 계속된다. Wave 반복은 제스처 시계 재시작. Jump 반복은 회복 완료까지 무시하며 수락 여부를 boolean으로 반환한다.
- Jump: 준비 .18초 → 포물선 비행 .65초 → 착지 .16초 → 회복 .20초. 발사 때 월드 높이를 저장하므로 비행 중 체형·스케일이 바뀌어도 체공 시계와 최고점이 초기화되지 않는다. 점프 중 보행 위상은 계속 계산하되 다리 보행 포즈는 억제한다.
- `setNeutralPose(true)`: 중립 포즈를 우선하고 동작 시계·이동을 멈춘다. 해제하면 기존 상태를 이어간다. 공중에서 중립 모드로 들어가면 비율 확인을 위해 지면에 내려놓는다. `setGuides(true)`는 머리 1H와 전체 3H의 선을 표시하며 중립 자세에서만 비율 검사용이다.
- `setBodyShape(partial)`: 일부 항목만 갱신. 모든 값의 검사 후 원자적으로 반영한다. 잘못된 값·알 수 없는 키·NaN·Infinity는 예외이며 조용히 clamp하지 않는다. getter는 목표 설정의 복사본이다. `getDiagnostics().body`는 현재 보간된 체형이다.
- `applyBodyPreset('default'|'slim'|'round'|'broad')`, `resetBodyShape()`. 전체 초기화는 캐릭터 스케일도 1로 복원한다.
- `setDisplayScale(1…6 정수)`와 `setCharacterScale(.65…1.5)`는 독립. `fitToView()`는 현재 목표 스케일에 맞춰 카메라를 한 번 조정한다. 이후 크게 키웠다면 다시 맞춘다. 기본 카메라는 최대 허용 크기·동작을 위한 여백을 둔다. 매 프레임 zoom하지 않는다.
- `setPixelSnap(true)`는 캐릭터 루트의 화면상 X만 픽셀 정렬한다. 점프·관절을 강제로 snap하지 않는다. 기본은 꺼짐.
- `setPaused(true)`는 RAF를 중단한다. 정지 중 체형·시선·스타일 편집은 시계를 진행하지 않고 즉시 정적 렌더링한다. `stop()`은 외부 루프에 제어권을 넘긴다. `{autoStart:false}` + `step(deltaSeconds)`로 직접 진행 가능; 수동 호스트는 자신의 가시성 정책을 적용해야 한다.
- delta는 최대 .05초로 제한. 숨김·화면 밖에서 자동 RAF를 취소하고 복귀 시 기준 시간을 새로 잡는다. 오래 숨긴 동안의 동작을 한꺼번에 따라잡지 않는다.

## 체형 파라미터

| 키 | 기본 | 최소–최대 | 단위/의미 |
|---|---:|---:|---|
| headWidth | 1 | .78–1.18 | H, 머리 너비 |
| headDepth | .82 | .65–1 | H, 머리 깊이 |
| shoulderWidth | .88 | .7–1.15 | H, 요청 어깨 중심 간격 |
| chestWidth / chestDepth | .68 / .43 | .52–.88 / .32–.58 | H |
| waistWidth / waistDepth | .52 / .35 | .4–.72 / .28–.5 | H |
| pelvisWidth / pelvisDepth | .62 / .4 | .5–.82 / .32–.56 | H |
| armLength | .8 | .62–.96 | H, 어깨→손목 (손 제외) |
| upperArmThickness | .22 | .17–.29 | H |
| forearmThickness | .19 | .15–.26 | H |
| handSize | 1 | .8–1.25 | 배율, 기본 .24×.27×.23H |
| legLengthRatio | .56 | .48–.65 | 배분 가능 길이 중 다리 비율 |
| thighThickness | .26 | .2–.33 | H |
| calfThickness | .22 | .17–.28 | H |
| footSize | 1 | .8–1.2 | 배율, 기본 .26×.16×.40H |
| characterScale | 1 | .65–1.5 | 모든 길이에 적용하는 별도 균일 배율 |

슬라이더 간격은 .01이며 API는 범위 안 실수를 허용한다. 실효 어깨 간격은 `max(shoulderWidth, chestWidth + .65 × upperArmThickness)`로 보정해 두꺼운 팔이 가슴에 완전히 잠기지 않게 한다. 가슴이 좁고 어깨가 넓은 경우 연결 메시가 어깨까지 이어진다. 골반 소켓 간격은 `max(.58 × pelvisWidth, thighThickness + .07, .26 × footSize + .06)`이다. 실효 값은 diagnostics의 `dimensions.shoulderSpread/hipSpread`에서 확인한다.

### 3등신 계산

머리 높이 H=1. 머리의 아래=2, 정수리=3, 발바닥=0이다. 머리카락·귀 등 장식은 head 메시 높이 계산에 포함하지 않는다.

```text
목 N = .12H, 골반 P = .24H, 발 F = .16H × footSize
배분 가능 길이 A = 2H − N − P − F
다리 L = A × legLengthRatio
몸통 T = A − L
허벅지 = .51L, 종아리 = .49L
N + T + P + 허벅지 + 종아리 + F = 2H
머리 1H + 머리 아래 2H = 3H
```

기본형: N=.12, P=.24, F=.16, L=.8288, T=.6512H. 팔 길이는 신장 합산과 독립이며 위팔 .52, 아래팔 .48로 나눈다. 모든 관절 노드의 스케일은 (1,1,1), 메시만 비균일 스케일이다. 원본 치수에서 다시 계산하며 달라진 치수만 메시·관절에 쓴다. 체형 변화가 없으면 rest pose를 재계산하지 않는다. 부모 스케일 누적이나 이전 길이에 반복 배율을 곱하는 방식이 아니다.

약 .2초 동안 체형을 보간하고 .00001 미만 차이는 원래 값으로 정확히 스냅한다. rest 갱신 뒤 현재 포즈를 다시 적용한다. 발 메시 8개 코너를 재사용 벡터로 계산해 지면 아래로 내려간 만큼 루트를 보정한다. SkinnedMesh를 사용하지 않으므로 inverse bind matrix 갱신은 필요하지 않다. 중립 모드·정지 편집에서는 보간 없이 정확한 치수를 표시한다.

JSON은 `{version:1, characterScale:number, body:모든 17개 항목}`이다. 가져올 때 필수 키 누락·새 키·타입·버전·범위를 검사하고 기존 체형을 부분적으로 훼손하지 않는다. API 부분 갱신과 전체 JSON 파일 형식을 구분한다.

## 렌더링과 스타일

```text
GPU 단계별 명암을 적용한 beauty + depth (128² 또는 256²)
→ 선택적 normal 장면 (normalEdgeStrength > 0일 때만)
→ 내부 깊이/노멀 경계 + 4방향 1픽셀 실루엣 + RGB 양자화
→ OutputPass (linear → sRGB, NoToneMapping)
→ 같은 저해상도 canvas → CSS image-rendering: pixelated 정수 확대
```

renderer DPR=1, composer DPR=1, `pixelSize=1`. canvas drawing buffer, composer read/write, beauty·normal 타깃의 너비/높이는 모두 요청한 128 또는 256이다. 기기 DPR을 곱하지 않는다. 화면의 512×512는 CSS 크기이고 내부 512×512 타깃이 아니다. 타깃 필터는 nearest, MSAA/FXAA/TAA는 없다. 경계+양자화는 하나의 full-screen pass로 묶고 출력 pass를 이어 쓴다. 장면을 이미 그리는 픽셀 패스 앞에 RenderPass를 추가하지 않는다.

`setStyle`은 `outline:boolean`, `depthEdgeStrength:0…1`, `normalEdgeStrength:0…1`, `shadingSteps:2…8 정수`, `paletteStrength:0…1` 부분 갱신을 받는다. 명암은 표면 셰이더에서 고정 광원과 제한된 단계로 계산한다. 팔레트는 linear RGB를 채널별 8단계 격자로 양자화하고 원본과 섞는다. 특정 아트 디렉션 팔레트에 가장 가까운 색을 찾는 LUT는 아니다.

깊이·노멀 강조는 내부 RGB만 바꾼다. alpha=0인 이웃으로는 opaque 실루엣을 4방향 한 픽셀만 확장한다. 희미한 바닥 접지 그림자에는 외곽선을 확장하지 않는다. 투명한 곳의 RGB를 외곽선 판단에 쓰지 않는다. 공식 비교 모드 `setOfficialBaseline(true)`는 변경하지 않은 r186 `RenderPixelatedPass`+`OutputPass`다. 원본의 `texel * Strength`가 alpha도 바꾸고 normal 렌더를 항상 수행하는 점을 기본 패스에서 보완했다. 출처·라이선스와 차이는 [THIRD_PARTY.md](THIRD_PARTY.md)에 있다.

조명·정사영 카메라를 고정해 불필요한 흔들림을 줄였다. 그래도 저해상도에서 회전하는 곡면·가려짐·얼굴·대각선 경계는 픽셀 단위로 튄다. 외곽선이나 강한 팔레트 양자화는 이를 더 드러낼 수 있다. 관절을 snap하지 않아 연속적인 움직임을 유지하며, 정확한 측면에서는 반대편 팔다리가 가려지는 정상적인 3D 가림이 남는다. temporal AA를 사용하면 도트가 흐려지므로 적용하지 않았다.

## GLB·IK 확장 범위

`CharacterAdapter`는 `root`, `animator`, `dimensions`, `supportsBodyShape`, `update`, `setShadingSteps`, `dispose`와 선택적인 `setBodyShape`를 정의한다. 현재 Engine 파사드는 ProceduralCharacter를 사용한다. 실제 GLB를 연결할 때에는 GLTFLoader로 별도 로드하고 해당 모델의 뼈 이름·rest 축·스케일을 매핑하는 어댑터와 호스트 연결을 구현해야 한다. 이 버전에는 GLB 로딩 UI나 범용 리타기팅은 없다.

리깅된 GLB에 체형 변화를 지원하려면 morph target 또는 모델 전용 rest/bind 갱신이 필요하다. 어댑터가 `supportsBodyShape:false`를 선언하면 코드 생성 체형 슬라이더를 연결하지 않아야 한다. 메시에 뼈가 있다는 이유로 임의 GLB에 동일 체형 조절이 적용된다고 가정하지 않는다. skin을 변형하면 skeleton inverse bind도 함께 갱신하고 현재 애니메이션 포즈를 재적용해야 한다.

기본 보행의 두 관절 다리는 수치 삼각함수로 계산한다. 특정 외부 손/발 목표를 추적하는 IK API는 구현하지 않았다. 그런 기능이 필요할 때 Three.js `CCDIKSolver`와 호환되는 Bone/SkinnedMesh를 검토한다. 일반 Object3D 리그에 솔버를 억지로 연결하지 않는다. WASM·Worker·WebGPU는 측정된 필요에 따라 비교할 후속 후보이며 이 버전 기능으로 보고하지 않는다.

## 자원 소유권과 성능

캐릭터 외형 하나가 box/sphere geometry 및 여섯 재질을 소유하고 메시들이 공유한다. frame마다 geometry/material/vector/matrix를 새로 만들지 않는다. 포즈는 재사용 typed array, 발 검사는 재사용 Vector3다. 각 appearance는 dispose를 한 번만 실행하고, 엔진 dispose도 반복 호출에 안전하다. 렌더 타깃·패스·GPU query·renderer와 canvas, ResizeObserver·IntersectionObserver·visibility listener·RAF를 정리한다. 외부 어댑터 자원은 어댑터가 소유해야 한다.

1·10·50개 벤치마크는 하나의 renderer/context/scene을 공유한다. 50개의 별도 WebGL 컨텍스트를 생성하지 않는다. 현 버전은 캐릭터별 리소스 세트를 사용하며 instancing/캐릭터 간 geometry pooling은 없다. 모든 수에서 같은 30H 정사영 영역을 사용하므로 캐릭터별 픽셀 크기가 일정하고, 개별 128² 초상을 50개 그리는 비용과는 다르다. 이 차이를 성능 결과 해석에 포함해야 한다.

전체 render 직전 `info.reset()`을 한 번 호출하고 `autoReset=false`로 beauty·normal·full-screen 출력의 드로 콜/삼각형을 합산한다. CPU 애니메이션과 body/rest 갱신을 별도로 기록한다. GPU는 `EXT_disjoint_timer_query_webgl2` 비동기 query만 사용하며 pending이 많으면 건너뛴다. 지원하지 않거나 유효 표본이 없으면 null/측정 불가다. JS render 호출 시간을 GPU 시간으로 대신 쓰지 않는다. 렌더 경로에는 동기 readPixels/Canvas2D 복사가 없으며 readPixels는 명시적인 브라우저 검증 스크립트에서만 사용한다.

측정 결과·환경·검증과 남은 한계는 [검증 보고서](../../docs/pixel-character-validation.md)에서 확인한다. 낮은 해상도라도 여러 메시를 각각 그리므로 캐릭터 수와 함께 드로 콜이 증가한다. 모든 기기에서 특정 FPS나 개선율을 보장하지 않는다.
