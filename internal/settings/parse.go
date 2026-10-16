package settings

import (
	"bytes"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"
)

// testHook runs inside the guarded region of every parse; tests use it to
// inject a panic.
var testHook func()

// walkHook is like testHook but runs inside the guarded schema walk.
var walkHook func()

var (
	syntaxLineRE = regexp.MustCompile(`^yaml: line ([0-9]{1,9}): `)
	namePatRE    = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	// YAML 1.2 core forms. The library also reads 024 as octal and accepts
	// 2_4, 0b1, 0o1 and 0x1; those are refused. Integers are decimal only.
	intRE   = regexp.MustCompile(`^[-+]?(0|[1-9][0-9]*)$`)
	floatRE = regexp.MustCompile(`^[-+]?(\.[0-9]+|(0|[1-9][0-9]*)(\.[0-9]*)?)([eE][-+]?[0-9]+)?$`)
)

const (
	msgUnparsable = "could not parse the file"
	msgNonString  = "(non-string key)"
)

// ParseProject parses a project file. A non-nil error is a *ParseError and
// means the project must not be applied.
func ParseProject(b []byte) (p *Project, warns []Warning, err error) {
	root, perr := load(b)
	if perr != nil {
		return nil, nil, perr
	}
	if root == nil {
		return nil, nil, &ParseError{Msg: "file is empty"}
	}
	defer func() {
		if r := recover(); r != nil {
			p, warns, err = nil, nil, &ParseError{Msg: msgUnparsable}
		}
	}()
	if walkHook != nil {
		walkHook()
	}
	w := newWalker(b)
	p = &Project{}
	var ver *yaml.Node
	var fatal *ParseError
	w.mapping(root, "", map[string]handler{
		"version": func(_, v *yaml.Node, _ string) { ver = v },
		"name": func(_, v *yaml.Node, key string) {
			if s, ok := w.name(v, key); ok {
				p.Name = &s
			}
		},
		"open": func(_, v *yaml.Node, key string) {
			if r, ok := w.ref(v, key); ok {
				p.Open = &r
			}
		},
		"include": func(_, v *yaml.Node, key string) { p.Include = w.include(v, key) },
		"settings": func(_, v *yaml.Node, key string) {
			p.Settings = w.settings(v, key)
		},
	}, "unknown key")
	if ver == nil {
		fatal = &ParseError{Msg: "version is required and must be 1"}
	} else if !isInt(ver, 1) {
		fatal = &ParseError{Line: ver.Line, Msg: "version must be the integer 1"}
	}
	if fatal != nil {
		fatal.Line = clampLine(fatal.Line, b)
		return nil, nil, fatal
	}
	return p, CapWarnings(w.warns), nil
}

// ParsePrefs parses a preferences file. An empty or comment-only file is
// valid and yields no settings.
func ParsePrefs(b []byte) (p *Prefs, warns []Warning, err error) {
	root, perr := load(b)
	if perr != nil {
		return nil, nil, perr
	}
	p = &Prefs{}
	if root == nil {
		return p, nil, nil
	}
	defer func() {
		if r := recover(); r != nil {
			p, warns, err = nil, nil, &ParseError{Msg: msgUnparsable}
		}
	}()
	if walkHook != nil {
		walkHook()
	}
	w := newWalker(b)
	var fatal *ParseError
	w.mapping(root, "", map[string]handler{
		"version": func(_, v *yaml.Node, _ string) {
			if !isInt(v, 1) {
				fatal = &ParseError{Line: clampLine(v.Line, b), Msg: "version must be the integer 1"}
			}
		},
		"settings": func(_, v *yaml.Node, key string) {
			p.Settings = w.settings(v, key)
		},
	}, "not allowed in preferences")
	if fatal != nil {
		return nil, nil, fatal
	}
	return p, CapWarnings(w.warns), nil
}

// load runs the guarded decode and pre-check. It returns the top-level node,
// nil for an empty document, or a *ParseError. All panics are recovered.
func load(b []byte) (root *yaml.Node, perr *ParseError) {
	defer func() {
		if r := recover(); r != nil {
			root, perr = nil, &ParseError{Msg: msgUnparsable}
		}
	}()
	if len(b) > MaxFileSize {
		return nil, &ParseError{Msg: "file is too large (limit 32 KiB)"}
	}
	if testHook != nil {
		testHook()
	}
	// Bytes only: a reader is never given to the decoder, because library
	// errors embed reader errors (which may carry host paths).
	dec := yaml.NewDecoder(bytes.NewReader(b))
	var doc yaml.Node
	if err := dec.Decode(&doc); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		return nil, syntaxError(err, b)
	}
	var next yaml.Node
	if err := dec.Decode(&next); !errors.Is(err, io.EOF) {
		return nil, &ParseError{Msg: "multiple documents are not allowed"}
	}
	top := &doc
	if top.Kind == yaml.DocumentNode {
		if len(top.Content) == 0 {
			return nil, nil
		}
		top = top.Content[0]
	}
	count := 0
	if msg, line := precheck(top, 1, &count); msg != "" {
		return nil, &ParseError{Line: clampLine(line, b), Msg: msg}
	}
	if top.Kind == yaml.ScalarNode && top.ShortTag() == "!!null" {
		return nil, nil
	}
	if top.Kind != yaml.MappingNode {
		return nil, &ParseError{Line: clampLine(top.Line, b), Msg: "the top level must be a mapping"}
	}
	return top, nil
}

