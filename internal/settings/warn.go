package settings

import (
	"unicode"
	"unicode/utf8"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// Warning codes. The list is the wire contract (Architecture.md, "Projects
// And Settings"); the resolution codes are produced by the project resolver.
const (
	CodeUnknownKey           = "unknown_key"
	CodeDuplicateKey         = "duplicate_key"
	CodeInvalidValue         = "invalid_value"
	CodeInvalidPath          = "invalid_path"
	CodeMissing              = "missing"
	CodeNotADir              = "not_a_dir"
	CodeNotAFile             = "not_a_file"
	CodeOutsideRoot          = "outside_root"
	CodeForbidden            = "forbidden"
	CodeCrossRootUnsupported = "cross_root_unsupported"
	CodeUnavailable          = "unavailable"
	CodeTooManyIncludes      = "too_many_includes"
	CodeWarningsTruncated    = "warnings_truncated"
)

// Limits on echoed text.
const (
	// MaxWarnings is the longest warning list before truncation.
	MaxWarnings = 100
	// MaxMessageRunes caps every message sent to a client.
	MaxMessageRunes = 200
	// MaxRefRunes caps the echoed reference text of a warning.
	MaxRefRunes = 80
	// maxKeyRunes caps the echoed key path of a warning.
	maxKeyRunes = 80
)

// Warning is a non-fatal problem. Key is a dotted path such as
// "settings.fontSize" or "include[2]"; Line is the 1-based YAML line.
type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Key     string `json:"key,omitempty"`
	Ref     string `json:"ref,omitempty"`
	Line    int    `json:"line,omitempty"`
}

// NewWarning builds a Warning with all text bounded and sanitized: the
// message to 200 runes, key and ref to 80 runes, controls replaced by "?".
func NewWarning(code, msg, key, ref string, line int) Warning {
	if line < 0 {
		line = 0
	}
	return Warning{
		Code:    code,
		Message: Sanitize(msg, MaxMessageRunes),
		Key:     Sanitize(key, maxKeyRunes),
		Ref:     Sanitize(ref, MaxRefRunes),
		Line:    line,
	}
}

// CapWarnings limits ws to [MaxWarnings] items followed by one final
// warnings_truncated marker. It is idempotent and safe to call again after
// more warnings were appended.
func CapWarnings(ws []Warning) []Warning {
	if len(ws) <= MaxWarnings {
		return ws
	}
	out := make([]Warning, MaxWarnings, MaxWarnings+1)
	copy(out, ws[:MaxWarnings])
	return append(out, NewWarning(CodeWarningsTruncated, "further warnings were omitted", "", "", 0))
}

// isInvisible reports controls (the fsroot rule) plus characters that render
// as nothing or break lines: Unicode format characters (which include U+061C
// and U+FEFF), U+2028 and U+2029. ZWNJ and ZWJ (U+200C/D) are kept because
// emoji sequences and Persian/Indic text need them. fsroot.IsControl itself
// is unchanged because it gates path resolution.
func isInvisible(r rune) bool {
	if r == 0x200c || r == 0x200d {
		return false
	}
	return fsroot.IsControl(r) || r == 0x2028 || r == 0x2029 || unicode.Is(unicode.Cf, r)
}

// Sanitize returns s cut to limit runes, with control and bidi characters and
// invalid UTF-8 replaced by "?".
func Sanitize(s string, limit int) string {
	out := make([]rune, 0, min(len(s), limit))
	for _, r := range s {
		if len(out) >= limit {
			break
		}
		if r == utf8.RuneError || isInvisible(r) {
			r = '?'
		}
		out = append(out, r)
	}
	return string(out)
}
