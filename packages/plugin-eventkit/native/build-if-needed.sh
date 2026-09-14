#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
output_path="${1:-$script_dir/.build/queuest-eventkit}"

sources=(
  "$script_dir/EventKitJSONL.swift"
  "$script_dir/Info.plist"
  "$script_dir/Entitlements.plist"
  "$script_dir/build.sh"
)

if [[ -x "$output_path" ]]; then
  up_to_date=1
  for source in "${sources[@]}"; do
    if [[ "$source" -nt "$output_path" ]]; then
      up_to_date=0
      break
    fi
  done
  if [[ "$up_to_date" == "1" ]]; then
    printf 'using existing %s\n' "$output_path"
    exit 0
  fi
fi

exec "$script_dir/build.sh" "$output_path"
