#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
output_path="${1:-$script_dir/.build/queuest-eventkit}"
output_dir="$(dirname -- "$output_path")"
mkdir -p "$output_dir"

if command -v xcrun >/dev/null 2>&1; then
  xcrun --sdk macosx swiftc \
    -O \
    -framework EventKit \
    -framework Foundation \
    "$script_dir/EventKitJSONL.swift" \
    -o "$output_path"
else
  swiftc \
    -O \
    -framework EventKit \
    -framework Foundation \
    "$script_dir/EventKitJSONL.swift" \
    -o "$output_path"
fi

chmod 755 "$output_path"
printf 'built %s\n' "$output_path"
