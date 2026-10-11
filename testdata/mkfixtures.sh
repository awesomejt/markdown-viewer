#!/usr/bin/env bash
# mkfixtures.sh - create the generated (untracked) test fixtures.
#
# Git symlinks are unreliable across platforms and a ~6 MiB file is wasteful to
# commit, so these entries are created on demand under
# testdata/fixtures/generated/ (ignored by Git):
#
#   link-inside.md       symlink -> ../docs/guide.md (stays inside the root)
#   link-dir             symlink -> ../docs (directory inside the root)
#   link-escape          symlink -> /etc (escapes the root)
#   link-escape-file.md  symlink -> ../../../README.md (escapes the fixtures root)
#   link-dangling        symlink -> a target that does not exist
#   cafe<U+0301>.md      NFD-named file ("cafe" then combining acute U+0301, decomposed),
#                        so an NFC request for "caf<U+00E9>.md" must find it
#   large.md             ~6 MiB Markdown, above the 5 MiB MDV_MAX_FILE_BYTES default
#
# Usage:
#   testdata/mkfixtures.sh            create or refresh the entries (idempotent)
#   testdata/mkfixtures.sh --verify   check every entry exists with the right
#                                     type; exit non-zero otherwise
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gen="$here/fixtures/generated"
large_min=$((6 * 1024 * 1024))

# name:target pairs for the symlinks.
# NFD file name: "cafe" with a decomposed e (U+0065 U+0301), as UTF-8 bytes.
# Written with printf escapes so this script stays ASCII.
nfd_name="$(printf 'cafe\xcc\x81.md')"

links=(
  "link-inside.md:../docs/guide.md"
  "link-dir:../docs"
  "link-escape:/etc"
  "link-escape-file.md:../../../README.md"
  "link-dangling:does-not-exist-target"
)

make_nfd() {
  printf '# NFD fixture\n\nThis file name is stored decomposed (NFD).\n' >"$gen/$nfd_name"
}

make_large() {
  # Deterministic: fixed line repeated; no timestamps or randomness.
  local out="$gen/large.md" tmp
  tmp="$(mktemp "$gen/.large.XXXXXX")"
  {
    printf '# Large fixture\n\n'
    local i=0
    while [ $((i)) -lt 77000 ]; do
      printf 'Line %06d: The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit.\n\n' "$i"
      i=$((i + 1))
    done
  } >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$out"
}

create() {
  mkdir -p "$gen"
  local pair
  for pair in "${links[@]}"; do
    ln -sfn "${pair#*:}" "$gen/${pair%%:*}"
  done
  make_nfd
  local size=0
  if [ -f "$gen/large.md" ]; then
    size="$(wc -c <"$gen/large.md")"
  fi
  if [ "$size" -lt "$large_min" ]; then
    make_large
  fi
}

verify() {
  local rc=0 pair name target
  for pair in "${links[@]}"; do
    name="${pair%%:*}"
    target="${pair#*:}"
    if [ ! -L "$gen/$name" ]; then
      echo "verify: $name is not a symlink" >&2
      rc=1
    elif [ "$(readlink "$gen/$name")" != "$target" ]; then
      echo "verify: $name points to the wrong target" >&2
      rc=1
    fi
  done
  # Targets that must resolve (inside-root and escaping directory/file).
  for name in link-inside.md link-dir link-escape; do
    if [ ! -e "$gen/$name" ]; then
      echo "verify: $name does not resolve" >&2
      rc=1
    fi
  done
  if [ -e "$gen/link-dangling" ]; then
    echo "verify: link-dangling unexpectedly resolves" >&2
    rc=1
  fi
  if [ ! -f "$gen/$nfd_name" ] || [ -L "$gen/$nfd_name" ]; then
    echo "verify: NFD-named file is missing or not a regular file" >&2
    rc=1
  fi
  if [ ! -f "$gen/large.md" ] || [ -L "$gen/large.md" ]; then
    echo "verify: large.md is not a regular file" >&2
    rc=1
  elif [ "$(wc -c <"$gen/large.md")" -lt "$large_min" ]; then
    echo "verify: large.md is smaller than $large_min bytes" >&2
    rc=1
  fi
  return "$rc"
}

case "${1:-}" in
  "") create ;;
  --verify) verify ;;
  *)
    echo "usage: $0 [--verify]" >&2
    exit 2
    ;;
esac
