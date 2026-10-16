package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"go.yaml.in/yaml/v3"
)

func mustProject(t *testing.T, src string) (*Project, []Warning) {
	t.Helper()
	p, w, err := ParseProject([]byte(src))
	if err != nil {
		t.Fatalf("ParseProject(%q) error: %v", src, err)
	}
	return p, w
}

func mustPrefs(t *testing.T, src string) (*Prefs, []Warning) {
	t.Helper()
	p, w, err := ParsePrefs([]byte(src))
	if err != nil {
		t.Fatalf("ParsePrefs(%q) error: %v", src, err)
	}
	return p, w
}

func asParseError(t *testing.T, err error) *ParseError {
	t.Helper()
	var pe *ParseError
	if !errors.As(err, &pe) {
		t.Fatalf("want *ParseError, got %v", err)
	}
	return pe
}

func hasWarn(ws []Warning, code, key string, line int) bool {
	for _, w := range ws {
		if w.Code == code && w.Key == key && (line == 0 || w.Line == line) {
			return true
		}
	}
	return false
}

func checkBounded(t *testing.T, ws []Warning) {
	t.Helper()
	if len(ws) > MaxWarnings+1 {
		t.Fatalf("%d warnings", len(ws))
	}
	for _, w := range ws {
		for _, s := range []string{w.Message, w.Key, w.Ref} {
			checkText(t, s, MaxMessageRunes)
		}
	}
}

func checkText(t *testing.T, s string, limit int) {
	t.Helper()
	if utf8.RuneCountInString(s) > limit || !utf8.ValidString(s) {
		t.Fatalf("text not bounded/valid: %q", s)
	}
	for _, r := range s {
		if fsroot.IsControl(r) {
			t.Fatalf("control %U in %q", r, s)
		}
	}
}

func TestHostileInputIsFatal(t *testing.T) {
	var many strings.Builder
	many.WriteString("version: 1\ninclude:\n")
	for range 1996 { // 5 fixed nodes + 1996 items = 2001 nodes
		many.WriteString("- a\n")
	}
	laughs := "version: 1\na: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n"
	cases := map[string]string{
		"alias":            "version: 1\na: &x 1\nb: *x\n",
		"anchor only":      "version: 1\na: &x 1\n",
		"tag str":          "version: 1\nname: !!str x\n",
		"tag custom":       "version: 1\nname: !foo x\n",
		"merge key":        "version: 1\n<<: {a: 1}\n",
		"depth 9":          "version: 1\nsettings:\n  a:\n    b:\n      c:\n        d:\n          e:\n            f:\n              g:\n                h: 1\n",
		"nodes over limit": many.String(),
		"two documents":    "version: 1\n---\nversion: 1\n",
		"oversize":         "version: 1\n# " + strings.Repeat("x", MaxFileSize) + "\n",
		"billion laughs":   laughs,
		"top-level list":   "- a\n- b\n",
		"top-level text":   "hello\n",
	}
	for name, src := range cases {
		for pname, parse := range map[string]func([]byte) error{
			"project": func(b []byte) error { _, _, err := ParseProject(b); return err },
			"prefs":   func(b []byte) error { _, _, err := ParsePrefs(b); return err },
		} {
			t.Run(name+"/"+pname, func(t *testing.T) {
				pe := asParseError(t, parse([]byte(src)))
				if pe.Msg == "" {
					t.Fatal("empty message")
				}
				if pe.Line < 0 || pe.Line > lineCount([]byte(src)) {
					t.Fatalf("line %d out of range", pe.Line)
				}
				checkText(t, pe.Msg, MaxMessageRunes)
			})
		}
	}
}

// nestedMaps returns a flow document of k nested mappings (the top mapping is
// depth 1) whose innermost value is a scalar at depth k+1.
func nestedMaps(k int) string {
	return strings.Repeat("{a: ", k) + "1" + strings.Repeat("}", k)
}

// seqDoc returns a top mapping with one key holding a sequence of n scalars:
// 1 (mapping) + 1 (key) + 1 (sequence) + n nodes.
func seqDoc(n int) string {
	return "a: [" + strings.Repeat("1,", n-1) + "1]\n"
}

func TestDepthBoundary(t *testing.T) {
	// 7 nested mappings put the scalar at depth 8: accepted. 8 mappings put
	// it at depth 9: rejected.
	if _, perr := load([]byte(nestedMaps(7))); perr != nil {
		t.Fatalf("depth 8 rejected: %v", perr)
	}
	perr := loadErr(t, nestedMaps(8))
	if !strings.Contains(perr.Msg, "nested too deeply") {
		t.Errorf("msg %q", perr.Msg)
	}
	// the same limit through the public parsers
	src := "version: 1\nsettings: " + nestedMaps(6) + "\n" // scalar at depth 8
	if _, _, err := ParseProject([]byte(src)); err != nil {
		t.Errorf("public depth 8: %v", err)
	}
	src = "version: 1\nsettings: " + nestedMaps(7) + "\n" // depth 9
	_ = asParseError(t, func() error { _, _, err := ParseProject([]byte(src)); return err }())
}

