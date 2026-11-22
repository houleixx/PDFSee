#!/bin/bash
set -euo pipefail

scripts=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
output=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

dmgbuild=${PDFSEE_DMGBUILD:-}
if [[ -z "$dmgbuild" ]]; then
  python3 -m venv "$work/tools"
  "$work/tools/bin/python" -m pip install --disable-pip-version-check -r "$scripts/dmg-requirements.txt"
  dmgbuild="$work/tools/bin/dmgbuild"
fi

swift -module-cache-path "$work/swift-cache" "$scripts/dmg-background.swift" "$work"
"$dmgbuild" -s "$scripts/dmg-settings.py" \
  -D "app=$app" -D "background=$work/background.png" PDFSee "$output"
