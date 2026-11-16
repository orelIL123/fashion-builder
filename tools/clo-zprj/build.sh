#!/usr/bin/env bash
# Rebuild a CLO-based garment:  tools/clo-zprj/build.sh <raglanjersey|womenjersey> <file.zprj> <assets/dir>
# Needs python3 with numpy + scipy, Blender 4.2 (BLENDER=...), and npx (gltf-transform for meshopt).
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; NAME="$1"; ZPRJ="$2"; DEST="$3"; TMP="$(mktemp -d)"
PY="${PY:-python3}"; BLENDER="${BLENDER:-blender}"
"$PY" "$H/build_a.py" "$H/$NAME.json" "$TMP/$NAME" "$ZPRJ"
"$BLENDER" -b -P "$H/build_b.py" -- "$TMP/$NAME.obj" "$TMP/${NAME}_raw.glb" 0.5 | grep RESULT
npx -y @gltf-transform/cli meshopt "$TMP/${NAME}_raw.glb" "$DEST/jersey.glb"
cp "$TMP/${NAME}_pattern.json" "$DEST/pattern.json"
echo "wrote $DEST/jersey.glb and $DEST/pattern.json"