// precheck refuses hostile constructs. It returns a message and the line of
// the offending node, or "" if the tree is acceptable. Recursion is bounded by
// MaxDepth.
//
// Known gap, accepted: the non-specific tag "!" (for example "fontSize: ! 18")
// is discarded by the library and is not visible as TaggedStyle, so it passes
// as an untagged scalar. It is harmless (no type change, no resolver); a test
// pins the behaviour so a library change is noticed.
func precheck(n *yaml.Node, depth int, count *int) (string, int) {
	*count++
	switch {
	case *count > MaxNodes:
		return "the file has too many nodes", n.Line
	case depth > MaxDepth:
		return "the file is nested too deeply", n.Line
	case n.Kind == yaml.AliasNode || n.Anchor != "":
		return "aliases and anchors are not allowed", n.Line
	case n.Style&yaml.TaggedStyle != 0:
		return "explicit tags are not allowed", n.Line
	}
	if n.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Kind == yaml.ScalarNode && k.Style&yaml.TaggedStyle == 0 && k.ShortTag() == "!!merge" {
				return "merge keys are not allowed", k.Line
			}
		}
	}
	for _, c := range n.Content {
		if msg, line := precheck(c, depth+1, count); msg != "" {
			return msg, line
		}
	}
	return "", 0
}

// Problem texts of go.yaml.in/yaml/v3 v3.0.4 by error class. (*parser).fail
// builds "line N: " from the 0-based context mark (else the problem mark),
// adds 1 only for scanner errors, and omits the prefix when that line is 0.
// So parser errors report one line too low, and a scanner or parser error
// without a prefix happened on line 1. TestLibraryErrorLineBehavior guards this.
var (
	parserProblems = map[string]bool{
		"did not find expected <stream-start>":   true,
		"did not find expected <document start>": true,
		"found undefined tag handle":             true,
		"did not find expected node content":     true,
		"did not find expected '-' indicator":    true,
		"did not find expected key":              true,
		"did not find expected ',' or ']'":       true,
		"did not find expected ',' or '}'":       true,
		"found duplicate %YAML directive":        true,
		"found incompatible YAML document":       true,
		"found duplicate %TAG directive":         true,
	}
	scannerProblems = map[string]bool{
		"found character that cannot start any token":                  true,
		"could not find expected ':'":                                  true,
		"block sequence entries are not allowed in this context":       true,
		"mapping keys are not allowed in this context":                 true,
		"mapping values are not allowed in this context":               true,
		"found unknown directive name":                                 true,
		"did not find expected comment or line break":                  true,
		"could not find expected directive name":                       true,
		"found unexpected non-alphabetical character":                  true,
		"did not find expected digit or '.' character":                 true,
		"found extremely long version number":                          true,
		"did not find expected version number":                         true,
		"did not find expected whitespace":                             true,
		"did not find expected whitespace or line break":               true,
		"did not find expected alphabetic or numeric character":        true,
		"did not find the expected '>'":                                true,
		"found an indentation indicator equal to 0":                    true,
		"found a tab character where an indentation space is expected": true,
		"found unexpected document indicator":                          true,
		"found unexpected end of stream":                               true,
		"found unknown escape character":                               true,
		"did not find expected hexdecimal number":                      true,
		"found invalid Unicode character escape code":                  true,
		"found a tab character that violates indentation":              true,
		"did not find expected '!'":                                    true,
		"did not find expected tag URI":                                true,
		"did not find URI escaped octet":                               true,
		"found an incorrect leading UTF-8 octet":                       true,
		"found an incorrect trailing UTF-8 octet":                      true,
	}
)

// syntaxError converts a library error into a bounded, sanitized ParseError.
func syntaxError(err error, b []byte) *ParseError {
	msg := err.Error()
	line := 0
	if m := syntaxLineRE.FindStringSubmatch(msg); m != nil {
		line, _ = strconv.Atoi(m[1])
		msg = "yaml: " + msg[len(m[0]):]
	}
	msg = strings.TrimPrefix(msg, "yaml: ")
	switch {
	case parserProblems[msg] && line > 0:
		line++ // the library reports parser errors one line too low
	case line == 0 && (parserProblems[msg] || scannerProblems[msg] ||
		strings.HasPrefix(msg, "exceeded max depth of ")):
		line = 1 // no prefix means the mark was on line 1
	}
	return &ParseError{Line: clampLine(line, b), Msg: Sanitize(msg, MaxMessageRunes)}
}

