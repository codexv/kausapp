#!/usr/bin/env bash
# Build assets/icon.icns from assets/icon.png using macOS iconutil.
# Run on macOS:  bash assets/build_icns.sh
set -euo pipefail
cd "$(dirname "$0")"

SRC="icon.png"
SET="icon.iconset"
rm -rf "$SET"
mkdir -p "$SET"

for sz in 16 32 64 128 256 512; do
  sips -z $sz $sz       "$SRC" --out "$SET/icon_${sz}x${sz}.png"        >/dev/null
  sips -z $((sz*2)) $((sz*2)) "$SRC" --out "$SET/icon_${sz}x${sz}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o icon.icns
rm -rf "$SET"
echo "Wrote assets/icon.icns"
