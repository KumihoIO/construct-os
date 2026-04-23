#!/usr/bin/env bash
# Gate that workspace version, Tauri app config, and web package.json
# all match. Prevents release artifacts shipping with divergent versions.
#
# Exits non-zero if any mismatch is detected.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

workspace_version=$(awk '
  /^\[package\]/ { in_block = 1; next }
  /^\[/ && in_block { in_block = 0 }
  in_block && /^version[[:space:]]*=/ {
    match($0, /"[^"]+"/)
    print substr($0, RSTART + 1, RLENGTH - 2)
    exit
  }
' "$ROOT/Cargo.toml")

tauri_version=$(python3 -c "import json,sys; print(json.load(open('$ROOT/apps/tauri/tauri.conf.json'))['version'])")
web_version=$(python3 -c "import json,sys; print(json.load(open('$ROOT/web/package.json')).get('version',''))")

echo "workspace: ${workspace_version}"
echo "tauri:     ${tauri_version}"
echo "web:       ${web_version}"

fail=0
if [ -z "$workspace_version" ]; then
  echo "::error::could not parse workspace version from Cargo.toml"
  fail=1
fi
if [ "$tauri_version" != "$workspace_version" ]; then
  echo "::error::tauri.conf.json version ($tauri_version) != workspace ($workspace_version)"
  fail=1
fi
if [ "$web_version" != "$workspace_version" ]; then
  echo "::error::web/package.json version ($web_version) != workspace ($workspace_version)"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "Versions aligned."
