package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

const maxFile = 5 << 20

func fixturesDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "testdata", "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "generated", "large.md")); err != nil {
		t.Skip("generated fixtures missing; run `make fixtures`")
	}
	return dir
}

func testConfig(roots ...config.Root) *config.Config {
	return &config.Config{
		Roots: roots, FSTimeout: time.Second, FSMaxInflight: 4,
		MaxListEntries: 1000, MaxFileBytes: maxFile,
	}
}

func newServer(t *testing.T, roots ...config.Root) (*Server, *bytes.Buffer) {
	t.Helper()
	cfg := testConfig(roots...)
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reg.Close() })
	var logs bytes.Buffer
	return New(reg, cfg, slog.New(slog.NewTextHandler(&logs, nil))), &logs
}

func fixtureServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := fixturesDir(t)
	s, _ := newServer(t, config.Root{Name: "fx", Path: dir, Watch: config.WatchPoll})
	return s, dir
}

func do(h http.Handler, method, target string, hdr ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func fileURL(root, p string, extra ...string) string {
	q := url.Values{"root": {root}, "path": {p}}
	for i := 0; i+1 < len(extra); i += 2 {
		q.Set(extra[i], extra[i+1])
	}
	return "/api/file?" + q.Encode()
}

func errCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("not an error body: %q (%v)", rec.Body.String(), err)
	}
	if b.Error.Message == "" {
		t.Fatal("empty error message")
	}
	return b.Error.Code
}

func wantErr(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d; body %q", rec.Code, status, rec.Body.String())
	}
	if got := errCode(t, rec); got != code {
		t.Fatalf("code %q, want %q", got, code)
	}
}

