#!/bin/sh

set -eu

surface_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
objects_root=${1:-"$surface_root/../objects"}
source_root="$objects_root/machine-portrait"
target_root="$surface_root/instrument-mpa"
overlay_patch="$surface_root/scripts/machine-portrait-surface.patch"

if [ ! -d "$source_root/js" ] || [ ! -f "$source_root/index.html" ]; then
  echo "Machine Portrait source not found at $source_root" >&2
  exit 1
fi

if [ ! -f "$overlay_patch" ]; then
  echo "Machine Portrait surface overlay not found at $overlay_patch" >&2
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
cp "$source_root/js/archive.js" "$target_root/js/archive.js"
cp "$source_root/js/issue-package.js" "$target_root/js/issue-package.js"
cp "$source_root/js/issue-render.js" "$target_root/js/issue-render.js"
cp "$source_root/js/record.js" "$target_root/js/record.js"
cp "$source_root/js/source-input.js" "$target_root/js/source-input.js"
cp "$source_root/js/turn2.js" "$target_root/js/turn2.js"
cp "$source_root/js/zip.js" "$target_root/js/zip.js"

# Historical 32 × 32 research remains in objects for provenance, but is not
# part of the public runtime artifact.
rm -f "$target_root/js/derivation.js" "$target_root/js/geometry.js"

# Objects owns apparatus behavior. Surface owns this explicit public-document
# overlay: asset base, navigation, metadata, structured data and heading
# semantics. Check first so canonical source drift fails without a partial overlay.
git -C "$surface_root" apply --check --directory=instrument-mpa "$overlay_patch"
git -C "$surface_root" apply --directory=instrument-mpa "$overlay_patch"

cat > "$target_root/SOURCE.json" <<EOF
{
  "source": "probnaya-work/objects/machine-portrait",
  "commit": "$source_commit",
  "runtimeFiles": [
    "index.html",
    "css/apparatus.css",
    "js/apparatus.js",
    "js/archive.js",
    "js/issue-package.js",
    "js/issue-render.js",
    "js/record.js",
    "js/source-input.js",
    "js/turn2.js",
    "js/zip.js"
  ],
  "surfaceOverlay": "scripts/machine-portrait-surface.patch: public asset base, navigation, metadata, structured data and heading semantics"
}
EOF

echo "Synced Machine Portrait from objects@$source_commit"