func loadErr(t *testing.T, src string) *ParseError {
	t.Helper()
	_, perr := load([]byte(src))
	if perr == nil {
		t.Fatalf("accepted %.60q", src)
	}
	return perr
}

func TestNodeBoundary(t *testing.T) {
	if _, perr := load([]byte(seqDoc(1997))); perr != nil {
		t.Fatalf("exactly 2000 nodes rejected: %v", perr)
	}
	perr := loadErr(t, seqDoc(1998))
	if !strings.Contains(perr.Msg, "too many nodes") {
		t.Errorf("msg %q", perr.Msg)
	}
}

func TestPrecheckLine(t *testing.T) {
	for _, c := range []struct {
		src  string
		line int
	}{
		{"version: 1\n\n\n\n\n\na: &x 1\n", 7},
		{"version: 1\n\n\nname: !!str x\n", 4},
		{"version: 1\n\n<<: {a: 1}\n", 3},
		{"version: 1\nb: &y 1\nc: *y\n", 2},
	} {
		if pe := loadErr(t, c.src); pe.Line != c.line {
			t.Errorf("%q: line %d, want %d (%s)", c.src, pe.Line, c.line, pe.Msg)
		}
	}
}

func TestNonSpecificTagPassesPrecheck(t *testing.T) {
	// Pins a known gap: the library discards the bare "!" tag, so it cannot
	// be refused. If this starts failing the library changed; revisit.
	p, w := mustProject(t, "version: 1\nsettings: {fontSize: ! 18}\n")
	if p.Settings.FontSize == nil || *p.Settings.FontSize != 18 || len(w) != 0 {
		t.Errorf("got %v %v", p.Settings.FontSize, w)
	}
}

func TestYAML12Numbers(t *testing.T) {
	bad := []string{"024", "0310", "2_4", "+1x", "0b1", "0o1", "0x1", "1_", "01", "00", "1__0"}
	for _, v := range bad {
		p, w := mustProject(t, "version: 1\nsettings: {fontSize: "+v+", readTime: {wpm: "+v+"}}\n")
		if p.Settings.FontSize != nil || p.Settings.ReadTime != nil || len(w) != 2 {
			t.Errorf("%s accepted: %+v %v", v, p.Settings, w)
		}
		if v != "+1x" {
			_, _, err := ParseProject([]byte("version: " + v + "\n"))
			_ = asParseError(t, err)
		}
	}
	for _, v := range []string{"+1", "2_4"} {
		_, _, err := ParseProject([]byte("version: " + v + "\n"))
		_ = asParseError(t, err)
		_, _, err = ParsePrefs([]byte("version: " + v + "\n"))
		_ = asParseError(t, err)
	}
	for _, v := range []string{"+20", "20", "1.5e1", "20.", "+16.0", "2e1", "2.5E1"} {
		p, w := mustProject(t, "version: 1\nsettings: {fontSize: "+v+"}\n")
		if p.Settings.FontSize == nil || len(w) != 0 {
			t.Errorf("%s rejected: %v", v, w)
		}
	}
	if p, _ := mustProject(t, "version: 1\nsettings: {fontSize: 20.}\n"); p.Settings.FontSize == nil || *p.Settings.FontSize != 20 {
		t.Error("20.")
	}
	if p, _ := mustProject(t, "version: 1\nsettings: {fontSize: 1.5e1}\n"); p.Settings.FontSize == nil || *p.Settings.FontSize != 15 {
		t.Error("1.5e1")
	}
	// decimal-looking inputs still work, including octal-lookalike lineHeight
	if p, w := mustProject(t, "version: 1\nsettings: {readTime: {wpm: 310}}\n"); p.Settings.ReadTime == nil || *p.Settings.ReadTime.WPM != 310 || len(w) != 0 {
		t.Error("310")
	}
	if p, _ := mustProject(t, "version: 1\nsettings: {lineHeight: 01.5}\n"); p.Settings.LineHeight != nil {
		t.Error("01.5 accepted")
	}
}

func TestInvisibleCharactersAreSanitized(t *testing.T) {
	for _, r := range []rune{0x061c, 0x2028, 0x2029, 0xfeff, 0x200b, 0x00ad, 0x0007} {
		if got := Sanitize("a"+string(r)+"b", 10); got != "a?b" {
			t.Errorf("%U not sanitized: %q", r, got)
		}
		doc := "version: 1\nname: \"a\\u" + fmt.Sprintf("%04X", r) + "b\"\n"
		p, w := mustProject(t, doc)
		if p.Name != nil || len(w) != 1 || w[0].Code != CodeInvalidValue {
			t.Errorf("name with %U accepted: %v %v", r, p.Name, w)
		}
	}
	if Sanitize("héllo wörld 日本", 40) != "héllo wörld 日本" {
		t.Error("ordinary text changed")
	}
	// ZWNJ and ZWJ are kept: emoji sequences and Persian/Indic text need them.
	for _, s := range []string{"👩\u200d💻 notes", "می\u200cخواهم"} {
		if Sanitize(s, 40) != s {
			t.Errorf("joiner removed from %q", s)
		}
		p, w := mustProject(t, "version: 1\nname: \""+s+"\"\n")
		if p.Name == nil || *p.Name != s || len(w) != 0 {
			t.Errorf("name %q rejected: %v", s, w)
		}
	}
	// fsroot's own predicate must not have grown these (it gates Resolve).
	if fsroot.IsControl(0x2028) || fsroot.IsControl(0xfeff) {
		t.Error("fsroot.IsControl changed")
	}
}