func TestHealthzAndRoots(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	rec := do(h, "GET", "/healthz")
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("healthz %d %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("nosniff missing on healthz")
	}
	rec = do(h, "GET", "/api/roots")
	var out struct {
		Roots []rootJSON `json:"roots"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Roots) != 1 ||
		out.Roots[0] != (rootJSON{"fx", "poll", true}) {
		t.Fatalf("roots %q %v", rec.Body.String(), err)
	}
}

func TestMethodAndUnknownRoute(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	wantErr(t, do(h, "POST", "/api/roots"), 405, "method_not_allowed")
	if rec := do(h, "POST", "/healthz"); rec.Header().Get("Allow") == "" {
		t.Fatal("no Allow header")
	}
	wantErr(t, do(h, "GET", "/api/nope"), 404, "not_found")
	wantErr(t, do(h, "GET", "/api/"), 404, "not_found")
	if rec := do(h, "HEAD", fileURL("fx", "docs/guide.md")); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Fatalf("head %d %d", rec.Code, rec.Body.Len())
	}
}

func TestList(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	rec := do(h, "GET", "/api/list?root=fx")
	if rec.Code != 200 {
		t.Fatalf("status %d %s", rec.Code, rec.Body)
	}
	var l struct {
		Root      string `json:"root"`
		Path      string `json:"path"`
		Truncated bool   `json:"truncated"`
		Entries   []struct {
			Name, Type, Kind, MTime string
			Size                    int64
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil {
		t.Fatal(err)
	}
	if l.Root != "fx" || l.Path != "" || l.Truncated || len(l.Entries) == 0 {
		t.Fatalf("list %+v", l)
	}
	for _, e := range l.Entries {
		if _, err := time.Parse(time.RFC3339Nano, e.MTime); err != nil {
			t.Fatalf("mtime %q: %v", e.MTime, err)
		}
	}
	if !strings.Contains(rec.Body.String(), `"name":"docs","type":"dir","kind":"other"`) {
		t.Fatalf("docs dir missing: %s", rec.Body)
	}
	rec = do(h, "GET", "/api/list?root=fx&path=docs/sub")
	if !strings.Contains(rec.Body.String(), `"path":"docs/sub"`) || !strings.Contains(rec.Body.String(), "deep.md") {
		t.Fatalf("sublist %s", rec.Body)
	}
}

func TestListEmptyDirEntriesNotNull(t *testing.T) {
	dir := t.TempDir()
	s, _ := newServer(t, config.Root{Name: "e", Path: dir, Watch: config.WatchPoll})
	rec := do(s.Handler(), "GET", "/api/list?root=e")
	if !strings.Contains(rec.Body.String(), `"entries":[]`) {
		t.Fatalf("body %s", rec.Body)
	}
}

func TestErrorStatuses(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	cases := []struct {
		name, url string
		status    int
		code      string
	}{
		{"list missing root", "/api/list", 400, "bad_request"},
		{"file missing root", "/api/file?path=a.md", 400, "bad_request"},
		{"unknown root list", "/api/list?root=zz", 404, "not_found"},
		{"unknown root file", "/api/file?root=zz&path=a", 404, "not_found"},
		{"missing file", fileURL("fx", "nope.md"), 404, "not_found"},
		{"missing dir", "/api/list?root=fx&path=nope", 404, "not_found"},
		{"file is dir", fileURL("fx", "docs"), 400, "bad_request"},
		{"file with empty path is root dir", "/api/file?root=fx", 400, "bad_request"},
		{"list on file", "/api/list?root=fx&path=docs/guide.md", 400, "bad_request"},
		{"too large", fileURL("fx", "generated/large.md"), 413, "too_large"},
		{"symlink escape dir", "/api/list?root=fx&path=generated/link-escape", 403, "forbidden"},
		{"symlink escape file", fileURL("fx", "generated/link-escape-file.md"), 403, "forbidden"},
		{"dangling symlink", fileURL("fx", "generated/link-dangling"), 404, "not_found"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := do(h, "GET", c.url)
			wantErr(t, rec, c.status, c.code)
			if strings.HasPrefix(c.url, "/api/file") {
				checkSafeHeaders(t, rec)
			}
		})
	}
}

func checkSafeHeaders(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("nosniff missing (status %d)", rec.Code)
	}
	if rec.Header().Get("Content-Security-Policy") != fileCSP {
		t.Fatalf("CSP missing (status %d)", rec.Code)
	}
}

func TestTraversalOverHTTP(t *testing.T) {
	s, dir := fixtureServer(t)
	h := s.Handler()
	targets := []string{
		"../README.md", "docs/../../README.md", "..", "docs/..", "./docs/guide.md/..",
		"/etc/passwd", "\\etc\\passwd", "docs\\guide.md", "C:/Windows", "a\x00b", "docs/guide.md\x00.png",
		"%2e%2e/README.md", "docs/%2e%2e/guide.md", "..%2fREADME.md",
	}
	for _, p := range targets {
		for _, ep := range []string{"/api/file", "/api/list"} {
			// Query-encoded once by url.Values: the server sees the literal text.
			rec := do(h, "GET", ep+"?"+url.Values{"root": {"fx"}, "path": {p}}.Encode())
			if rec.Code != 400 && rec.Code != 403 && rec.Code != 404 {
				t.Errorf("%s %q -> %d", ep, p, rec.Code)
			}
			if rec.Code == 200 {
				t.Errorf("%s %q served", ep, p)
			}
			if strings.Contains(rec.Body.String(), dir) {
				t.Errorf("host path leaked for %q", p)
			}
		}
	}
	// Raw (single-encoded) query forms, decoded once by the server.
	raw := []string{
		"/api/file?root=fx&path=%2e%2e/README.md",
		"/api/file?root=fx&path=..%2fREADME.md",
		"/api/file?root=fx&path=%2Fetc%2Fpasswd",
		"/api/file?root=fx&path=a%00b",
		"/api/file?root=fx&path=docs%5Cguide.md",
		"/api/list?root=fx&path=%2e%2e",
	}
	for _, u := range raw {
		rec := do(h, "GET", u)
		if rec.Code != 400 {
			t.Errorf("%s -> %d, want 400", u, rec.Code)
		}
		checkNoRoot(t, rec, dir)
	}
	// Double-encoded dots are a literal name and simply do not exist.
	wantErr(t, do(h, "GET", "/api/file?root=fx&path=%252e%252e/README.md"), 404, "not_found")
}

func checkNoRoot(t *testing.T, rec *httptest.ResponseRecorder, dir string) {
	t.Helper()
	var all strings.Builder
	all.WriteString(rec.Body.String())
	for k, v := range rec.Header() {
		all.WriteString(k + ": " + strings.Join(v, ",") + "\n")
	}
	if strings.Contains(all.String(), dir) || strings.Contains(all.String(), filepath.Dir(dir)) {
		t.Fatalf("host path leaked: %s", all.String())
	}
}

func TestFileServing(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"a.md": "# hi", "A.MD": "# hi", "p.XHTML": "<html/>", "p.xhtml": "<html/>", "p.htm": "<html/>",
		"p.html": "<script>1</script>", "p.shtml": "x", "d.xml": "<a/>", "s.xsl": "<a/>",
		"i.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>", "i.png": "\x89PNG", "i.JPG": "jpg",
		"i.webp": "w", "i.avif": "a", "i.gif": "g", "i.jpeg": "j",
		"x.unknownext": "data", "noext": "data", "c.go": "package x", "d.mmd": "graph TD",
		"sp ace é.bin": "data", "p.html.": "x", "x.md.html": "x", "x.html.md": "x", ".hidden": "x",
	}
	for n, c := range files {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(c), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	s, _ := newServer(t, config.Root{Name: "t", Path: dir, Watch: config.WatchPoll})
	h := s.Handler()
	for name, want := range map[string]struct {
		ct   string
		disp bool
	}{
		"a.md": {"text/plain; charset=utf-8", false}, "A.MD": {"text/plain; charset=utf-8", false},
		"c.go": {"text/plain; charset=utf-8", false}, "d.mmd": {"text/plain; charset=utf-8", false},
		"i.svg": {"image/svg+xml", false}, "i.png": {"image/png", false}, "i.JPG": {"image/jpeg", false},
		"i.jpeg": {"image/jpeg", false}, "i.webp": {"image/webp", false}, "i.avif": {"image/avif", false},
		"i.gif":   {"image/gif", false},
		"p.xhtml": {mimeOctet, true}, "p.XHTML": {mimeOctet, true}, "p.htm": {mimeOctet, true},
		"p.html": {mimeOctet, true}, "p.shtml": {mimeOctet, true}, "d.xml": {mimeOctet, true},
		"s.xsl": {mimeOctet, true}, "x.unknownext": {mimeOctet, true}, "noext": {mimeOctet, true},
		"sp ace é.bin": {mimeOctet, true}, "p.html.": {mimeOctet, true}, "x.md.html": {mimeOctet, true},
		"x.html.md": {"text/plain; charset=utf-8", false}, ".hidden": {mimeOctet, true},
	} {
		rec := do(h, "GET", fileURL("t", name))
		if rec.Code != 200 {
			t.Errorf("%s: status %d", name, rec.Code)
			continue
		}
		if got := rec.Header().Get("Content-Type"); got != want.ct {
			t.Errorf("%s: content-type %q, want %q", name, got, want.ct)
		}
		if (rec.Header().Get("Content-Disposition") != "") != want.disp {
			t.Errorf("%s: disposition %q", name, rec.Header().Get("Content-Disposition"))
		}
		checkSafeHeaders(t, rec)
		if rec.Header().Get("Cache-Control") != "no-cache" || rec.Body.String() != files[name] {
			t.Errorf("%s: cache %q body %q", name, rec.Header().Get("Cache-Control"), rec.Body)
		}
	}
	rec := do(h, "GET", fileURL("t", "sp ace é.bin"))
	want := `attachment; filename="sp ace __.bin"; filename*=UTF-8''sp%20ace%20%C3%A9.bin`
	if got := rec.Header().Get("Content-Disposition"); got != want {
		t.Errorf("disposition %q, want %q", got, want)
	}
}

func TestETagRangeAndConditional(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	u := fileURL("fx", "docs/guide.md")
	rec := do(h, "GET", u)
	etag := rec.Header().Get("ETag")
	parts := strings.Split(strings.Trim(etag, `"`), "-")
	if len(parts) != 3 || !strings.HasPrefix(etag, `"`) || strings.HasPrefix(etag, `W/`) {
		t.Fatalf("etag %q", etag)
	}
	for _, p := range parts {
		if _, err := strconv.ParseUint(p, 10, 64); err != nil {
			t.Fatalf("etag part %q: %v", p, err)
		}
	}
	if rec.Header().Get("Last-Modified") == "" || rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("headers %v", rec.Header())
	}
	full := rec.Body.String()

	r2 := do(h, "GET", u, "If-None-Match", etag)
	if r2.Code != 304 || r2.Body.Len() != 0 {
		t.Fatalf("conditional %d", r2.Code)
	}
	checkSafeHeaders(t, r2)
	if r2.Header().Get("Cache-Control") != "no-cache" {
		t.Fatal("no cache-control on 304")
	}

	r3 := do(h, "GET", u, "Range", "bytes=2-5")
	if r3.Code != 206 || r3.Body.String() != full[2:6] ||
		r3.Header().Get("Content-Range") != "bytes 2-5/"+strconv.Itoa(len(full)) {
		t.Fatalf("range %d %q %q", r3.Code, r3.Body, r3.Header().Get("Content-Range"))
	}
	checkSafeHeaders(t, r3)
	r4 := do(h, "GET", u, "Range", "bytes=-3")
	if r4.Code != 206 || r4.Body.String() != full[len(full)-3:] {
		t.Fatalf("suffix range %d %q", r4.Code, r4.Body)
	}
	r5 := do(h, "GET", u, "Range", "bytes=99999999-")
	if r5.Code != 416 {
		t.Fatalf("unsatisfiable %d", r5.Code)
	}
}

