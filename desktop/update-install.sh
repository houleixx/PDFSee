#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

stage=$1
target=$2
viewer_pid=$3
backup="$stage/Previous.app"
installed=0

cleanup() {
  if [[ "$installed" == 0 && -d "$backup" ]]; then
    if [[ -e "$target" ]]; then mv "$target" "$stage/Failed.app" || return; fi
    mv "$backup" "$target" || return
    open -n "$target"
  fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

for attempt in {1..100}; do
  if ! kill -0 "$viewer_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if kill -0 "$viewer_pid" 2>/dev/null; then exit 1; fi

mv "$target" "$backup"
mv "$stage/PDFSee.app" "$target"
open -n "$target"
installed=1
