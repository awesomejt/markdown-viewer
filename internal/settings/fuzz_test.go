package settings

import (
	"errors"
	"testing"
)

var fuzzSeeds = []string{
	"", "# c\n", "version: 1\n", "version: 1\nname: x\nopen: a.md\ninclude: [a, b/]\nsettings: {theme: dark, fontSize: 18, readTime: {wpm: 200}}\n",
	"version: 1\na: &x 1\nb: *x\n", "version: 1\nname: !!str x\n", "version: 1\n<<: {a: 1}\n", "version: 1\n---\nversion: 1\n",
	"version: 1\nx: [[[[[[[[[[[[\n", "version: 1\n\tx: 1\n", "version: 1\nname: \xff\n", "version: 1\nname: a\x00b\n",
	"- a\n", "5: x\n", "settings: [a]\n", "version: 2\n", "version: 1\ninclude: [1, ~, '', [a]]\n",
	"version: 1\nsettings: {fontSize: .nan, lineHeight: .inf, markdownOnly: yes}\n", "---\n", "~\n",
}

func checkParse(t *testing.T, b []byte, err error, ws []Warning) {
	t.Helper()
	if len(ws) > MaxWarnings+1 {
		t.Fatalf("%d warnings", len(ws))
	}
	checkBounded(t, ws)
	for _, w := range ws {
		if w.Line < 0 || w.Line > lineCount(b) {
			t.Fatalf("warning line %d outside [0,%d]", w.Line, lineCount(b))
		}
	}
	if err != nil {
		var pe *ParseError
		if !errors.As(err, &pe) {
			t.Fatalf("error type %T", err)
		}
		checkText(t, pe.Msg, MaxMessageRunes)
		if pe.Line < 0 || pe.Line > lineCount(b) {
			t.Fatalf("line %d outside [0,%d]", pe.Line, lineCount(b))
		}
	}
}

func FuzzParseProject(f *testing.F) {
	for _, s := range fuzzSeeds {
		f.Add([]byte(s))
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		_, ws, err := ParseProject(b)
		checkParse(t, b, err, ws)
	})
}

func FuzzParsePrefs(f *testing.F) {
	for _, s := range fuzzSeeds {
		f.Add([]byte(s))
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		_, ws, err := ParsePrefs(b)
		checkParse(t, b, err, ws)
	})
}
