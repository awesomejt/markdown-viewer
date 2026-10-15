package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/settings"
)

func projURL(root, p string) string {
	return "/api/project?" + url.Values{"root": {root}, "path": {p}}.Encode()
}

func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		full := filepath.Join(dir, filepath.FromSlash(name))
		if strings.HasSuffix(name, "/") {
			if err := os.MkdirAll(full, 0o755); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func projectServer(t *testing.T, files map[string]string) (*Server, string) {
	t.Helper()
	dir := writeTree(t, files)
	s, _ := newServer(t, config.Root{Name: "p", Path: dir, Watch: config.WatchPoll})
	return s, dir
}

type projResp struct {
	Root string  `json:"root"`
	Path string  `json:"path"`
	Name *string `json:"name"`
	Open *struct {
		Root, Path, Kind string
	} `json:"open"`
	Entries []struct {
		Root, Path, Type, Kind, Ref string
		Line                        int
	} `json:"entries"`
	Settings map[string]any     `json:"settings"`
	Warnings []settings.Warning `json:"warnings"`
}

func getProject(t *testing.T, s *Server, p string) (projResp, *httptest.ResponseRecorder) {
	t.Helper()
	rec := do(s.Handler(), "GET", projURL("p", p))
	var out projResp
	if rec.Code == 200 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("bad body %q: %v", rec.Body, err)
		}
	}
	return out, rec
}

func warnCodes(ws []settings.Warning) []string {
	out := []string{}
	for _, w := range ws {
		out = append(out, w.Code+":"+w.Key)
	}
	return out
}

func hasWarn(ws []settings.Warning, code, key string) bool {
	for _, w := range ws {
		if w.Code == code && w.Key == key {
			return true
		}
	}
	return false
}

func TestProjectResolves(t *testing.T) {
	s, _ := projectServer(t, map[string]string{
		"courses/docker.mdv.yaml": `version: 1
name: Docker course
open: outlines/README.md
include:
  - notes/
  - ./notes
  - intro.md
  - missing/
  - file.md/
  - ../top.md
  - ../../x
  - a/../b
  - /abs
  - 'a\b'
  - other:thing
  - img.png
  - ..notes.md
  - .
settings:
  theme: dark
  fontSize: 18
`,
		"courses/outlines/README.md": "# hi",
		"courses/notes/a.md":         "a",
		"courses/intro.md":           "x",
		"courses/file.md":            "x",
		"courses/img.png":            "x",
		"courses/..notes.md":         "x",
		"top.md":                     "x",
	})
	out, rec := getProject(t, s, "courses/docker.mdv.yaml")
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" || rec.Header().Get("ETag") != "" {
		t.Fatalf("status %d headers %v", rec.Code, rec.Header())
	}
	if out.Root != "p" || out.Path != "courses/docker.mdv.yaml" || out.Name == nil || *out.Name != "Docker course" {
		t.Fatalf("bad header: %+v", out)
	}
	if out.Open == nil || out.Open.Path != "courses/outlines/README.md" || out.Open.Kind != "markdown" {
		t.Fatalf("open: %+v", out.Open)
	}
	var got []string
	for _, e := range out.Entries {
		got = append(got, e.Type+":"+e.Kind+":"+e.Path+":"+e.Ref)
	}
	wantEntries := []string{
		"dir:other:courses/notes:notes/",
		"file:markdown:courses/intro.md:intro.md",
		"file:markdown:top.md:../top.md",
		"file:image:courses/img.png:img.png",
		"file:markdown:courses/..notes.md:..notes.md",
		"dir:other:courses:.",
	}
	if strings.Join(got, "|") != strings.Join(wantEntries, "|") {
		t.Fatalf("entries:\n got %q\nwant %q", got, wantEntries)
	}
	for _, c := range [][2]string{
		{"missing", "include[3]"}, {"not_a_dir", "include[4]"}, {"outside_root", "include[6]"},
		{"invalid_path", "include[7]"}, {"invalid_path", "include[8]"}, {"invalid_path", "include[9]"},
		{"cross_root_unsupported", "include[10]"},
	} {
		if !hasWarn(out.Warnings, c[0], c[1]) {
			t.Errorf("missing warning %v in %v", c, warnCodes(out.Warnings))
		}
	}
	if len(out.Warnings) != 7 {
		t.Errorf("warnings %v", warnCodes(out.Warnings))
	}
	if out.Settings["theme"] != "dark" || out.Settings["fontSize"] != 18.0 {
		t.Errorf("settings %v", out.Settings)
	}
	for _, w := range out.Warnings {
		if w.Line == 0 {
			t.Errorf("warning without line: %+v", w)
		}
	}
}