func TestLineCountMatchesLibraryBreaks(t *testing.T) {
	src := "version: 1\nname: \"a\u2028b\"\nzz: 1\n"
	_, w := mustProject(t, src)
	if !hasWarn(w, CodeUnknownKey, "zz", 4) {
		t.Fatalf("library line assumption changed: %v", w)
	}
	if n := lineCount([]byte(src)); n != 5 {
		t.Errorf("lineCount = %d", n)
	}
	for in, want := range map[string]int{
		"": 1, "a\nb": 2, "a\r\nb": 2, "a\rb": 2, "a\r": 2, "a\u0085b": 2, "a\u2028b\u2029c": 3, "a\xc2": 1, "a\xe2\x80": 1,
	} {
		if got := lineCount([]byte(in)); got != want {
			t.Errorf("lineCount(%q) = %d, want %d", in, got, want)
		}
	}
	// warning lines are clamped to the input
	w2 := newWalker([]byte("a\nb"))
	w2.warn(CodeMissing, "m", "", "", 99)
	if w2.warns[0].Line != 2 {
		t.Errorf("warning line %d", w2.warns[0].Line)
	}
}

func TestSyntaxErrorLines(t *testing.T) {
	cases := []struct {
		name string
		src  string
		line int // 0 = must be absent; -1 = just in range
	}{
		{"scanner error line 3", "version: 1\nname: ok\nfoo: \"unterminated\n", 3},
		{"scanner mapping value", "version: 1\nname: a: b\n", 2},
		// Scanner class: "found character that cannot start any token".
		{"scanner line 1", "@a\n", 1},
		{"scanner line 2", "a: 1\n@a\n", 2},
		{"scanner line 5", "a: 1\nb: 1\nc: 1\nd: 1\n@a\n", 5},
		// Parser class: "did not find expected key" (library says 1 and 4).
		{"parser line 2", "a: 1\n- b\n", 2},
		{"parser line 5", "a: 1\nb: 1\nc: 1\nd: 1\n- e\n", 5},
		// Parser class: "did not find expected ',' or ']'", no library line.
		{"parser line 1", "[1, 2}\n", 1},
		// The library's context mark is the outer mapping on line 1 (0-based 0,
		// treated as unset), so it reports the problem mark: 0-based 3, which
		// is line 4 (" - bad").
		{"parser error reports problem line", "version: 1\nsettings:\n  theme: dark\n - bad\n", 4},
		{"parser error, second class", "version: 1\nname: x\n  y: z\n", 3},
		{"unknown anchor has no line", "version: 1\nname: *nope\n", 0},
		{"tab indentation", "version: 1\nsettings:\n\ttheme: dark\n", 3},
		{"invalid UTF-8", "version: 1\nname: \xff\xfe\n", -1},
		{"NUL byte", "version: 1\nname: a\x00b\n", -1},
		{"flow unclosed", "version: 1\nx: [1, 2\ny: 3\n", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, _, err := ParseProject([]byte(c.src))
			pe := asParseError(t, err)
			if c.line >= 0 && pe.Line != c.line {
				t.Errorf("line = %d, want %d (msg %q)", pe.Line, c.line, pe.Msg)
			}
			if pe.Line < 0 || pe.Line > lineCount([]byte(c.src)) {
				t.Errorf("line %d out of range", pe.Line)
			}
			if strings.HasPrefix(pe.Msg, "yaml:") || strings.Contains(pe.Msg, "yaml: ") {
				t.Errorf("message has yaml: prefix: %q", pe.Msg)
			}
			checkText(t, pe.Msg, MaxMessageRunes)
		})
	}
}

// TestLibraryErrorLineBehavior pins the raw library line numbers that
// syntaxError corrects, so a library change is noticed.
func TestLibraryErrorLineBehavior(t *testing.T) {
	for src, want := range map[string]string{
		// parser class: 0-based, one too low (true lines 2 and 5)
		"a: 1\n- b\n":                   "yaml: line 1: did not find expected key",
		"a: 1\nb: 1\nc: 1\nd: 1\n- e\n": "yaml: line 4: did not find expected key",
		// parser class on line 1: no prefix
		"[1, 2}\n": "yaml: did not find expected ',' or ']'",
		// scanner class: 1-based; line 1 has no prefix
		"a: 1\n@a\n": "yaml: line 2: found character that cannot start any token",
		"@a\n":       "yaml: found character that cannot start any token",
	} {
		var n yaml.Node
		err := yaml.Unmarshal([]byte(src), &n)
		if err == nil || err.Error() != want {
			t.Errorf("library error for %q = %v, want %q", src, err, want)
		}
	}
}

