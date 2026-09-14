#!/bin/sh
set -eu

# Requires ImageMagick, resvg, and Python 3.

icon_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/queuest-icons.XXXXXX")
render_dir="$temp_root/render"
mkdir "$render_dir"
trap 'rm -rf "$temp_root"' EXIT

# Keep the supplied artwork intact, with a macOS-style transparent corner mask.
magick "$icon_dir/brand-logo.png" -resize 1024x1024! -alpha set \
  \( -size 1024x1024 xc:none -fill white -draw 'roundrectangle 0,0 1023,1023 214,214' \) \
  -compose CopyOpacity -composite -strip -define png:exclude-chunk=time \
  "PNG32:$icon_dir/dock-icon.png"

for size in 16 24 30 32 44 48 50 64 71 89 107 128 142 150 256 284 310 512 1024; do
  magick "$icon_dir/dock-icon.png" -resize "${size}x${size}" \
    -strip -define png:exclude-chunk=time "PNG32:$render_dir/$size.png"
done

cp "$render_dir/32.png" "$icon_dir/32x32.png"
cp "$render_dir/128.png" "$icon_dir/128x128.png"
cp "$render_dir/256.png" "$icon_dir/128x128@2x.png"
cp "$render_dir/512.png" "$icon_dir/icon.png"

for size in 30 44 71 89 107 142 150 284 310; do
  cp "$render_dir/$size.png" "$icon_dir/Square${size}x${size}Logo.png"
done
cp "$render_dir/50.png" "$icon_dir/StoreLogo.png"

# ICNS stores PNG layers directly. This also works on machines without iconutil.
python3 - "$icon_dir" <<'PY'
from pathlib import Path
from struct import pack
import sys

root = Path(sys.argv[1])
layers = [('ic08', '128x128@2x.png'), ('ic09', 'icon.png'), ('ic10', 'dock-icon.png')]
chunks = []
for kind, name in layers:
    png = (root / name).read_bytes()
    chunks.append(kind.encode('ascii') + pack('>I', len(png) + 8) + png)
body = b''.join(chunks)
(root / 'icon.icns').write_bytes(b'icns' + pack('>I', len(body) + 8) + body)
PY

magick "$render_dir/32.png" "$render_dir/16.png" "$render_dir/24.png" "$render_dir/48.png" \
  "$render_dir/64.png" "$render_dir/256.png" "$icon_dir/icon.ico"

# macOS recolors the alpha of this monochrome template for light and dark menu bars.
resvg -w 49 -h 18 "$icon_dir/tray-icon.svg" "$icon_dir/trayTemplate.png"
resvg -w 98 -h 36 "$icon_dir/tray-icon.svg" "$icon_dir/trayTemplate@2x.png"