func TestProjectAtRootDotAndSiblingNull(t *testing.T) {
	s, _ := projectServer(t, map[string]string{
		".mdv.yml": "version: 1\ninclude: ['.', 'c:foo', 'C:foo', './ab:b/c']\n",
		"ab:b/c":   "x",
	})
	out, rec := getProject(t, s, ".mdv.yml")
	if rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	if out.Name != nil || out.Open != nil {
		t.Fatalf("name/open must be null: %+v", out)
	}
	if len(out.Entries) != 2 || out.Entries[0].Path != "" || out.Entries[0].Type != "dir" ||
		out.Entries[1].Path != "ab:b/c" {
		t.Fatalf("entries %+v", out.Entries)
	}
	if !hasWarn(out.Warnings, "cross_root_unsupported", "include[1]") ||
		!hasWarn(out.Warnings, "invalid_path", "include[2]") || len(out.Warnings) != 2 {
		t.Fatalf("warnings %v", warnCodes(out.Warnings))
	}
	if !strings.Contains(rec.Body.String(), `"name":null`) || !strings.Contains(rec.Body.String(), `"open":null`) {
		t.Fatalf("body %s", rec.Body)
	}
}

func TestProjectEscapeMakesNoFSCall(t *testing.T) {
	dir := writeTree(t, map[string]string{"a/b/p.mdv.yaml": "version: 1\ninclude: ['../x', '../../x', '../../../x', '..']\nopen: ../../../y.md\n"})
	root, err := fsroot.OpenRoot(config.Root{Name: "p", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	cf := &countFS{FS: root}
	h := fsroot.NewHandle("p", config.WatchPoll, cf, time.Second, 4, 100)
	s := New(fsroot.NewRegistryFromHandles(h), testConfig(), nil)
	out, rec := getProject(t, s, "a/b/p.mdv.yaml")
	if rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	// ../x and .. stay inside the root (a/x and a); ../../x is the root (x) and
	// ../../../x escapes.
	if !hasWarn(out.Warnings, "outside_root", "include[2]") || !hasWarn(out.Warnings, "outside_root", "open") {
		t.Fatalf("warnings %v", warnCodes(out.Warnings))
	}
	for _, p := range cf.statPaths() {
		if strings.HasPrefix(p, "..") || p == "y.md" {
			t.Fatalf("escaping path reached the fs: %q", p)
		}
	}
	if len(cf.statPaths()) != 3 { // a/x, x, a
		t.Fatalf("stat paths %v", cf.statPaths())
	}
}

// countFS records Stat paths (not the recovery probe's ".").
type countFS struct {
	fsroot.FS
	mu    sync.Mutex
	stats []string
	n     atomic.Int32
	delay time.Duration
}

func (c *countFS) Stat(rel string) (fs.FileInfo, error) {
	c.mu.Lock()
	c.stats = append(c.stats, rel)
	c.mu.Unlock()
	c.n.Add(1)
	if c.delay > 0 {
		time.Sleep(c.delay)
	}
	return c.FS.Stat(rel)
}

func (c *countFS) statPaths() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.stats...)
}

