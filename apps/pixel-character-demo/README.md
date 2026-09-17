# Pixel Character Lab

루트에서 `npm ci && npm run dev:pixel`, http://127.0.0.1:1430.

- `동작`: idle/walk/wave/jump, 시선, 방향, 중립 자세/가이드, 수동 관절과 실제 이동.
- `체형`: 17개 체형 항목, 별도 전체 스케일, 프리셋, JSON 저장·복원.
- `렌더링`: 128/256, 정수 확대, GPU 명암/팔레트/경계, 투명 배경, 공식 패스 비교.
- `벤치마크`: 공유 WebGL2 컨텍스트의 24개 조건. 결과 JSON에 환경·CPU·GPU·드로 콜을 포함.

React UI는 Queuest 토큰과 데모 내부 `controls.tsx`의 최소 컨트롤을 사용하며 `component` 북마크에 의존하지 않는다. 엔진은 React 독립이며
[API·비율·한계·검증 설명](../../packages/pixel-character/README.md)에 문서화했다.

`window.pixelEngine`, `window.PixelCharacterEngine`, `window.runPixelBenchmark`는 이 데모의 콘솔·검증용 진입점이다. 엔진 패키지는 전역 객체를 설치하지 않는다.
