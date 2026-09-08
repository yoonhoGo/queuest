# Queuest desktop

Queuest의 Tauri 셸과 React 화면입니다. 앱은 `@queuest/domain`의 순수 모델을 사용하고, SQLite·Claude·GitHub 경계는 각각 어댑터 패키지에 둡니다.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

루트에서 `npm run dev`를 실행하면 브라우저 UI를 확인할 수 있고, `npm run tauri -- dev`를 실행하면 데스크톱 셸과 메뉴바 트레이를 함께 확인할 수 있습니다.