func TestForceLargeText(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	rec := do(h, "GET", fileURL("fx", "generated/large.md", "force", "1"))
	if rec.Code != 200 || rec.Body.Len() < 6<<20 {
		t.Fatalf("force: %d len %d", rec.Code, rec.Body.Len())
	}
	// Symlink inside the root is served; NFC request finds the NFD name.
	if rec := do(h, "GET", fileURL("fx", "generated/link-inside.md")); rec.Code != 200 {
		t.Fatalf("inside symlink %d", rec.Code)
	}
	if rec := do(h, "GET", fileURL("fx", "generated/caf\u00e9.md")); rec.Code != 200 {
		t.Fatalf("nfc %d", rec.Code)
	}
}

func TestLargeNonTextNotLimited(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "big.png"), make([]byte, 2048), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := testConfig(config.Root{Name: "t", Path: dir, Watch: config.WatchPoll})
	cfg.MaxFileBytes = 10
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reg.Close() }()
	h := New(reg, cfg, nil).Handler()
	if rec := do(h, "GET", fileURL("t", "big.png")); rec.Code != 200 {
		t.Fatalf("png %d", rec.Code)
	}
}

// blockFS is an fsroot.FS whose calls block until release is closed or fail
// with a configured error.
type blockFS struct {
	release chan struct{}
	err     error
}