// clampLine maps line into [1, lines in b]; 0 stays 0 (absent).
func clampLine(line int, b []byte) int {
	return clampTo(line, lineCount(b))
}

func clampTo(line, lines int) int {
	if line <= 0 {
		return 0
	}
	return min(line, lines)
}

// lineCount counts lines with the library's break rules: \r\n, \r, \n, NEL
// (U+0085), LS (U+2028) and PS (U+2029).
func lineCount(b []byte) int {
	n := 1
	for i := 0; i < len(b); i++ {
		switch c := b[i]; {
		case c == '\n', c == '\r' && (i+1 == len(b) || b[i+1] != '\n'):
			n++
		case c == 0xC2 && i+1 < len(b) && b[i+1] == 0x85:
			n++
			i++
		case c == 0xE2 && i+2 < len(b) && b[i+1] == 0x80 && (b[i+2] == 0xA8 || b[i+2] == 0xA9):
			n++
			i += 2
		}
	}
	return n
}

// ---- walk ----

type handler func(k, v *yaml.Node, key string)

type walker struct {
	warns []Warning
	lines int // line count of the input; warning lines are clamped to it
}

func newWalker(b []byte) *walker { return &walker{lines: lineCount(b)} }

func (w *walker) warn(code, msg, key, ref string, line int) {
	w.warns = append(w.warns, NewWarning(code, msg, key, ref, clampTo(line, w.lines)))
}

func (w *walker) invalid(key, msg string, n *yaml.Node) {
	w.warn(CodeInvalidValue, msg, key, "", n.Line)
}

func isNull(n *yaml.Node) bool {
	return n.Kind == yaml.ScalarNode && n.ShortTag() == "!!null"
}

// mapping walks the pairs of mapping n. Handlers receive non-null values of
// known keys; null means unset. The first of a repeated key wins.
func (w *walker) mapping(n *yaml.Node, prefix string, hs map[string]handler, unknownMsg string) {
	seen := map[string]bool{}
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, v := n.Content[i], n.Content[i+1]
		if k.Kind != yaml.ScalarNode || k.ShortTag() != "!!str" {
			w.warn(CodeUnknownKey, unknownMsg, prefix+msgNonString, "", k.Line)
			continue
		}
		key := prefix + k.Value
		h, ok := hs[k.Value]
		if !ok {
			w.warn(CodeUnknownKey, unknownMsg, key, "", k.Line)
			continue
		}
		if seen[k.Value] {
			w.warn(CodeDuplicateKey, "key is repeated; the first value is used", key, "", k.Line)
			continue
		}
		seen[k.Value] = true
		if isNull(v) {
			continue
		}
		h(k, v, key)
	}
}

func isInt(n *yaml.Node, want int) bool {
	return n.Kind == yaml.ScalarNode && n.ShortTag() == "!!int" && n.Value == strconv.Itoa(want)
}

func (w *walker) settings(n *yaml.Node, key string) Settings {
	var s Settings
	if n.Kind != yaml.MappingNode {
		w.invalid(key, "must be a mapping", n)
		return s
	}
	themes := []string{"system", "light", "dark"}
	widths := []string{"narrow", "normal", "wide", "full"}
	sorts := []string{"name", "date"}
	w.mapping(n, key+".", map[string]handler{
		"theme":        func(_, v *yaml.Node, k string) { s.Theme = w.enum(v, k, themes) },
		"style":        func(_, v *yaml.Node, k string) { s.Style = w.pattern(v, k) },
		"font":         func(_, v *yaml.Node, k string) { s.Font = w.pattern(v, k) },
		"codeFont":     func(_, v *yaml.Node, k string) { s.CodeFont = w.pattern(v, k) },
		"fontSize":     func(_, v *yaml.Node, k string) { s.FontSize = w.number(v, k, 12, 32) },
		"lineHeight":   func(_, v *yaml.Node, k string) { s.LineHeight = w.number(v, k, 1.0, 2.5) },
		"contentWidth": func(_, v *yaml.Node, k string) { s.ContentWidth = w.enum(v, k, widths) },
		"markdownOnly": func(_, v *yaml.Node, k string) { s.MarkdownOnly = w.boolean(v, k) },
		"showHidden":   func(_, v *yaml.Node, k string) { s.ShowHidden = w.boolean(v, k) },
		"sort":         func(_, v *yaml.Node, k string) { s.Sort = w.enum(v, k, sorts) },
		"readTime":     func(_, v *yaml.Node, k string) { s.ReadTime = w.readTime(v, k) },
	}, "unknown key")
	return s
}

