#!/bin/sh
# Stamps a new version on the page's own scripts and styles (?v=… in index.html and js/app.js)
# so a normal reload picks up a fresh deploy instead of a cached copy, and writes version.json, which the
# page checks on every visit to load a newer deploy at once. Run before each commit to main.
cd "$(dirname "$0")/.." || exit 1
v=$(date -u +%Y%m%d%H%M%S)
sed -i "s/?v=[0-9A-Za-z]*\"/?v=$v\"/g" index.html
sed -i "s/?v=[0-9A-Za-z]*'/?v=$v'/g" js/app.js
sed -i "s/var v = '[0-9]*'/var v = '$v'/" index.html
printf '{"v":"%s"}\n' "$v" > version.json
echo "version $v"
