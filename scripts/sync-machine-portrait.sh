#!/bin/sh

set -eu

surface_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
objects_root=${1:-"$surface_root/../objects"}
source_root="$objects_root/machine-portrait"
target_root="$surface_root/instrument-mpa"

if [ ! -d "$source_root/js" ] || [ ! -f "$source_root/index.html" ]; then
  echo "Machine Portrait source not found at $source_root" >&2
  exit 1
fi

if [ -n "$(git -C "$objects_root" status --short -- machine-portrait)" ]; then
  echo "Refusing to sync from a modified objects/machine-portrait tree" >&2
  exit 1
fi

source_commit=$(git -C "$objects_root" rev-parse HEAD)

mkdir -p "$target_root/css" "$target_root/js"
cp "$source_root/index.html" "$target_root/index.html"
cp "$source_root/css/apparatus.css" "$target_root/css/apparatus.css"
cp "$source_root/js/apparatus.js" "$target_root/js/apparatus.js"
cp "$source_root/js/derivation.js" "$target_root/js/derivation.js"
cp "$source_root/js/geometry.js" "$target_root/js/geometry.js"
cp "$source_root/js/record.js" "$target_root/js/record.js"
cp "$source_root/js/turn2.js" "$target_root/js/turn2.js"

# Surface owns public navigation. This is the only overlay applied to the
# shipped apparatus: the existing visual crumb becomes a link back to the
# Instruments index without changing its copy or presentation.
overlay_tmp=$(mktemp "$target_root/index.html.XXXXXX")
sed -e 's|<meta name="viewport" content="width=device-width, initial-scale=1">|<meta name="viewport" content="width=device-width, initial-scale=1">\
<base href="/instrument-mpa/">|' \
  -e 's|<div class="crumb">← INSTRUMENTS</div>|<a class="crumb" href="/instruments">← INSTRUMENTS</a>|' \
  "$target_root/index.html" > "$overlay_tmp"
mv "$overlay_tmp" "$target_root/index.html"

cat > "$target_root/SOURCE.json" <<EOF
{
  "source": "probnaya-work/objects/machine-portrait",
  "commit": "$source_commit",
  "runtimeFiles": [
    "index.html",
    "css/apparatus.css",
    "js/apparatus.js",
    "js/derivation.js",
    "js/geometry.js",
    "js/record.js",
    "js/turn2.js"
  ],
  "surfaceOverlay": "index.html: set the public asset base to /instrument-mpa/ and link the existing Instruments crumb to /instruments"
}
EOF

echo "Synced Machine Portrait from objects@$source_commit"