func (w *walker) readTime(n *yaml.Node, key string) *ReadTime {
	if n.Kind != yaml.MappingNode {
		w.invalid(key, "must be a mapping", n)
		return nil
	}
	var rt ReadTime
	w.mapping(n, key+".", map[string]handler{
		"wpm":             func(_, v *yaml.Node, k string) { rt.WPM = w.integer(v, k, 60, 600) },
		"includeHeadings": func(_, v *yaml.Node, k string) { rt.IncludeHeadings = w.boolean(v, k) },
		"includeCode":     func(_, v *yaml.Node, k string) { rt.IncludeCode = w.boolean(v, k) },
	}, "unknown key")
	if rt == (ReadTime{}) {
		return nil
	}
	return &rt
}

// scalarString returns the text of a plain string scalar.
func scalarString(n *yaml.Node) (string, bool) {
	if n.Kind != yaml.ScalarNode || n.ShortTag() != "!!str" {
		return "", false
	}
	return n.Value, true
}

func (w *walker) enum(n *yaml.Node, key string, allowed []string) *string {
	if s, ok := scalarString(n); ok {
		for _, a := range allowed {
			if s == a {
				return &s
			}
		}
	}
	w.invalid(key, "must be one of: "+strings.Join(allowed, ", "), n)
	return nil
}

func (w *walker) pattern(n *yaml.Node, key string) *string {
	if s, ok := scalarString(n); ok && namePatRE.MatchString(s) {
		return &s
	}
	w.invalid(key, "must be a lowercase name such as \"serif\" (letters, digits, hyphens; up to 32)", n)
	return nil
}

func (w *walker) boolean(n *yaml.Node, key string) *bool {
	if n.Kind == yaml.ScalarNode && n.ShortTag() == "!!bool" {
		var b bool
		if n.Decode(&b) == nil {
			return &b
		}
	}
	w.invalid(key, "must be true or false", n)
	return nil
}

func (w *walker) number(n *yaml.Node, key string, lo, hi float64) *float64 {
	if n.Kind == yaml.ScalarNode && (n.ShortTag() == "!!int" && intRE.MatchString(n.Value) ||
		n.ShortTag() == "!!float" && floatRE.MatchString(n.Value)) {
		var f float64
		// NaN and Inf fail both comparisons below.
		if n.Decode(&f) == nil && f >= lo && f <= hi {
			return &f
		}
	}
	w.invalid(key, "must be a number from "+strconv.FormatFloat(lo, 'f', -1, 64)+" to "+strconv.FormatFloat(hi, 'f', -1, 64), n)
	return nil
}

func (w *walker) integer(n *yaml.Node, key string, lo, hi int) *int {
	if n.Kind == yaml.ScalarNode && n.ShortTag() == "!!int" && intRE.MatchString(n.Value) {
		var i int
		if n.Decode(&i) == nil && i >= lo && i <= hi {
			return &i
		}
	}
	w.invalid(key, "must be an integer from "+strconv.Itoa(lo)+" to "+strconv.Itoa(hi), n)
	return nil
}

func (w *walker) name(n *yaml.Node, key string) (string, bool) {
	if s, ok := scalarString(n); ok {
		s = strings.TrimSpace(s)
		if r := utf8.RuneCountInString(s); r >= 1 && r <= 100 && utf8.ValidString(s) &&
			!strings.ContainsFunc(s, isInvisible) {
			return s, true
		}
	}
	w.invalid(key, "must be 1 to 100 characters without control characters", n)
	return "", false
}

// ref applies the walk-level checks to one reference: a non-empty string
// scalar of at most MaxRefBytes. Lexical path rules are the caller's job.
func (w *walker) ref(n *yaml.Node, key string) (Ref, bool) {
	s, ok := scalarString(n)
	switch {
	case !ok:
		w.warn(CodeInvalidPath, "must be a path string (quote numbers and booleans)", key, "", n.Line)
	case s == "":
		w.warn(CodeInvalidPath, "must not be empty", key, "", n.Line)
	case len(s) > MaxRefBytes:
		w.warn(CodeInvalidPath, "is longer than 1024 bytes", key, s, n.Line)
	default:
		return Ref{Text: s, Key: key, Line: n.Line}, true
	}
	return Ref{}, false
}

func (w *walker) include(n *yaml.Node, key string) []Ref {
	if n.Kind != yaml.SequenceNode {
		w.invalid(key, "must be a list", n)
		return nil
	}
	var out []Ref
	for i, item := range n.Content {
		if i >= MaxIncludes {
			w.warn(CodeTooManyIncludes, "only the first 200 include items are used", key, "", item.Line)
			break
		}
		if r, ok := w.ref(item, key+"["+strconv.Itoa(i)+"]"); ok {
			out = append(out, r)
		}
	}
	return out
}
