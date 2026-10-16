#!/usr/bin/env bash
# Rebuilds public/fonts/material-symbols.woff2 from the upstream Material Symbols variable font.
#
# Icons are addressed by codepoint rather than by ligature name: keeping the ligature lookups
# would pull every glyph in the family into the subset (264 KB instead of 5 KB). The codepoints
# are read straight out of components/icon.tsx, so that file stays the single source of truth.
#
# Requires fonttools:
#   python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install "fonttools[woff]" brotli
set -euo pipefail
cd "$(dirname "$0")/.."

PY=${FONTTOOLS_PYTHON:-/tmp/fontenv/bin/python}
SUBSET=${FONTTOOLS_SUBSET:-/tmp/fontenv/bin/pyftsubset}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

CSS_URL="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"

# Google serves woff2 only to a user agent it recognises as a modern browser; a short UA string
# silently gets TTF back instead, which the instancer below cannot read.
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

echo "1/3  resolving the current variable font"
FONT_URL=$(curl -fsS -A "$UA" "$CSS_URL" | grep -o "https://[^)]*\.woff2" | head -1)
[ -n "$FONT_URL" ] || { echo "no woff2 URL in the Google Fonts CSS - check the user agent"; exit 1; }
curl -fsS -o "$WORK/full.woff2" "$FONT_URL"

echo "2/3  pinning the variable axes to one instance"
"$PY" -m fontTools.varLib.instancer "$WORK/full.woff2" opsz=20 wght=400 FILL=0 GRAD=0 \
  -o "$WORK/static.ttf" >/dev/null

echo "3/3  subsetting to the icons this UI uses"
UNICODES=$("$PY" scripts/icon-codepoints.py)
"$SUBSET" "$WORK/static.ttf" --output-file=public/fonts/material-symbols.woff2 \
  --flavor=woff2 --unicodes="$UNICODES" --no-hinting --desubroutinize --layout-features=""

echo "done:"
ls -lh public/fonts/material-symbols.woff2
