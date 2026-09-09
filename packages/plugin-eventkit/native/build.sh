#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
output_path="${1:-$script_dir/.build/queuest-eventkit}"
output_dir="$(dirname -- "$output_path")"
info_plist_path="${QUEUEST_EVENTKIT_INFO_PLIST:-$script_dir/Info.plist}"
entitlements_path="${QUEUEST_EVENTKIT_ENTITLEMENTS:-$script_dir/Entitlements.plist}"
codesign_identity="${QUEUEST_EVENTKIT_CODESIGN_IDENTITY:--}"
mkdir -p "$output_dir"

swiftc_args=(
  -O
  -framework EventKit
  -framework Foundation
  -Xlinker -sectcreate
  -Xlinker __TEXT
  -Xlinker __info_plist
  -Xlinker "$info_plist_path"
  "$script_dir/EventKitJSONL.swift"
  -o "$output_path"
)

if command -v xcrun >/dev/null 2>&1; then
  xcrun --sdk macosx swiftc "${swiftc_args[@]}"
else
  swiftc "${swiftc_args[@]}"
fi

chmod 755 "$output_path"
if [[ "${QUEUEST_EVENTKIT_SKIP_CODESIGN:-0}" != "1" ]]; then
  codesign_args=(--force --sign "$codesign_identity" --identifier com.yoonhogo.queuest.eventkit)
  if [[ -f "$entitlements_path" ]]; then
    codesign_args+=(--entitlements "$entitlements_path")
  fi
  if [[ "$codesign_identity" != "-" ]]; then
    codesign_args+=(--options runtime --timestamp)
  fi
  codesign "${codesign_args[@]}" "$output_path"
fi
printf 'built %s\n' "$output_path"