func (b *blockFS) wait() {
	if b.release != nil {
		<-b.release
	}
}

func (b *blockFS) Stat(string) (fs.FileInfo, error) {
	b.wait()
	return nil, b.err
}
func (b *blockFS) Lstat(string) (fs.FileInfo, error) { b.wait(); return nil, b.err }
func (b *blockFS) ReadDir(string) ([]fs.DirEntry, error) {
	b.wait()
	return nil, b.err
}
func (b *blockFS) Open(string) (*os.File, error) { b.wait(); return nil, b.err }

func TestTimeoutAndUnavailable(t *testing.T) {
	good := t.TempDir()
	bfs := &blockFS{release: make(chan struct{})}
	defer close(bfs.release)
	dead := fsroot.NewHandle("dead", config.WatchPoll, bfs, 20*time.Millisecond, 2, 10)
	cfg := testConfig()
	cfg.MaxFileBytes = maxFile
	okHandle, err := fsroot.OpenHandle(config.Root{Name: "ok", Path: good, Watch: config.WatchFSNotify}, testConfig())
	if err != nil {
		t.Fatal(err)
	}
	reg := fsroot.NewRegistryFromHandles(okHandle, dead)
	defer func() { _ = reg.Close() }()
	h := New(reg, cfg, nil).Handler()

	wantErr(t, do(h, "GET", "/api/list?root=dead"), 504, "fs_timeout")
	wantErr(t, do(h, "GET", fileURL("dead", "x.md")), 504, "fs_timeout")
	if rec := do(h, "GET", "/healthz"); rec.Code != 200 {
		t.Fatalf("healthz with dead root %d", rec.Code)
	}
	rec := do(h, "GET", "/api/roots")
	var out struct {
		Roots []rootJSON `json:"roots"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Roots) != 2 ||
		!out.Roots[0].Available || out.Roots[1].Available || out.Roots[1].Watch != "poll" {
		t.Fatalf("roots %s", rec.Body)
	}
	// The healthy root keeps working.
	if rec := do(h, "GET", "/api/list?root=ok"); rec.Code != 200 {
		t.Fatalf("healthy root %d", rec.Code)
	}
}

func TestInternalErrors(t *testing.T) {
	secret := "/srv/secret/host/path"
	cases := map[string]error{
		"plain":     errors.New("open " + secret + ": boom"),
		"pathError": &fsroot.PathError{Kind: fsroot.KindInternal, Op: "stat", Path: "x", Err: errors.New(secret)},
	}
	for name, e := range cases {
		t.Run(name, func(t *testing.T) {
			handle := fsroot.NewHandle("b", config.WatchPoll, &blockFS{err: e}, time.Second, 2, 10)
			reg := fsroot.NewRegistryFromHandles(handle)
			var logs bytes.Buffer
			h := New(reg, testConfig(), slog.New(slog.NewTextHandler(&logs, nil))).Handler()
			for _, u := range []string{"/api/list?root=b&path=x", fileURL("b", "x.md")} {
				rec := do(h, "GET", u)
				wantErr(t, rec, 500, "internal")
				if strings.Contains(rec.Body.String(), secret) {
					t.Fatalf("secret leaked: %s", rec.Body)
				}
			}
			if !strings.Contains(logs.String(), "secret") {
				t.Fatalf("details not logged: %s", logs.String())
			}
		})
	}
}

func TestNoHostPathLeaks(t *testing.T) {
	s, dir := fixtureServer(t)
	h := s.Handler()
	urls := []string{
		"/api/list", "/api/list?root=zz", "/api/list?root=fx&path=nope",
		"/api/list?root=fx&path=generated/link-escape", "/api/list?root=fx&path=docs/guide.md",
		"/api/list?root=fx&path=..", "/api/file?root=fx", fileURL("fx", "nope"), fileURL("fx", "docs"),
		fileURL("fx", "generated/large.md"), fileURL("fx", "generated/link-escape-file.md"),
		fileURL("fx", "generated/link-dangling"), fileURL("fx", "../x"), fileURL("fx", "html/page.html"),
		"/api/nope", "/api/roots", "/healthz",
	}
	for _, u := range urls {
		checkNoRoot(t, do(h, "GET", u), dir)
	}
	checkNoRoot(t, do(h, "POST", "/api/list?root=fx"), dir)
}

func TestRecoverAndLogging(t *testing.T) {
	s, logs := newServer(t, config.Root{Name: "t", Path: t.TempDir(), Watch: config.WatchPoll})
	s.Mux().HandleFunc("/boom", func(http.ResponseWriter, *http.Request) { panic("kaboom /host/path") })
	s.Mux().HandleFunc("/late", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("partial"))
		panic("late")
	})
	h := s.Handler()
	rec := do(h, "GET", "/boom")
	wantErr(t, rec, 500, "internal")
	if strings.Contains(rec.Body.String(), "kaboom") || !strings.Contains(logs.String(), "kaboom") ||
		!strings.Contains(logs.String(), "stack") {
		t.Fatalf("body %q logs %q", rec.Body, logs)
	}
	// A panic after the body started aborts the connection.
	func() {
		defer func() {
			if r := recover(); r != http.ErrAbortHandler { //nolint:errorlint // sentinel compared by identity
				t.Fatalf("recovered %v, want http.ErrAbortHandler", r)
			}
		}()
		do(h, "GET", "/late")
	}()
	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/late")
	if err == nil {
		_, err = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
	}
	if err == nil {
		t.Fatal("client saw a clean response after a mid-body panic")
	}
	do(h, "GET", "/api/roots")
	for _, want := range []string{"method=GET", "path=/api/roots", "status=200", "bytes=", "duration="} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log missing %q: %s", want, logs)
		}
	}
}

func TestNilLoggerAndContext(t *testing.T) {
	s := New(fsroot.NewRegistryFromHandles(), testConfig(), nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest("GET", "/healthz", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatal(rec.Code)
	}
}

func TestContentDisposition(t *testing.T) {
	got := contentDisposition("a\"b\\c;d%e\n.html")
	want := `attachment; filename="a_b_c_d_e_.html"; filename*=UTF-8''a%22b%5Cc%3Bd%25e%0A.html`
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestFileHeadersOn405AndHeadAndIMS(t *testing.T) {
	s, _ := fixtureServer(t)
	h := s.Handler()
	rec := do(h, "POST", fileURL("fx", "docs/guide.md"))
	wantErr(t, rec, 405, "method_not_allowed")
	checkSafeHeaders(t, rec)

	u := fileURL("fx", "docs/guide.md")
	head := do(h, "HEAD", u)
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("ETag") == "" ||
		head.Header().Get("Content-Length") == "" {
		t.Fatalf("head %d %v", head.Code, head.Header())
	}
	checkSafeHeaders(t, head)

	lm := head.Header().Get("Last-Modified")
	ims := do(h, "GET", u, "If-Modified-Since", lm)
	if ims.Code != 304 {
		t.Fatalf("if-modified-since %d", ims.Code)
	}
	checkSafeHeaders(t, ims)
}

func TestFlushThroughMiddleware(t *testing.T) {
	s, logs := newServer(t, config.Root{Name: "t", Path: t.TempDir(), Watch: config.WatchPoll})
	var flushErr error
	s.Mux().HandleFunc("/flush", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusEarlyHints) // 1xx must not become the logged status
		flushErr = http.NewResponseController(w).Flush()
		_, _ = w.Write([]byte("x"))
	})
	rec := do(s.Handler(), "GET", "/flush")
	if flushErr != nil || !rec.Flushed || !strings.Contains(logs.String(), "status=200") {
		t.Fatalf("flush err %v flushed %v logs %s", flushErr, rec.Flushed, logs)
	}
}

func TestParallelFetchesExceedingCap(t *testing.T) {
	dir := t.TempDir()
	const n = 12
	bodies := make([][]byte, n)
	for i := range bodies {
		bodies[i] = bytes.Repeat([]byte{byte('a' + i)}, 300<<10+i)
		if err := os.WriteFile(filepath.Join(dir, "f"+strconv.Itoa(i)+".png"), bodies[i], 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cfg := testConfig(config.Root{Name: "t", Path: dir, Watch: config.WatchPoll})
	cfg.FSMaxInflight = 1
	cfg.FSTimeout = 10 * time.Second
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reg.Close() }()
	srv := httptest.NewServer(New(reg, cfg, nil).Handler())
	defer srv.Close()

	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := http.Get(srv.URL + fileURL("t", "f"+strconv.Itoa(i)+".png"))
			if err != nil {
				errs <- err
				return
			}
			defer func() { _ = resp.Body.Close() }()
			got, err := io.ReadAll(resp.Body)
			if err != nil || resp.StatusCode != 200 || !bytes.Equal(got, bodies[i]) {
				errs <- errors.New("file " + strconv.Itoa(i) + ": status " + resp.Status + " len " +
					strconv.Itoa(len(got)) + " err " + errString(err))
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func errString(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}
