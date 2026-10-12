# Test Data

Inputs for automated tests. These are edge cases, not a demo (see `examples/` for that).

## Fixtures

`testdata/fixtures/` is committed. It holds Markdown with relative links, front matter,
duplicate headings, and unsafe inline HTML, plus Mermaid and D2 diagrams (valid and
invalid), images, text, binary, HTML, dot-files, and Unicode or spaced file names.
Markdownlint ignores it because the fixtures intentionally break rules.

## Generated

`testdata/fixtures/generated/` is created by `testdata/mkfixtures.sh` and ignored by Git.
It holds symlinks (inside the root, escaping it, and dangling), a file with an NFD (decomposed Unicode)
name, `cafe` plus U+0301 `.md`, for the NFC/NFD retry test, and a ~6 MiB `large.md` (plus `large.txt` and `large.d2`)
that exceeds the default `MDV_MAX_FILE_BYTES`.

Regenerate and verify with:

```sh
make fixtures
```

or run `testdata/mkfixtures.sh` and `testdata/mkfixtures.sh --verify` directly. The script is
idempotent. `make test-go` depends on `fixtures`.
