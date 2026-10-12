#!/usr/bin/env bash
# mkicons.sh - regenerate the committed home-screen icons from icon.svg.
#
# The PNGs are committed (rsvg-convert is not part of the build), so run this
# only after editing web/icons/icon.svg. The artwork is full bleed with the
# mark inside the central 60%, so one source works as an apple-touch-icon
# (iOS rounds the corners) and as a maskable manifest icon.
#
# Usage:
#   web/icons/mkicons.sh
set -euo pipefail

cd "$(dirname "$0")"
out=../public
for size in 180 192 512; do
  name=icon-$size.png
  [[ $size == 180 ]] && name=apple-touch-icon.png
  rsvg-convert -w "$size" -h "$size" icon.svg -o "$out/$name"
done