func TestSyntaxErrorLineClampedAndMessageBounded(t *testing.T) {
	// A library line beyond the input is clamped.
	pe := syntaxError(errors.New("yaml: line 900: boom"), []byte("a\nb\n"))
	if pe.Line != 3 { // "a\nb\n" has 3 lines (trailing empty)
		t.Errorf("clamped line = %d", pe.Line)
	}
	long := "yaml: line 2: " + strings.Repeat("é\x07", 400)
	pe = syntaxError(errors.New(long), []byte("a\nb\n"))
	checkText(t, pe.Msg, MaxMessageRunes)
	if strings.Contains(pe.Msg, "line 2") {
		t.Errorf("line prefix kept: %q", pe.Msg)
	}
	pe = syntaxError(errors.New("yaml: boom"), []byte("a"))
	if pe.Line != 0 || pe.Msg != "boom" {
		t.Errorf("got %+v", pe)
	}
	if clampLine(0, []byte("a")) != 0 || clampLine(5, []byte("a\r\rb")) != 3 || clampLine(-3, nil) != 0 {
		t.Error("clampLine")
	}
}

// The parsers take []byte and never an io.Reader, so reader errors (which the
// yaml library embeds in its messages) cannot occur. This test proves only
// that host-path-looking text inside the YAML itself stays bounded and
// sanitized when it reaches an error message.
func TestHostPathTextInInputIsBoundedInMessages(t *testing.T) {
	src := "version: 1\nname: [/home/secret/" + strings.Repeat("p", 500) + "\x01\n"
	_, _, err := ParseProject([]byte(src))
	pe := asParseError(t, err)
	checkText(t, pe.Msg, MaxMessageRunes)
	_, w, err := ParseProject([]byte("version: 1\ninclude:\n- " + strings.Repeat("/home/secret/", 200) + "\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range w {
		checkText(t, x.Ref, MaxRefRunes)
	}
}

func TestPanicIsRecovered(t *testing.T) {
	testHook = func() { panic("boom with /host/path") }
	t.Cleanup(func() { testHook = nil })
	_, _, err := ParseProject([]byte("version: 1\n"))
	pe := asParseError(t, err)
	if pe.Msg != "could not parse the file" || strings.Contains(pe.Msg, "boom") {
		t.Errorf("msg = %q", pe.Msg)
	}
	_, _, err = ParsePrefs([]byte("settings: {}\n"))
	_ = asParseError(t, err)
}

func TestWalkPanicIsRecovered(t *testing.T) {
	walkHook = func() { panic("walk boom") }
	t.Cleanup(func() { walkHook = nil })
	_, _, err := ParseProject([]byte("version: 1\n"))
	if pe := asParseError(t, err); pe.Msg != "could not parse the file" {
		t.Errorf("msg = %q", pe.Msg)
	}
	_, _, err = ParsePrefs([]byte("settings: {}\n"))
	_ = asParseError(t, err)
}

func TestEmptyAndCommentOnly(t *testing.T) {
	for _, src := range []string{"", "   \n", "# just a comment\n", "# a\n\n# b\n"} {
		pe := asParseError(t, func() error { _, _, err := ParseProject([]byte(src)); return err }())
		if pe.Msg != "file is empty" {
			t.Errorf("project %q: %q", src, pe.Msg)
		}
		p, w, err := ParsePrefs([]byte(src))
		if err != nil || len(w) != 0 || p == nil || p.Settings != (Settings{}) {
			t.Errorf("prefs %q: %v %v %v", src, p, w, err)
		}
	}
	// a bare null document behaves like empty
	if _, _, err := ParseProject([]byte("---\n")); err == nil {
		t.Error("null project accepted")
	}
	if _, _, err := ParsePrefs([]byte("---\n")); err != nil {
		t.Error(err)
	}
	if _, _, err := ParsePrefs([]byte("~\n")); err != nil {
		t.Error(err)
	}
}

func TestVersion(t *testing.T) {
	for _, tc := range []struct {
		src  string
		line int
	}{
		{"name: x\n", 0},
		{"version: 2\n", 1},
		{"name: x\nversion: \"1\"\n", 2},
		{"version: 1.0\n", 1},
		{"version: null\n", 0},
		{"version: [1]\n", 1},
		{"version: yes\n", 1},
	} {
		_, _, err := ParseProject([]byte(tc.src))
		pe := asParseError(t, err)
		if pe.Line != tc.line {
			t.Errorf("%q: line %d want %d", tc.src, pe.Line, tc.line)
		}
	}
	if _, _, err := ParseProject([]byte("version: 1\n")); err != nil {
		t.Error(err)
	}
	for _, src := range []string{"version: 2\n", "version: \"1\"\n", "version: 1.0\n", "version: true\n", "settings: {}\nversion: 3\n"} {
		_, _, err := ParsePrefs([]byte(src))
		_ = asParseError(t, err)
	}
	for _, src := range []string{"version: 1\n", "settings: {theme: dark}\n", "version: null\n"} {
		if _, _, err := ParsePrefs([]byte(src)); err != nil {
			t.Errorf("%q: %v", src, err)
		}
	}
}

func TestPrefsOnlyAllowsVersionAndSettings(t *testing.T) {
	p, w := mustPrefs(t, "version: 1\nname: x\ninclude: [a]\nopen: a\nsettings: {theme: dark}\n")
	if p.Settings.Theme == nil || *p.Settings.Theme != "dark" {
		t.Error("settings lost")
	}
	for _, k := range []string{"name", "include", "open"} {
		if !hasWarn(w, CodeUnknownKey, k, 0) {
			t.Errorf("missing unknown_key for %s: %v", k, w)
		}
	}
	if !strings.Contains(w[0].Message, "not allowed in preferences") {
		t.Errorf("msg %q", w[0].Message)
	}
}

func TestProjectTopLevelKeys(t *testing.T) {
	p, w := mustProject(t, "version: 1\nname:  \"  Docker  course \"\nopen: a/b.md\ninclude: [x/, y.md]\nbogus: 1\n")
	if len(w) != 1 || !hasWarn(w, CodeUnknownKey, "bogus", 5) {
		t.Fatalf("warnings %v", w)
	}
	if p.Name == nil || *p.Name != "Docker  course" {
		t.Errorf("name %v", p.Name)
	}
	if p.Open == nil || p.Open.Text != "a/b.md" || p.Open.Key != "open" || p.Open.Line != 3 {
		t.Errorf("open %+v", p.Open)
	}
	if len(p.Include) != 2 || p.Include[1] != (Ref{Text: "y.md", Key: "include[1]", Line: 4}) {
		t.Errorf("include %+v", p.Include)
	}
}

func TestNameValidation(t *testing.T) {
	for _, src := range []string{
		`name: ""`, `name: "   "`, `name: 5`, `name: true`, `name: [a]`,
		"name: \"a\\tb\"", "name: \"a\\u202eb\"", "name: " + strings.Repeat("x", 101),
	} {
		p, w := mustProject(t, "version: 1\n"+src+"\n")
		if p.Name != nil || !hasWarn(w, CodeInvalidValue, "name", 2) {
			t.Errorf("%q: name=%v warns=%v", src, p.Name, w)
		}
	}
	p, _ := mustProject(t, "version: 1\nname: "+strings.Repeat("é", 100)+"\n")
	if p.Name == nil {
		t.Error("100 runes rejected")
	}
	p, w := mustProject(t, "version: 1\nname: null\n")
	if p.Name != nil || len(w) != 0 {
		t.Error("null name")
	}
}

func TestReferences(t *testing.T) {
	src := "version: 1\nopen: 5\ninclude:\n- ok.md\n- \"\"\n- ~\n- 12\n- [a]\n- true\n- " +
		strings.Repeat("a", MaxRefBytes+1) + "\n- " + strings.Repeat("b", MaxRefBytes) + "\n"
	p, w := mustProject(t, src)
	if p.Open != nil || !hasWarn(w, CodeInvalidPath, "open", 2) {
		t.Errorf("open: %v %v", p.Open, w)
	}
	for _, i := range []int{1, 2, 3, 4, 5, 6} {
		if !hasWarn(w, CodeInvalidPath, fmt.Sprintf("include[%d]", i), 0) {
			t.Errorf("no invalid_path for include[%d]: %v", i, w)
		}
	}
	if len(p.Include) != 2 || p.Include[0].Text != "ok.md" || p.Include[1].Key != "include[7]" {
		t.Errorf("include = %+v", p.Include)
	}
	checkBounded(t, w)
	// open: null is unset, include must be a list
	p, w = mustProject(t, "version: 1\nopen: null\ninclude: a.md\n")
	if p.Open != nil || p.Include != nil || !hasWarn(w, CodeInvalidValue, "include", 3) || len(w) != 1 {
		t.Errorf("%v %v", p, w)
	}
	// raw text is kept, lexical rules are not applied here
	p, w = mustProject(t, "version: 1\ninclude: ['../x', '/abs', 'a\\b', './a:b']\n")
	if len(p.Include) != 4 || len(w) != 0 {
		t.Errorf("lexical rules applied: %v %v", p.Include, w)
	}
}

func TestTooManyIncludes(t *testing.T) {
	var b strings.Builder
	b.WriteString("version: 1\ninclude:\n")
	for i := range MaxIncludes + 50 {
		fmt.Fprintf(&b, "- f%d\n", i)
	}
	p, w := mustProject(t, b.String())
	if len(p.Include) != MaxIncludes {
		t.Errorf("%d includes", len(p.Include))
	}
	n := 0
	for _, x := range w {
		if x.Code == CodeTooManyIncludes {
			n++
		}
	}
	if n != 1 || len(w) != 1 {
		t.Errorf("warnings %v", w)
	}
	// exactly 200 is fine
	var c strings.Builder
	c.WriteString("version: 1\ninclude:\n")
	for i := range MaxIncludes {
		fmt.Fprintf(&c, "- f%d\n", i)
	}
	p, w = mustProject(t, c.String())
	if len(p.Include) != MaxIncludes || len(w) != 0 {
		t.Errorf("%d %v", len(p.Include), w)
	}
}

func TestSettingsKeys(t *testing.T) {
	type tc struct {
		key, good, bad string
		check          func(*Settings) bool
	}
	cases := []tc{
		{"theme", "dark", "purple", func(s *Settings) bool { return s.Theme != nil && *s.Theme == "dark" }},
		{"style", "github", "Github", func(s *Settings) bool { return s.Style != nil && *s.Style == "github" }},
		{"font", "serif", "1serif", func(s *Settings) bool { return s.Font != nil && *s.Font == "serif" }},
		{"codeFont", "mono-2", "a_b", func(s *Settings) bool { return s.CodeFont != nil && *s.CodeFont == "mono-2" }},
		{"fontSize", "18", "11", func(s *Settings) bool { return s.FontSize != nil && *s.FontSize == 18 }},
		{"lineHeight", "1.6", "2.6", func(s *Settings) bool { return s.LineHeight != nil && *s.LineHeight == 1.6 }},
		{"contentWidth", "wide", "huge", func(s *Settings) bool { return s.ContentWidth != nil && *s.ContentWidth == "wide" }},
		{"markdownOnly", "true", "yes", func(s *Settings) bool { return s.MarkdownOnly != nil && *s.MarkdownOnly }},
		{"showHidden", "false", "on", func(s *Settings) bool { return s.ShowHidden != nil && !*s.ShowHidden }},
		{"sort", "date", "size", func(s *Settings) bool { return s.Sort != nil && *s.Sort == "date" }},
		{"readTime.wpm", "200", "59", func(s *Settings) bool { return s.ReadTime != nil && s.ReadTime.WPM != nil && *s.ReadTime.WPM == 200 }},
		{"readTime.includeHeadings", "true", "1", func(s *Settings) bool {
			return s.ReadTime != nil && s.ReadTime.IncludeHeadings != nil && *s.ReadTime.IncludeHeadings
		}},
		{"readTime.includeCode", "true", "\"true\"", func(s *Settings) bool {
			return s.ReadTime != nil && s.ReadTime.IncludeCode != nil && *s.ReadTime.IncludeCode
		}},
	}
	doc := func(key, val string) string {
		if rest, ok := strings.CutPrefix(key, "readTime."); ok {
			return "version: 1\nsettings:\n  readTime:\n    " + rest + ": " + val + "\n"
		}
		return "version: 1\nsettings:\n  " + key + ": " + val + "\n"
	}
	line := func(key string) int {
		if strings.HasPrefix(key, "readTime.") {
			return 4
		}
		return 3
	}
	for _, c := range cases {
		wk := "settings." + c.key
		t.Run(c.key, func(t *testing.T) {
			for _, parse := range []func(string) (*Settings, []Warning){
				func(s string) (*Settings, []Warning) { p, w := mustProject(t, s); return &p.Settings, w },
				func(s string) (*Settings, []Warning) { p, w := mustPrefs(t, s); return &p.Settings, w },
			} {
				s, w := parse(doc(c.key, c.good))
				if !c.check(s) || len(w) != 0 {
					t.Errorf("good: %+v %v", s, w)
				}
				s, w = parse(doc(c.key, c.bad))
				if *s != (Settings{}) || len(w) != 1 || !hasWarn(w, CodeInvalidValue, wk, line(c.key)) {
					t.Errorf("bad: %+v %v", s, w)
				}
				s, w = parse(doc(c.key, "null"))
				if *s != (Settings{}) || len(w) != 0 {
					t.Errorf("null: %+v %v", s, w)
				}
				// duplicate: first wins
				dup := doc(c.key, c.good) + strings.Repeat(" ", 0)
				indent := "  "
				if strings.HasPrefix(c.key, "readTime.") {
					indent = "    "
					dup += indent + strings.TrimPrefix(c.key, "readTime.") + ": " + c.good + "\n"
				} else {
					dup += indent + c.key + ": " + c.good + "\n"
				}
				s, w = parse(dup)
				if !c.check(s) || len(w) != 1 || !hasWarn(w, CodeDuplicateKey, wk, line(c.key)+1) {
					t.Errorf("dup: %+v %v", s, w)
				}
				// unknown sibling
				s, w = parse(doc(c.key, c.good) + indent + "zzz: 1\n")
				if !c.check(s) || len(w) != 1 || w[0].Code != CodeUnknownKey {
					t.Errorf("unknown: %+v %v", s, w)
				}
			}
		})
	}
}

func TestSettingsEdgeCases(t *testing.T) {
	// numeric edges
	for _, v := range []string{".nan", ".inf", "-.inf", "\"18\"", "[18]", "true", "1e400", "0x14", "024"} {
		p, w := mustProject(t, "version: 1\nsettings: {fontSize: "+v+"}\n")
		if p.Settings.FontSize != nil || len(w) != 1 {
			t.Errorf("fontSize %s accepted: %v", v, w)
		}
	}
	for _, v := range []string{"12", "12.0", "32", "1.5e1"} {
		p, w := mustProject(t, "version: 1\nsettings: {fontSize: "+v+"}\n")
		if p.Settings.FontSize == nil || len(w) != 0 {
			t.Errorf("fontSize %s rejected: %v", v, w)
		}
	}
	for _, v := range []string{"1.0", "2.5"} {
		if p, _ := mustProject(t, "version: 1\nsettings: {lineHeight: "+v+"}\n"); p.Settings.LineHeight == nil {
			t.Errorf("lineHeight %s", v)
		}
	}
	for _, v := range []string{"160.0", "60.5", "601", "\"100\"", "99999999999999999999"} {
		p, w := mustProject(t, "version: 1\nsettings: {readTime: {wpm: "+v+"}}\n")
		if p.Settings.ReadTime != nil || len(w) != 1 {
			t.Errorf("wpm %s accepted: %v", v, w)
		}
	}
	for _, v := range []string{"60", "600"} {
		if p, _ := mustProject(t, "version: 1\nsettings: {readTime: {wpm: "+v+"}}\n"); p.Settings.ReadTime == nil {
			t.Errorf("wpm %s", v)
		}
	}
	// YAML 1.2 booleans
	p, w := mustProject(t, "version: 1\nsettings: {markdownOnly: yes, showHidden: on}\n")
	if p.Settings.MarkdownOnly != nil || len(w) != 2 || w[0].Message != "must be true or false" {
		t.Errorf("yes/on: %v", w)
	}
	// settings / readTime not mappings
	_, w = mustProject(t, "version: 1\nsettings: [a]\n")
	if len(w) != 1 || !hasWarn(w, CodeInvalidValue, "settings", 2) {
		t.Errorf("settings list: %v", w)
	}
	p, w = mustProject(t, "version: 1\nsettings: {readTime: 5}\n")
	if p.Settings.ReadTime != nil || !hasWarn(w, CodeInvalidValue, "settings.readTime", 2) {
		t.Errorf("readTime scalar: %v", w)
	}
	// unknown nested keys use dotted names
	_, w = mustProject(t, "version: 1\nsettings:\n  foo: 1\n  readTime:\n    bar: 2\n")
	if !hasWarn(w, CodeUnknownKey, "settings.foo", 3) || !hasWarn(w, CodeUnknownKey, "settings.readTime.bar", 5) {
		t.Errorf("dotted: %v", w)
	}
	// empty readTime yields no object
	p, _ = mustProject(t, "version: 1\nsettings: {readTime: {}}\n")
	if p.Settings.ReadTime != nil {
		t.Error("empty readTime kept")
	}
	// duplicate top-level and settings keys
	_, w = mustProject(t, "version: 1\nname: a\nname: b\nsettings: {}\nsettings: {theme: dark}\n")
	if !hasWarn(w, CodeDuplicateKey, "name", 3) || !hasWarn(w, CodeDuplicateKey, "settings", 5) {
		t.Errorf("dup top: %v", w)
	}
	// duplicate of a null first value: first (null) wins
	p, w = mustProject(t, "version: 1\nname: ~\nname: b\n")
	if p.Name != nil || !hasWarn(w, CodeDuplicateKey, "name", 3) {
		t.Errorf("dup null: %v %v", p.Name, w)
	}
}

func TestNonStringKeys(t *testing.T) {
	for _, src := range []string{"version: 1\n5: x\n", "version: 1\n? [a, b]\n: x\n", "version: 1\ntrue: x\n", "version: 1\n~: x\n"} {
		_, w := mustProject(t, src)
		if len(w) != 1 || w[0].Code != CodeUnknownKey || w[0].Key != "(non-string key)" || w[0].Line != 2 {
			t.Errorf("%q: %v", src, w)
		}
	}
	_, w := mustProject(t, "version: 1\nsettings:\n  7: x\n")
	if len(w) != 1 || w[0].Key != "settings.(non-string key)" {
		t.Errorf("%v", w)
	}
}

func TestUnknownKeyEchoIsBounded(t *testing.T) {
	_, w := mustProject(t, "version: 1\n\""+strings.Repeat("k\\x07", 100)+"\": 1\n")
	if len(w) != 1 {
		t.Fatalf("%v", w)
	}
	checkBounded(t, w)
	if utf8.RuneCountInString(w[0].Key) != 80 {
		t.Errorf("key runes %d", utf8.RuneCountInString(w[0].Key))
	}
}

func TestWarningCap(t *testing.T) {
	var b strings.Builder
	b.WriteString("version: 1\n")
	for i := range 150 {
		fmt.Fprintf(&b, "k%d: 1\n", i)
	}
	_, w := mustProject(t, b.String())
	if len(w) != MaxWarnings+1 || w[MaxWarnings].Code != CodeWarningsTruncated || w[MaxWarnings-1].Code != CodeUnknownKey {
		t.Fatalf("len %d, last %+v", len(w), w[len(w)-1])
	}
	_, w = mustPrefs(t, strings.Replace(b.String(), "version: 1\n", "", 1))
	if len(w) != MaxWarnings+1 {
		t.Fatalf("prefs len %d", len(w))
	}
	// exactly 100 is not truncated
	var c strings.Builder
	c.WriteString("version: 1\n")
	for i := range MaxWarnings {
		fmt.Fprintf(&c, "k%d: 1\n", i)
	}
	if _, w = mustProject(t, c.String()); len(w) != MaxWarnings {
		t.Fatalf("len %d", len(w))
	}
}

func TestCapWarnings(t *testing.T) {
	ws := make([]Warning, 250)
	for i := range ws {
		ws[i] = Warning{Code: CodeMissing}
	}
	out := CapWarnings(ws)
	if len(out) != 101 || out[100].Code != CodeWarningsTruncated {
		t.Fatalf("len %d", len(out))
	}
	if again := CapWarnings(out); len(again) != 101 || again[100].Code != CodeWarningsTruncated || again[99].Code != CodeMissing {
		t.Fatalf("not idempotent: %d", len(again))
	}
	if short := CapWarnings(ws[:3]); len(short) != 3 {
		t.Fatal("short list changed")
	}
	if len(ws) != 250 {
		t.Fatal("input mutated")
	}
}

func TestNewWarningSanitizes(t *testing.T) {
	w := NewWarning("c", strings.Repeat("m\x07", 300), "k\u202e", strings.Repeat("r", 200)+"\xff", -4)
	if w.Line != 0 || w.Key != "k?" {
		t.Errorf("%+v", w)
	}
	checkBounded(t, []Warning{w})
	if utf8.RuneCountInString(w.Ref) != MaxRefRunes || utf8.RuneCountInString(w.Message) != MaxMessageRunes {
		t.Errorf("caps: %d %d", utf8.RuneCountInString(w.Ref), utf8.RuneCountInString(w.Message))
	}
	if Sanitize("a\xffb", 10) != "a?b" {
		t.Error("invalid utf-8")
	}
}

func TestJSONShape(t *testing.T) {
	p, _ := mustProject(t, "version: 1\nsettings: {theme: dark, fontSize: 18, readTime: {wpm: 200, includeCode: true}}\n")
	b, err := json.Marshal(p.Settings)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"theme":"dark","fontSize":18,"readTime":{"wpm":200,"includeCode":true}}`
	if string(b) != want {
		t.Errorf("got %s", b)
	}
	if b, _ := json.Marshal(Settings{}); string(b) != "{}" {
		t.Errorf("empty = %s", b)
	}
	b, _ = json.Marshal(Warning{Code: "x", Message: "m"})
	if string(b) != `{"code":"x","message":"m"}` {
		t.Errorf("warning = %s", b)
	}
}

func TestParseErrorString(t *testing.T) {
	if (&ParseError{Line: 3, Msg: "x"}).Error() != "line 3: x" || (&ParseError{Msg: "x"}).Error() != "x" {
		t.Error("Error()")
	}
}

func TestCRLFAndBOMInput(t *testing.T) {
	if _, _, err := ParseProject([]byte("version: 1\r\nname: x\r\n")); err != nil {
		t.Error(err)
	}
	_, _, err := ParseProject([]byte("version: 1\r\nname: a: b\r\n"))
	if pe := asParseError(t, err); pe.Line != 2 {
		t.Errorf("line %d", pe.Line)
	}
}

// TestWorstCaseAllocation pins the memory a 32 KiB document can cost. The node
// tree is built before the pre-check runs, so this is the real worst case.
// Measured on go1.27 at roughly 1.6-7 MiB (the densest shape is a flow map of
// bare keys); the 24 MiB bound leaves headroom so it only trips on a real
// regression, such as a decoder change that builds a much larger tree. The
// alias-heavy input shows aliases are not expanded: it stays in the same range.
func TestWorstCaseAllocation(t *testing.T) {
	const bound = 24 << 20
	var wide strings.Builder
	wide.WriteString("version: 1\nx: {")
	for i := 0; wide.Len() < MaxFileSize-16; i++ {
		fmt.Fprintf(&wide, "a%d: 1, ", i)
	}
	wide.WriteString("z: 1}\n")
	seq := "version: 1\nx: " + strings.Repeat("[", 16000)
	seq += strings.Repeat("]", 16000)
	seq = seq[:min(len(seq), MaxFileSize)]
	flat := "version: 1\nx: [" + strings.Repeat("1,", 16000)
	flat = flat[:min(len(flat), MaxFileSize-8)] + "]\n"
	dense := "version: 1\nx: {" + strings.Repeat("a,", MaxFileSize/2)
	dense = dense[:MaxFileSize-8] + "}\n"
	alias := "version: 1\nx: &a [1]\ny: [" + strings.Repeat("*a,", MaxFileSize/3)
	alias = alias[:MaxFileSize-8] + "]\n"
	inputs := map[string]string{"wide map": wide.String(), "deep seq": seq, "long seq": flat, "dense flow map": dense, "alias heavy": alias}
	for name, src := range inputs {
		if len(src) > MaxFileSize {
			t.Fatalf("%s: test input too large: %d", name, len(src))
		}
		var before, after runtime.MemStats
		runtime.GC()
		runtime.ReadMemStats(&before)
		_, _, err := ParseProject([]byte(src))
		runtime.ReadMemStats(&after)
		used := after.TotalAlloc - before.TotalAlloc
		t.Logf("%s: %d bytes allocated, err=%v", name, used, err != nil)
		if used > bound {
			t.Errorf("%s: allocated %d bytes, bound %d", name, used, bound)
		}
		if err == nil {
			t.Errorf("%s: expected a fatal error (node/depth limit)", name)
		}
	}
}
