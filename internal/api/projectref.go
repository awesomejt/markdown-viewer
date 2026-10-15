package api

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/settings"
)

// crossRootRE matches the text before the first ":" of a cross-root
// reference. It mirrors the root-name pattern, so a one-letter "c:" is
// cross-root syntax; there is no drive-letter rule.
var crossRootRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// refResult is the lexical outcome for one reference.
type refResult struct {
	path    string // root-relative wire path; "" is the root
	dirHint bool   // the reference ended in "/"
	code    string // non-empty: rejected without touching the filesystem
	reason  string // static explanation for invalid_path
	dup     bool   // resolved path already included earlier (set by the caller)
}

// resolveRef applies the lexical reference rules of the project file: dir is
// the project file's folder ("" at the root). It never touches the
// filesystem. Note: a drive-letter-looking ref such as "C:foo" is local; in a
// project in a subfolder it joins to "sub/C:foo" and is stat'ed as an
// ordinary name (os.Root still applies), whereas at the root fsroot.Resolve
// rejects it, giving invalid_path.
func resolveRef(dir, ref string) refResult {
	if i := strings.IndexByte(ref, ':'); i > 0 && crossRootRE.MatchString(ref[:i]) {
		return refResult{code: settings.CodeCrossRootUnsupported}
	}
	bad := func(reason string) refResult {
		return refResult{code: settings.CodeInvalidPath, reason: reason}
	}
	switch {
	case !utf8.ValidString(ref) || strings.ContainsFunc(ref, fsroot.IsControl):
		return bad("contains control characters")
	case strings.HasPrefix(ref, "/"):
		return bad("must be relative to the project folder")
	case strings.Contains(ref, `\`):
		return bad("must use / separators")
	}
	seenName := false
	for seg := range strings.SplitSeq(ref, "/") {
		switch seg {
		case "", ".":
		case "..":
			if seenName {
				return bad("may only start with ../ segments")
			}
		default:
			seenName = true
		}
	}
	p := path.Join(dir, ref)
	if p == ".." || strings.HasPrefix(p, "../") {
		return refResult{code: settings.CodeOutsideRoot}
	}
	if p == "." {
		p = ""
	}
	return refResult{path: p, dirHint: strings.HasSuffix(ref, "/")}
}

// warnCode is the total mapping from a filesystem error to a warning code.
func warnCode(err error) string {
	var pe *fsroot.PathError
	if !errors.As(err, &pe) {
		return settings.CodeUnavailable
	}
	switch pe.Kind {
	case fsroot.KindBadRequest:
		return settings.CodeInvalidPath
	case fsroot.KindForbidden:
		if errors.Is(err, fs.ErrPermission) {
			return settings.CodeForbidden
		}
		return settings.CodeOutsideRoot
	case fsroot.KindNotFound:
		return settings.CodeMissing
	default: // KindTimeout, KindInternal and anything unknown
		return settings.CodeUnavailable
	}
}

// refMessage is the fixed text for a code, with the (bounded) reference
// echoed where it helps. It never contains host paths.
func refMessage(code, ref, reason string) string {
	r := settings.Sanitize(ref, settings.MaxRefRunes)
	switch code {
	case settings.CodeInvalidPath:
		if reason == "" {
			reason = "is not a valid path"
		}
		return reason
	case settings.CodeMissing:
		return r + " was not found"
	case settings.CodeForbidden:
		return r + " is not accessible (permission denied)"
	case settings.CodeOutsideRoot:
		return r + " is outside the root"
	case settings.CodeNotADir:
		return r + " is a file, not a folder"
	case settings.CodeNotAFile:
		return "open must be a Markdown, diagram or text file"
	case settings.CodeCrossRootUnsupported:
		return "references to other roots are not supported yet"
	default:
		return fmt.Sprintf("%s could not be checked (filesystem unavailable)", r)
	}
}
