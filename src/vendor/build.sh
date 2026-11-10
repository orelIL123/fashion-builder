#!/bin/bash
# Rebuilds assets/vendor/three.fb.min.js from src/vendor/three-entry.js (needs Node 18+).
set -e
cd "$(dirname "$0")"
TMP="$(mktemp -d)"; cp three-entry.js "$TMP/"; cd "$TMP"
npm init -y >/dev/null && npm i --silent three@0.170.0 esbuild
npx esbuild three-entry.js --bundle --minify --format=esm --target=es2020 --legal-comments=none \
  '--banner:js=/*! three.js r170 (c) 2010-2024 three.js authors, MIT License, https://threejs.org | meshoptimizer decoder (c) Arseny Kapoulkine, MIT License | tree-shaken build for Fashion Builder: see src/vendor/three-entry.js */' \
  --outfile=three.fb.min.js
cp three.fb.min.js "$OLDPWD/../../assets/vendor/three.fb.min.js"
echo "wrote assets/vendor/three.fb.min.js ($(wc -c < three.fb.min.js) bytes)"
