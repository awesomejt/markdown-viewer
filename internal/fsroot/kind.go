package fsroot

import (
	"path"
	"strings"
)

// FileKind is the coarse content class of a file name, as reported by
// /api/list and reused by the file-serving allowlist.
type FileKind string

// The file kinds.
const (
	FileKindMarkdown FileKind = "markdown"
	FileKindDiagram  FileKind = "diagram"
	FileKindImage    FileKind = "image"
	FileKindText     FileKind = "text"
	FileKindProject  FileKind = "project"
	FileKindOther    FileKind = "other"
)

var extKinds = map[string]FileKind{}

func init() {
	add := func(k FileKind, exts string) {
		for _, e := range strings.Fields(exts) {
			extKinds["."+e] = k
		}
	}
	add(FileKindMarkdown, "md markdown mdx")
	add(FileKindDiagram, "mmd mermaid d2")
	add(FileKindImage, "png jpg jpeg gif webp svg avif")
	// Known text/code extensions. HTML/XML family (html htm xhtml xml xsl
	// shtml) is deliberately absent: those are never served inline.
	add(FileKindText, "txt text log json jsonc json5 yaml yml toml ini cfg conf env properties "+
		"csv tsv rst adoc org tex bib diff patch "+
		"go mod sum py pyi rb rs js mjs cjs jsx ts tsx java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs "+
		"swift m php pl pm lua r jl dart ex exs erl hs ml clj sh bash zsh fish ps1 bat cmd "+
		"sql graphql gql proto css scss sass less vue svelte tf hcl nix cmake make dockerfile")
}

// KindForExt classifies a file extension, with or without the leading dot,
// case-insensitively. Unknown or empty extensions are [FileKindOther].
func KindForExt(ext string) FileKind {
	ext = strings.ToLower(ext)
	if ext != "" && ext[0] != '.' {
		ext = "." + ext
	}
	if k, ok := extKinds[ext]; ok {
		return k
	}
	return FileKindOther
}

// ClassifyName classifies a file name (or slash path) by its extension.
// A leading dot does not start an extension: ".hidden" is [FileKindOther].
// A base ending in ".mdv.yaml" or ".mdv.yml" (case-insensitive, so the exact
// dotfile names qualify) is a [FileKindProject], checked before the extension
// map so the plain ".yaml" text rule does not win. [KindForExt] is unchanged.
func ClassifyName(name string) FileKind {
	base := path.Base(name)
	if lb := strings.ToLower(base); strings.HasSuffix(lb, ".mdv.yaml") || strings.HasSuffix(lb, ".mdv.yml") {
		return FileKindProject
	}
	i := strings.LastIndexByte(base, '.')
	if i <= 0 {
		return FileKindOther
	}
	return KindForExt(base[i:])
}
