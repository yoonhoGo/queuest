# Queuest 디자인 기준

**UI 구현의 단일 기준 문서는 [디자인 시스템](docs/design-system.md)이다.** 새 기능, 화면, 컴포넌트, 스타일을 만들거나 수정하기 전에 읽는다. 자동 작업 지침은 [AGENTS.md](AGENTS.md)에 연결되어 있다.

2026-09-11 승인된 [레트로 웹 미리보기](previews/retro/dist/index.html)의 파란 모눈 배경, 크림색 창, 민트색 타이틀바, 금색 선택 탭, 갈색 윤곽, 픽셀 아이콘과 캐릭터를 유지한다. 원본의 카드 구조와 글자 위계도 디자인 기준에 포함된다.

색상·간격·폰트의 실제 토큰은 [tokens.css](apps/desktop/src/styles/tokens.css), 창과 공용 컨트롤은 [retro-shell.css](apps/desktop/src/styles/retro-shell.css), 화면별 패턴은 [retro-content.css](apps/desktop/src/styles/retro-content.css)에 있다. 원본과 실제 앱의 의도된 차이, 접근성 기준, 새 기능 구현·검수 절차는 디자인 시스템 문서에서 관리한다.

새 토큰이나 패턴을 도입할 때에는 디자인 시스템 문서와 공용 코드를 함께 갱신한다. 이 파일에 별도의 규칙이나 중복된 토큰 표를 추가하지 않는다.