func TestProjectOpenKinds(t *testing.T) {
	s, root := projectServer(t, map[string]string{
		"a.mdv.yaml": "version: 1\n",
		"d/":         "", "i.png": "x", "p.mdv.yaml": "version: 1\n", "t.txt": "x", "g.mmd": "x", "o.bin": "x",
		"x.md": "x",
	})
	for open, wantOK := range map[string]bool{"d": false, "d/": false, "i.png": false, "p.mdv.yaml": false,
		"o.bin": false, "t.txt": true, "g.mmd": true, "x.md": true, "nope.md": false} {
		body := "version: 1\nopen: '" + open + "'\n"
		if err := os.WriteFile(filepath.Join(root, "a.mdv.yaml"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		out, rec := getProject(t, s, "a.mdv.yaml")
		if rec.Code != 200 {
			t.Fatal(rec.Body)
		}
		if wantOK != (out.Open != nil) {
			t.Errorf("open %q: open=%+v warnings=%v", open, out.Open, warnCodes(out.Warnings))
		}
		if !wantOK {
			code := "not_a_file"
			if open == "nope.md" {
				code = "missing"
			}
			if !hasWarn(out.Warnings, code, "open") {
				t.Errorf("open %q: warnings %v", open, warnCodes(out.Warnings))
			}
		}
	}
}

func TestProjectBadRequests(t *testing.T) {
	s, _ := projectServer(t, map[string]string{"d.mdv.yaml/": "", "x.md": "x", "x.yaml": "x"})
	h := s.Handler()
	for _, u := range map[string]string{
		"no root":       "/api/project?path=a.mdv.yaml",
		"no path":       "/api/project?root=p",
		"not a project": projURL("p", "x.md"),
		"plain yaml":    projURL("p", "x.yaml"),
		"directory":     projURL("p", "d.mdv.yaml"),
		"traversal":     projURL("p", "../a.mdv.yaml"),
	} {
		wantErr(t, do(h, "GET", u), 400, "bad_request")
	}
	wantErr(t, do(h, "GET", projURL("p", "gone.mdv.yaml")), 404, "not_found")
	wantErr(t, do(h, "GET", projURL("zz", "a.mdv.yaml")), 404, "not_found")
	wantErr(t, do(h, "POST", projURL("p", "a.mdv.yaml")), 405, "method_not_allowed")
	if rec := do(h, "GET", projURL("p", "x.md")); rec.Header().Get("Cache-Control") != "no-cache" {
		t.Error("errors also send no-cache")
	}
}

func TestProjectInvalid(t *testing.T) {
	big := "version: 1\n# " + strings.Repeat("x", settings.MaxFileSize) + "\n"
	s, _ := projectServer(t, map[string]string{
		"big.mdv.yaml":   big,
		"bad.mdv.yaml":   "version: 1\nname: [\n",
		"empty.mdv.yaml": "",
		"ver.mdv.yaml":   "version: 2\n",
	})
	h := s.Handler()
	rec := do(h, "GET", projURL("p", "big.mdv.yaml"))
	wantErr(t, rec, 422, "project_invalid")
	if !strings.Contains(rec.Body.String(), "32 KiB") || strings.Contains(rec.Body.String(), `"line"`) {
		t.Fatalf("size body %s", rec.Body)
	}
	rec = do(h, "GET", projURL("p", "bad.mdv.yaml"))
	wantErr(t, rec, 422, "project_invalid")
	var b errorBody
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	if b.Error.Line < 1 {
		t.Fatalf("no line: %s", rec.Body)
	}
	wantErr(t, do(h, "GET", projURL("p", "empty.mdv.yaml")), 422, "project_invalid")
	rec = do(h, "GET", projURL("p", "ver.mdv.yaml"))
	wantErr(t, rec, 422, "project_invalid")
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	if b.Error.Line != 1 {
		t.Fatalf("version line %d", b.Error.Line)
	}
}

func TestProjectSizeIsCheckedBeforeReading(t *testing.T) {
	dir := writeTree(t, map[string]string{"big.mdv.yaml": strings.Repeat("a", settings.MaxFileSize+1)})
	root, _ := fsroot.OpenRoot(config.Root{Name: "p", Path: dir})
	// Hand out a write-only descriptor: fstat works (and reports the size),
	// but any read fails, which would surface as a 500 instead of the 422.
	h := fsroot.NewHandle("p", config.WatchPoll, &hookFS{FS: root, open: func(f *os.File, _ error) (*os.File, error) {
		_ = f.Close()
		return os.OpenFile(filepath.Join(dir, "big.mdv.yaml"), os.O_WRONLY, 0)
	}}, time.Second, 4, 10)
	s := New(fsroot.NewRegistryFromHandles(h), testConfig(), nil)
	wantErr(t, do(s.Handler(), "GET", projURL("p", "big.mdv.yaml")), 422, "project_invalid")
}

// hookFS lets a test replace the result of Open and Stat.
type hookFS struct {
	fsroot.FS
	open func(*os.File, error) (*os.File, error)
	stat func(string) (fs.FileInfo, error, bool)
}

func (h *hookFS) Open(rel string) (*os.File, error) {
	f, err := h.FS.Open(rel)
	if h.open != nil {
		return h.open(f, err)
	}
	return f, err
}

func (h *hookFS) Stat(rel string) (fs.FileInfo, error) {
	if h.stat != nil {
		if fi, err, ok := h.stat(rel); ok {
			return fi, err
		}
	}
	return h.FS.Stat(rel)
}

func TestProjectNoHostPathLeaks(t *testing.T) {
	const secretMsg = "/srv/very/secret/host"
	dir := writeTree(t, map[string]string{"a.mdv.yaml": "version: 1\ninclude: [x.md, y.md]\n", "x.md": "x"})
	root, _ := fsroot.OpenRoot(config.Root{Name: "p", Path: dir})
	cases := map[string]*hookFS{
		"open error": {FS: root, open: func(*os.File, error) (*os.File, error) {
			return nil, errors.New("open " + secretMsg + ": boom")
		}},
		"closed file": {FS: root, open: func(f *os.File, err error) (*os.File, error) {
			_ = f.Close()
			return f, err
		}},
		"read error": {FS: root, open: func(f *os.File, _ error) (*os.File, error) {
			_ = f.Close()
			return os.OpenFile(filepath.Join(dir, "a.mdv.yaml"), os.O_WRONLY, 0) // stat ok, read fails
		}},
		"stat error": {FS: root, stat: func(rel string) (fs.FileInfo, error, bool) {
			if rel == "x.md" {
				return nil, &fsroot.PathError{Kind: fsroot.KindInternal, Op: "stat", Path: rel, Err: errors.New(secretMsg)}, true
			}
			return nil, errors.New("stat " + secretMsg), true
		}},
	}
	for name, fx := range cases {
		t.Run(name, func(t *testing.T) {
			h := fsroot.NewHandle("p", config.WatchPoll, fx, time.Second, 4, 10)
			var logs bytes.Buffer
			s := New(fsroot.NewRegistryFromHandles(h), testConfig(), slog.New(slog.NewTextHandler(&logs, nil)))
			rec := do(s.Handler(), "GET", projURL("p", "a.mdv.yaml"))
			for _, secret := range []string{secretMsg, dir} {
				if strings.Contains(rec.Body.String(), secret) {
					t.Fatalf("host path leaked: %s", rec.Body)
				}
			}
			// fsError logs raw errors for the other cases; that shared logging is
			// pre-existing and out of scope. The stat phase must never log them.
			if name == "stat error" && (strings.Contains(logs.String(), secretMsg) || strings.Contains(logs.String(), dir)) {
				t.Fatalf("host path in logs: %s", logs.String())
			}
			if name == "stat error" {
				var out projResp
				if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil || len(out.Warnings) != 2 ||
					out.Warnings[0].Code != "unavailable" {
					t.Fatalf("stat error: %d %s", rec.Code, rec.Body)
				}
			} else if rec.Code != 500 && rec.Code != 504 {
				t.Fatalf("status %d: %s", rec.Code, rec.Body)
			}
		})
	}
}

func TestWarnCodeEveryKind(t *testing.T) {
	perm := &fsroot.PathError{Kind: fsroot.KindForbidden, Err: syscall.EACCES}
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"bad request", &fsroot.PathError{Kind: fsroot.KindBadRequest}, "invalid_path"},
		{"forbidden permission", perm, "forbidden"},
		{"forbidden escape", &fsroot.PathError{Kind: fsroot.KindForbidden, Err: errors.New("path escapes from parent")}, "outside_root"},
		{"forbidden bare", &fsroot.PathError{Kind: fsroot.KindForbidden}, "outside_root"},
		{"not found", &fsroot.PathError{Kind: fsroot.KindNotFound}, "missing"},
		{"timeout", &fsroot.PathError{Kind: fsroot.KindTimeout}, "unavailable"},
		{"internal", &fsroot.PathError{Kind: fsroot.KindInternal}, "unavailable"},
		{"unknown kind", &fsroot.PathError{}, "unavailable"},
		{"not a path error", errors.New("boom"), "unavailable"},
		{"wrapped", errors.Join(errors.New("x"), &fsroot.PathError{Kind: fsroot.KindNotFound}), "missing"},
	}
	for _, c := range cases {
		if got := warnCode(c.err); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	// Every fsroot Kind is covered by a row above.
	for _, k := range []fsroot.Kind{fsroot.KindBadRequest, fsroot.KindForbidden, fsroot.KindNotFound, fsroot.KindInternal, fsroot.KindTimeout} {
		if warnCode(&fsroot.PathError{Kind: k}) == "" {
			t.Errorf("kind %v unmapped", k)
		}
	}
}

func TestRefMessages(t *testing.T) {
	for _, code := range []string{"invalid_path", "missing", "forbidden", "outside_root", "not_a_dir", "not_a_file",
		"cross_root_unsupported", "unavailable"} {
		m := refMessage(code, strings.Repeat("é", 300)+"\x01", "")
		if m == "" || len([]rune(m)) > settings.MaxMessageRunes || strings.ContainsRune(m, 1) {
			t.Errorf("%s: %q", code, m)
		}
	}
	if refMessage("invalid_path", "x", "because") != "because" {
		t.Error("reason not used")
	}
}

func TestResolveRefTable(t *testing.T) {
	cases := []struct {
		dir, ref string
		path     string
		code     string
		hint     bool
	}{
		{"", "a.md", "a.md", "", false},
		{"c", "a/b/", "c/a/b", "", true},
		{"c", ".", "c", "", false},
		{"", ".", "", "", false},
		{"", "./", "", "", true},
		{"", "..notes.md", "..notes.md", "", false},
		{"", "../x", "", "outside_root", false},
		{"", "..", "", "outside_root", false},
		{"a", "..", "", "", false},
		{"a", "../..", "", "outside_root", false},
		{"a/b", "../../../x", "", "outside_root", false},
		{"a/b", "../../x", "x", "", false},
		{"", "./../x", "", "outside_root", false},
		{"", "a/../b", "", "invalid_path", false},
		{"", "/abs", "", "invalid_path", false},
		{"", `a\b`, "", "invalid_path", false},
		{"", "a\x01b", "", "invalid_path", false},
		{"", "a\xffb", "", "invalid_path", false},
		{"", "a\u202eb", "", "invalid_path", false},
		{"", "c:foo", "", "cross_root_unsupported", false},
		{"", "c:/foo", "", "cross_root_unsupported", false},
		{"", "docs:a/b.md", "", "cross_root_unsupported", false},
		{"", "http://x/y", "", "cross_root_unsupported", false},
		{"", "C:foo", "C:foo", "", false}, // local; fsroot rejects the drive letter at the root
		{"", "./a:b/c", "a:b/c", "", false},
		{"", "a/b:c", "a/b:c", "", false},
		{"", ":x", ":x", "", false},
		{"", strings.Repeat("a", 33) + ":x", strings.Repeat("a", 33) + ":x", "", false},
	}
	for _, c := range cases {
		got := resolveRef(c.dir, c.ref)
		if got.code != c.code || (c.code == "" && (got.path != c.path || got.dirHint != c.hint)) {
			t.Errorf("resolveRef(%q,%q) = %+v, want path %q code %q hint %v", c.dir, c.ref, got, c.path, c.code, c.hint)
		}
	}
}

func TestProjectWarningsCapAndIncludeCap(t *testing.T) {
	var sb strings.Builder
	sb.WriteString("version: 1\ninclude:\n")
	for i := 0; i < 250; i++ {
		sb.WriteString("  - nope" + strings.Repeat("x", i%7) + "/" + string(rune('a'+i%26)) + "\n")
	}
	s, _ := projectServer(t, map[string]string{"a.mdv.yaml": sb.String()})
	out, rec := getProject(t, s, "a.mdv.yaml")
	if rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	n := len(out.Warnings)
	if n != settings.MaxWarnings+1 || out.Warnings[n-1].Code != "warnings_truncated" {
		t.Fatalf("warnings %d, last %+v", n, out.Warnings[n-1])
	}
	for _, w := range out.Warnings {
		if len([]rune(w.Ref)) > settings.MaxRefRunes || len([]rune(w.Message)) > settings.MaxMessageRunes {
			t.Fatalf("unbounded warning %+v", w)
		}
	}
	// too_many_includes (from the parser) survives in the merged list.
	s2, _ := projectServer(t, map[string]string{"a.mdv.yaml": "version: 1\ninclude:\n" + strings.Repeat("  - a.md\n", 201), "a.md": "x"})
	out, _ = getProject(t, s2, "a.mdv.yaml")
	if !hasWarn(out.Warnings, "too_many_includes", "include") || len(out.Entries) != 1 {
		t.Fatalf("%v %d", warnCodes(out.Warnings), len(out.Entries))
	}
}

func TestProjectParseFailureLog(t *testing.T) {
	dir := writeTree(t, map[string]string{"bad.mdv.yaml": "version: 1\nsecret-content: [\n"})
	cfg := testConfig(config.Root{Name: "p", Path: dir, Watch: config.WatchPoll})
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reg.Close() }()
	var logs bytes.Buffer
	s := New(reg, cfg, slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	wantErr(t, do(s.Handler(), "GET", projURL("p", "bad.mdv.yaml")), 422, "project_invalid")
	out := logs.String()
	if !strings.Contains(out, "project parse failed") || !strings.Contains(out, "code=project_invalid") ||
		strings.Contains(out, "secret-content") || strings.Contains(out, dir) {
		t.Fatalf("log: %s", out)
	}
}

// slowCfg builds a server over a real tree where every non-"." Stat is
// intercepted by stat.
func fakeStatServer(t *testing.T, files map[string]string, fsTimeout time.Duration,
	stat func(rel string) (fs.FileInfo, error, bool)) (*Server, *countFS, string) {
	t.Helper()
	dir := writeTree(t, files)
	root, err := fsroot.OpenRoot(config.Root{Name: "p", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	cf := &countFS{FS: &hookFS{FS: root, stat: stat}}
	h := fsroot.NewHandle("p", config.WatchPoll, cf, fsTimeout, 4, 100)
	cfg := testConfig()
	cfg.FSTimeout = fsTimeout
	return New(fsroot.NewRegistryFromHandles(h), cfg, nil), cf, dir
}

func manyRefs(n int) string {
	var sb strings.Builder
	sb.WriteString("version: 1\ninclude:\n")
	for i := 0; i < n; i++ {
		sb.WriteString("  - r" + string(rune('a'+i/26)) + string(rune('a'+i%26)) + ".md\n")
	}
	return sb.String()
}

func TestProjectConcurrencyBoundAndFileSlot(t *testing.T) {
	const timeout = 800 * time.Millisecond
	release := make(chan struct{})
	var stuck, maxSeen atomic.Int32
	files := map[string]string{"f.md": "file body"}
	for i := 0; i < 8; i++ { // distinct contents: no singleflight sharing
		files["p"+string(rune('a'+i))+".mdv.yaml"] = manyRefs(20) + "# " + string(rune('a'+i)) + "\n"
	}
	s, _, _ := fakeStatServer(t, files, timeout, func(rel string) (fs.FileInfo, error, bool) {
		if rel == "." {
			return nil, nil, false // recovery probe
		}
		n := stuck.Add(1)
		for {
			m := maxSeen.Load()
			if n <= m || maxSeen.CompareAndSwap(m, n) {
				break
			}
		}
		<-release
		stuck.Add(-1)
		return nil, &fsroot.PathError{Kind: fsroot.KindNotFound}, true
	})
	defer close(release)
	h := s.Handler()

	start := time.Now()
	var wg sync.WaitGroup
	recs := make([]*httptest.ResponseRecorder, 24)
	for i := range recs {
		wg.Go(func() { recs[i] = do(h, "GET", projURL("p", "p"+string(rune('a'+i%8))+".mdv.yaml")) })
	}
	deadline := time.Now().Add(5 * time.Second)
	for stuck.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	// While two stats hang, /api/file must still obtain a slot.
	rec := do(h, "GET", fileURL("p", "f.md"))
	if rec.Code != 200 || rec.Body.String() != "file body" {
		t.Fatalf("/api/file during stat storm: %d %s", rec.Code, rec.Body)
	}
	wg.Wait()
	if el := time.Since(start); el > 2*timeout+time.Second {
		t.Fatalf("responses took %v, deadline is %v", el, 2*timeout)
	}
	if m := maxSeen.Load(); m > 2 {
		t.Fatalf("%d stats in flight, limiter is 2", m)
	}
	for i, rec := range recs {
		var out projResp
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
			t.Fatalf("response %d: %d %s", i, rec.Code, rec.Body)
		}
		if !hasWarn(out.Warnings, "unavailable", "include[19]") {
			t.Fatalf("response %d lacks unavailable warnings: %v", i, warnCodes(out.Warnings))
		}
	}
}

func TestProjectStatPhaseDeadline(t *testing.T) {
	const timeout = 250 * time.Millisecond
	s, cf, _ := fakeStatServer(t, map[string]string{"a.mdv.yaml": manyRefs(40)}, timeout, nil)
	cf.delay = 60 * time.Millisecond // each stat succeeds, but 40 of them need > 2*timeout with a limit of 2
	start := time.Now()
	out, rec := getProject(t, s, "a.mdv.yaml")
	if rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	if el := time.Since(start); el > 2*timeout+500*time.Millisecond {
		t.Fatalf("took %v", el)
	}
	var unavailable, missing int
	for _, w := range out.Warnings {
		switch w.Code {
		case "unavailable":
			unavailable++
		case "missing":
			missing++
		}
	}
	if unavailable == 0 || missing == 0 {
		t.Fatalf("want a mix of checked and unchecked items, got unavailable=%d missing=%d", unavailable, missing)
	}
	if got := int(cf.n.Load()); got >= 40 {
		t.Fatalf("all %d stats ran despite the deadline", got)
	}
}

func TestProjectSingleflight(t *testing.T) {
	files := map[string]string{
		"a.mdv.yaml": "version: 1\ninclude: [x.md, y.md, z.md]\n",
		"x.md":       "x", "y.md": "x", "z.md": "x",
	}
	s, cf, dir := fakeStatServer(t, files, time.Second, nil)
	cf.delay = 80 * time.Millisecond
	var clock atomic.Int64
	base := time.Now()
	s.flight.now = func() time.Time { return base.Add(time.Duration(clock.Load())) }
	s.flight.ttl = 2 * time.Second
	h := s.Handler()

	get := func() {
		var wg sync.WaitGroup
		for range 12 {
			wg.Go(func() {
				if rec := do(h, "GET", projURL("p", "a.mdv.yaml")); rec.Code != 200 {
					t.Errorf("status %d", rec.Code)
				}
			})
		}
		wg.Wait()
	}
	get()
	if n := cf.n.Load(); n != 3 {
		t.Fatalf("12 concurrent identical requests cost %d stats, want 3", n)
	}
	get() // within the TTL: served from the shared result
	if n := cf.n.Load(); n != 3 {
		t.Fatalf("within TTL: %d stats, want 3", n)
	}
	clock.Store(int64(3 * time.Second)) // past the TTL
	get()
	if n := cf.n.Load(); n != 6 {
		t.Fatalf("after TTL: %d stats, want 6", n)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.mdv.yaml"),
		[]byte("version: 1\ninclude: [x.md, y.md, z.md]\n# changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	get() // different content hash: a new fan-out even though the TTL has not passed
	if n := cf.n.Load(); n != 9 {
		t.Fatalf("changed content: %d stats, want 9", n)
	}
}

func TestStatFlightCancelDoesNotPoison(t *testing.T) {
	f := newStatFlight(time.Minute)
	gate := make(chan struct{})
	var runs atomic.Int32
	key := flightKey{root: "r", path: "p"}
	fn := func(ctx context.Context) map[string]statRes {
		runs.Add(1)
		<-gate
		if ctx.Err() != nil {
			t.Error("shared work saw the first caller's cancellation")
		}
		return map[string]statRes{"a": {dir: true}}
	}
	ctx1, cancel1 := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() { _, err := f.do(ctx1, key, fn); errc <- err }()
	for runs.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	cancel1()
	if err := <-errc; !errors.Is(err, context.Canceled) {
		t.Fatalf("first caller: %v", err)
	}
	res2 := make(chan map[string]statRes, 1)
	go func() { r, _ := f.do(context.Background(), key, fn); res2 <- r }()
	time.Sleep(10 * time.Millisecond)
	close(gate)
	if r := <-res2; !r["a"].dir {
		t.Fatalf("second caller got %v", r)
	}
	if runs.Load() != 1 {
		t.Fatalf("fn ran %d times", runs.Load())
	}
}

func TestStatFlightBounds(t *testing.T) {
	now := time.Now()
	f := newStatFlight(time.Second)
	f.now = func() time.Time { return now }
	fn := func(context.Context) map[string]statRes { return map[string]statRes{} }
	for i := 0; i < maxFlights+50; i++ {
		if _, err := f.do(context.Background(), flightKey{path: string(rune(0x100 + i))}, fn); err != nil {
			t.Fatal(err)
		}
	}
	f.mu.Lock()
	n := len(f.m)
	f.mu.Unlock()
	if n > maxFlights {
		t.Fatalf("cache grew to %d", n)
	}
	now = now.Add(2 * time.Second) // everything expired: the next call sweeps
	_, _ = f.do(context.Background(), flightKey{path: "fresh"}, fn)
	f.mu.Lock()
	n = len(f.m)
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("expired entries not evicted: %d", n)
	}
	// ttl 0: nothing is kept after completion.
	z := newStatFlight(0)
	_, _ = z.do(context.Background(), flightKey{path: "a"}, fn)
	z.mu.Lock()
	n = len(z.m)
	z.mu.Unlock()
	if n != 0 {
		t.Fatalf("ttl 0 kept %d", n)
	}
}

func TestProjectWarningsTruncatedByParserOnly(t *testing.T) {
	s, _ := projectServer(t, map[string]string{
		"a.mdv.yaml": "version: 1\ninclude:\n" + strings.Repeat("  - \"\"\n", 150)})
	out, rec := getProject(t, s, "a.mdv.yaml")
	if rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	n := len(out.Warnings)
	if n != settings.MaxWarnings+1 || out.Warnings[n-1].Code != "warnings_truncated" {
		t.Fatalf("%d warnings, last %+v", n, out.Warnings[n-1])
	}
}

func TestProjectOpenWithDirHintOnFile(t *testing.T) {
	s, _ := projectServer(t, map[string]string{
		"a.mdv.yaml": "version: 1\nopen: README.md/\n", "README.md": "x"})
	out, _ := getProject(t, s, "a.mdv.yaml")
	if out.Open != nil || !hasWarn(out.Warnings, "not_a_file", "open") {
		t.Fatalf("open %+v warnings %v", out.Open, warnCodes(out.Warnings))
	}
}

func TestProjectClientGoneDuringStatPhase(t *testing.T) {
	release := make(chan struct{})
	var stuck atomic.Int32
	s, _, _ := fakeStatServer(t, map[string]string{"a.mdv.yaml": manyRefs(3)}, time.Second,
		func(rel string) (fs.FileInfo, error, bool) {
			if rel == "." {
				return nil, nil, false
			}
			stuck.Add(1)
			<-release
			return nil, &fsroot.PathError{Kind: fsroot.KindNotFound}, true
		})
	defer close(release)
	var logs bytes.Buffer
	s.logger = slog.New(slog.NewTextHandler(&logs, nil))
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequestWithContext(ctx, "GET", projURL("p", "a.mdv.yaml"), nil)
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { s.Handler().ServeHTTP(rec, req); close(done) }()
	for stuck.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	cancel()
	<-done
	if strings.Contains(logs.String(), "filesystem timeout") || strings.Contains(logs.String(), "level=WARN") {
		t.Fatalf("canceled client logged a warning: %s", logs.String())
	}
}
