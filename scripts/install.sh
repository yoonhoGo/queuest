#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ -z "${HOME:-}" ]; then
  echo "HOME 환경 변수가 필요합니다." >&2
  exit 1
fi

PREFIX=${PREFIX:-"$HOME/.local"}

print_usage() {
  cat <<'EOF'
사용법: sh scripts/install.sh [--prefix PATH]

Queuest Tauri .app 대신 CLI 진입점과 네이티브 실행 파일을 설치합니다.
기본 설치 위치: $HOME/.local/bin/queuest
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      if [ "$#" -lt 2 ]; then
        echo "--prefix에는 경로가 필요합니다." >&2
        exit 2
      fi
      PREFIX=$2
      shift 2
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "알 수 없는 인자입니다: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  echo "npm이 필요합니다." >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust cargo가 필요합니다." >&2
  exit 1
fi

echo "Queuest 웹 자산을 확인합니다."
cd "$ROOT_DIR"
npm run build --workspace @queuest/desktop
echo "Queuest native helper를 준비합니다."
npm run build:native --workspace @queuest/desktop
echo "CLI 실행 파일을 빌드합니다."
cargo build --release --features tauri/custom-protocol --manifest-path "$ROOT_DIR/apps/desktop/src-tauri/Cargo.toml"

BIN_DIR="$PREFIX/bin"
LIB_DIR="$PREFIX/lib/queuest"
install -d "$BIN_DIR" "$LIB_DIR"
install -m 755 "$ROOT_DIR/apps/desktop/src-tauri/target/release/queuest" "$LIB_DIR/queuest"
install -m 755 "$SCRIPT_DIR/queuest" "$BIN_DIR/queuest"

echo "Queuest CLI를 설치했습니다: $BIN_DIR/queuest"
echo "실행: $BIN_DIR/queuest"
echo "설정: $BIN_DIR/queuest settings"
case ":${PATH}:" in
  *:"$BIN_DIR":*) ;;
  *) echo "현재 셸의 PATH에 $BIN_DIR 를 추가하세요." ;;
esac
