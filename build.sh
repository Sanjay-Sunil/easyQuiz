#!/usr/bin/env bash
# Packages the extension. The same files work in every browser:
#   dist/easyquiz-chromium.zip  -> Chrome, Edge, Brave, Opera, Vivaldi, Arc (or Load unpacked on this folder)
#   dist/easyquiz-firefox.xpi   -> Firefox, Zen, LibreWolf, Floorp
set -euo pipefail
cd "$(dirname "$0")"
FILES=(manifest.json defaults.js background.js content.js options.html options.css options.js icons/*.png icons/logo.svg)
rm -rf dist && mkdir dist
zip -qX dist/easyquiz-chromium.zip "${FILES[@]}"
cp dist/easyquiz-chromium.zip dist/easyquiz-firefox.xpi
echo "Built:" && ls -1 dist
