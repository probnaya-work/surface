#!/bin/sh

set -eu

surface_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
objects_root=${1:-"$surface_root/../objects"}
source_root="$objects_root/ex"
target_root="$surface_root/objects/001"

if [ ! -f "$source_root/js/page.js" ] || [ ! -d "$source_root/wallpapers" ]; then
  echo "Object 001 source not found at $source_root" >&2
  exit 1
fi

if [ -n "$(git -C "$objects_root" status --short -- ex)" ]; then
  echo "Refusing to sync from a modified objects/ex tree" >&2
  exit 1
fi

source_commit=$(git -C "$objects_root" rev-parse HEAD)

# Surface owns objects/001/index.html. Only the runtime behaviour and the
# issued wallpapers are copied; the generator, fonts and tests stay in objects.
mkdir -p "$target_root/js" "$target_root/wallpapers"
cp "$source_root/js/card.js" "$target_root/js/card.js"
cp "$source_root/js/object.js" "$target_root/js/object.js"
cp "$source_root/js/page.js" "$target_root/js/page.js"
cp "$source_root/wallpapers/preview-desktop.png" "$target_root/wallpapers/preview-desktop.png"
cp "$source_root/wallpapers/preview-phone.png" "$target_root/wallpapers/preview-phone.png"
cp "$source_root/wallpapers/probnaya-ex-desktop-16x10-3456x2160.png" "$target_root/wallpapers/probnaya-ex-desktop-16x10-3456x2160.png"
cp "$source_root/wallpapers/probnaya-ex-desktop-16x9-3840x2160.png" "$target_root/wallpapers/probnaya-ex-desktop-16x9-3840x2160.png"
cp "$source_root/wallpapers/probnaya-ex-phone-1320x2868.png" "$target_root/wallpapers/probnaya-ex-phone-1320x2868.png"

cat > "$target_root/SOURCE.json" <<EOF
{
  "source": "probnaya-work/objects/ex",
  "commit": "$source_commit",
  "runtimeFiles": [
    "js/card.js",
    "js/object.js",
    "js/page.js",
    "wallpapers/preview-desktop.png",
    "wallpapers/preview-phone.png",
    "wallpapers/probnaya-ex-desktop-16x10-3456x2160.png",
    "wallpapers/probnaya-ex-desktop-16x9-3840x2160.png",
    "wallpapers/probnaya-ex-phone-1320x2868.png"
  ],
  "surfaceOwned": "index.html"
}
EOF

echo "Synced Object 001 from objects@$source_commit"
