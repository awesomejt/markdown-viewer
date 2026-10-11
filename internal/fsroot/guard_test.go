package fsroot

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

const fixtures = "../../testdata/fixtures"

func openFixtures(t *testing.T) *Root {
	t.Helper()
	r, err := OpenRoot(config.Root{Name: "fx", Path: fixtures})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func assertNoHostPath(t *testing.T, err error) {
	t.Helper()
	abs, aerr := filepath.Abs(fixtures)
	if aerr != nil {
		t.Fatal(aerr)
	}
	var pe *PathError
	if !errors.As(err, &pe) {
		t.Fatalf("not a PathError: %v", err)
	}
	if m := pe.PublicMessage(); strings.Contains(m, abs) || strings.Contains(m, "fixtures") {
		t.Fatalf("PublicMessage leaks host path: %q", m)
	}
}

func TestPublicMessage(t *testing.T) {
	r := openFixtures(t)
	_, err := r.ReadDir("README.md")
	var pe *PathError
	if !errors.As(err, &pe) {
		t.Fatal(err)
	}
	abs, _ := filepath.Abs(fixtures)
	if !strings.Contains(pe.Error(), abs) {
		t.Logf("note: Error() has no host path: %v", pe)
	}
	if got := pe.PublicMessage(); got != `not_found: "README.md"` {
		t.Fatalf("PublicMessage = %q", got)
	}
	_, err = r.Open("a\x00b")
	if !errors.As(err, &pe) || pe.PublicMessage() != `bad_request: "a\x00b" (control character)` {
		t.Fatalf("PublicMessage = %v", err)
	}
}

func TestResolve(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
		kind Kind // 0 = success
	}{
		{"empty is root", "", ".", 0},
		{"dot is root", ".", ".", 0},
		{"leading dot slash", "./docs/guide.md", "docs/guide.md", 0},
		{"duplicate slashes", "docs//guide.md", "docs/guide.md", 0},
		{"trailing slash", "docs/", "docs", 0},
		{"dot segment", "docs/./guide.md", "docs/guide.md", 0},
		{"spaces", "name with spaces.md", "name with spaces.md", 0},
		{"unicode", "Unicode Ünïcödé name.md", "Unicode Ünïcödé name.md", 0},
		{"dotfile", ".dotfile.md", ".dotfile.md", 0},
		{"literal percent-encoded dots", "%2e%2e/x", "%2e%2e/x", 0},
		{"dots in name", "..foo/a..b", "..foo/a..b", 0},
		{"colon not drive", "ab:c", "ab:c", 0},
		{"digit colon", "1:", "1:", 0},
		{"literal %2F", "a%2Fb", "a%2Fb", 0},
		{"literal %00", "a%00b", "a%00b", 0},
		{"literal %5C", "a%5Cb", "a%5Cb", 0},
		{"double encoded", "%252e%252e/x", "%252e%252e/x", 0},
		{"three dots", "...", "...", 0},
		{"four dots", "....", "....", 0},
		{"trailing dot", "name.", "name.", 0},
		{"trailing space", "name ", "name ", 0},
		{"fullwidth dots", "．．/x", "．．/x", 0},
		{"two dot leader", "‥/x", "‥/x", 0},
		{"double slash absolute", "//etc/passwd", "", KindBadRequest},
		{"too long", strings.Repeat("a", 4097), "", KindBadRequest},
		{"max length ok", strings.Repeat("a", 4096), strings.Repeat("a", 4096), 0},
		{"C1 control", "a\u0085b", "", KindBadRequest},
		{"bidi RLO", "a\u202eb", "", KindBadRequest},
		{"bidi LRM", "a\u200eb", "", KindBadRequest},
		{"bidi isolate", "a\u2067b", "", KindBadRequest},
		{"NUL", "a\x00b", "", KindBadRequest},
		{"NUL only", "\x00", "", KindBadRequest},
		{"newline", "a\nb", "", KindBadRequest},
		{"DEL", "a\x7fb", "", KindBadRequest},
		{"absolute", "/etc/passwd", "", KindBadRequest},
		{"root slash", "/", "", KindBadRequest},
		{"backslash", `docs\guide.md`, "", KindBadRequest},
		{"backslash dotdot", `..\x`, "", KindBadRequest},
		{"dotdot", "..", "", KindBadRequest},
		{"dotdot x", "../x", "", KindBadRequest},
		{"a dotdot dotdot", "a/../..", "", KindBadRequest},
		{"docs dotdot", "docs/..", "", KindBadRequest},
		{"inner dotdot", "a/../b", "", KindBadRequest},
		{"trailing dotdot slash", "a/../", "", KindBadRequest},
		{"dot dotdot", "./..", "", KindBadRequest},
		{"invalid utf8", "a\xffb", "", KindBadRequest},
		{"drive letter", "C:", "", KindBadRequest},
		{"drive letter lower path", "c:/windows", "", KindBadRequest},
		{"drive relative", "C:foo", "", KindBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve(tt.in)
			if tt.kind == 0 {
				if err != nil || got != tt.want {
					t.Fatalf("Resolve(%q) = %q, %v; want %q", tt.in, got, err, tt.want)
				}
				return
			}
			if KindOf(err) != tt.kind || !errors.Is(err, ErrBadRequest) {
				t.Fatalf("Resolve(%q) err = %v; want bad request", tt.in, err)
			}
		})
	}
}

func TestRootAccess(t *testing.T) {
	r := openFixtures(t)
	if r.Name() != "fx" {
		t.Fatalf("Name = %q", r.Name())
	}
	tests := []struct {
		name string
		path string
		dir  bool
		kind Kind // 0 = ok
	}{
		{"root empty", "", true, 0},
		{"root dot", ".", true, 0},
		{"file", "README.md", false, 0},
		{"dir", "docs", true, 0},
		{"dir trailing slash", "docs/", true, 0},
		{"nested", "docs/guide.md", false, 0},
		{"leading dot slash", "./docs/guide.md", false, 0},
		{"spaces", "name with spaces.md", false, 0},
		{"unicode", "Unicode Ünïcödé name.md", false, 0},
		{"dotfile", ".dotfile.md", false, 0},
		{"hidden dir", ".hidden", true, 0},
		{"symlink inside file", "generated/link-inside.md", false, 0},
		{"symlink inside dir", "generated/link-dir", true, 0},
		{"through inside dir symlink", "generated/link-dir/guide.md", false, 0},
		{"escape dir symlink (absolute)", "generated/link-escape", false, KindForbidden},
		{"through escape symlink", "generated/link-escape/passwd", false, KindForbidden},
		{"escape file symlink (relative)", "generated/link-escape-file.md", false, KindForbidden},
		{"dangling symlink", "generated/link-dangling", false, KindNotFound},
		{"missing", "nope.md", false, KindNotFound},
		{"missing nested", "docs/nope/x.md", false, KindNotFound},
		{"file as dir", "README.md/x", false, KindNotFound},
		{"percent-encoded dots literal", "%2e%2e/etc/passwd", false, KindNotFound},
		{"literal %2F", "a%2Fb", false, KindNotFound},
		{"literal %00", "a%00b", false, KindNotFound},
		{"literal %5C", "a%5Cb", false, KindNotFound},
		{"double encoded", "%252e%252e/x", false, KindNotFound},
		{"three dots", "...", false, KindNotFound},
		{"four dots", "....", false, KindNotFound},
		{"trailing dot", "README.md.", false, KindNotFound},
		{"trailing space", "README.md ", false, KindNotFound},
		{"fullwidth dots", "．．/x", false, KindNotFound},
		{"two dot leader", "‥/x", false, KindNotFound},
		{"double slash absolute", "//etc/passwd", false, KindBadRequest},
		{"too long", strings.Repeat("a", 4097), false, KindBadRequest},
		{"component too long", strings.Repeat("a", 300), false, KindBadRequest},
		{"NUL", "a\x00b", false, KindBadRequest},
		{"absolute", "/etc/passwd", false, KindBadRequest},
		{"backslash", `docs\guide.md`, false, KindBadRequest},
		{"dotdot", "..", false, KindBadRequest},
		{"dotdot x", "../x", false, KindBadRequest},
		{"a dotdot dotdot", "docs/../..", false, KindBadRequest},
		{"docs dotdot", "docs/..", false, KindBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			check := func(op string, err error) {
				t.Helper()
				if KindOf(err) != tt.kind {
					t.Fatalf("%s(%q) err = %v; want kind %v", op, tt.path, err, tt.kind)
				}
				if tt.kind != 0 {
					var pe *PathError
					if !errors.As(err, &pe) || pe.Path != tt.path || pe.Error() == "" {
						t.Fatalf("%s: bad PathError %v", op, err)
					}
					assertNoHostPath(t, pe)
				}
			}
			f, err := r.Open(tt.path)
			check("Open", err)
			if err == nil {
				_ = f.Close()
			}
			fi, err := r.Stat(tt.path)
			check("Stat", err)
			if err == nil && fi.IsDir() != tt.dir {
				t.Fatalf("Stat IsDir = %v, want %v", fi.IsDir(), tt.dir)
			}
			_, err = r.ReadDir(tt.path)
			if err != nil {
				assertNoHostPath(t, err)
			}
			if tt.kind == 0 && !tt.dir {
				if KindOf(err) != KindNotFound {
					t.Fatalf("ReadDir on file: err = %v; want not_found", err)
				}
			} else {
				check("ReadDir", err)
			}
		})
	}
}

func TestLstat(t *testing.T) {
	r := openFixtures(t)
	// Lstat does not follow the final symlink, so even escaping or dangling
	// links are describable; intermediate escapes are still refused.
	for _, p := range []string{"generated/link-escape", "generated/link-escape-file.md", "generated/link-dangling", "generated/link-inside.md"} {
		fi, err := r.Lstat(p)
		if err != nil || fi.Mode()&os.ModeSymlink == 0 {
			t.Errorf("Lstat(%q) = %v, %v; want symlink", p, fi, err)
		}
	}
	if _, err := r.Lstat("docs/guide.md"); err != nil {
		t.Error(err)
	}
	cases := map[string]Kind{
		"generated/link-escape/passwd": KindForbidden,
		"nope":                         KindNotFound,
		"../x":                         KindBadRequest,
	}
	for p, k := range cases {
		if _, err := r.Lstat(p); KindOf(err) != k {
			t.Errorf("Lstat(%q) err = %v; want kind %v", p, err, k)
		}
	}
}

func TestReadDirContents(t *testing.T) {
	r := openFixtures(t)
	ents, err := r.ReadDir("docs")
	if err != nil || len(ents) == 0 {
		t.Fatalf("ReadDir(docs) = %v, %v", ents, err)
	}
	if _, err := r.Resolve("a/../b"); KindOf(err) != KindBadRequest {
		t.Fatalf("method Resolve: %v", err)
	}
}

func TestTempDirRoot(t *testing.T) {
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("s"), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	root := filepath.Join(dir, "root")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "ok.md"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	links := map[string]string{
		"abs-file":     filepath.Join(outside, "secret.txt"),
		"abs-dir":      outside,
		"rel-up":       "../../" + filepath.Base(outside),
		"sub/up-file":  "../../" + filepath.Base(outside) + "/secret.txt",
		"loop":         "loop",
		"inside-up-ok": "sub/../sub/ok.md",
		"sub/to-top":   "../sub/ok.md",
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	// A directory symlink pointing at the root's parent.
	if err := os.Symlink("..", filepath.Join(root, "up")); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRoot(config.Root{Name: "tmp", Path: root})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Close() }()

	cases := map[string]Kind{
		"sub/ok.md":          0,
		"inside-up-ok":       0,
		"sub/to-top":         0,
		"abs-file":           KindForbidden,
		"abs-dir":            KindForbidden,
		"abs-dir/secret.txt": KindForbidden,
		"rel-up":             KindForbidden,
		"sub/up-file":        KindForbidden,
		"up/root/sub/ok.md":  KindForbidden,
		"up/secret.txt":      KindForbidden,
		"up/sub":             KindForbidden,
		"loop":               KindNotFound,
		"sub/missing":        KindNotFound,
	}
	for p, k := range cases {
		f, err := r.Open(p)
		if f != nil {
			_ = f.Close()
		}
		if KindOf(err) != k {
			t.Errorf("Open(%q) err = %v; want kind %v", p, err, k)
		}
		if _, err := r.Stat(p); KindOf(err) != k {
			t.Errorf("Stat(%q) err = %v; want kind %v", p, err, k)
		}
	}
	// Lstat does not follow the final symlink, so only intermediate escapes fail.
	for p, k := range map[string]Kind{"abs-dir/secret.txt": KindForbidden, "up/secret.txt": KindForbidden, "abs-file": 0, "loop": 0, "sub/missing": KindNotFound} {
		if _, err := r.Lstat(p); KindOf(err) != k {
			t.Errorf("Lstat(%q) err = %v; want kind %v", p, err, k)
		}
	}

	// Permission denied maps to forbidden (skipped when running as root).
	denied := filepath.Join(root, "denied")
	if err := os.Mkdir(denied, 0o000); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chmod(denied, 0o700) }() //nolint:gosec // restore so TempDir cleanup works
	if os.Geteuid() != 0 {
		if _, err := r.ReadDir("denied"); KindOf(err) != KindForbidden {
			t.Errorf("ReadDir(denied) err = %v; want forbidden", err)
		}
	}
}

func TestOpenRootErrors(t *testing.T) {
	if _, err := OpenRoot(config.Root{Name: "x", Path: filepath.Join(t.TempDir(), "missing")}); err == nil {
		t.Fatal("expected error for missing root")
	}
}

func TestKindAndErrors(t *testing.T) {
	for k, want := range map[Kind]string{
		KindBadRequest: "bad_request", KindForbidden: "forbidden",
		KindNotFound: "not_found", KindInternal: "internal", 0: "unknown",
	} {
		if k.String() != want {
			t.Errorf("Kind(%d) = %q, want %q", k, k.String(), want)
		}
	}
	if KindOf(errors.New("x")) != 0 {
		t.Error("KindOf non-PathError should be 0")
	}
	other := mapErr("stat", "p", errors.New("boom"))
	if KindOf(other) != KindInternal || !errors.Is(other, ErrInternal) {
		t.Errorf("unexpected err mapping: %v", other)
	}
	if !errors.Is(mapErr("stat", "p", os.ErrNotExist), ErrNotFound) {
		t.Error("not exist should be ErrNotFound")
	}
	if !errors.Is(mapErr("stat", "p", os.ErrPermission), ErrForbidden) {
		t.Error("permission should be ErrForbidden")
	}
}

// TestEscapeErrorContract pins the os.Root behaviour mapErr relies on.
func TestEscapeErrorContract(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "r")
	if err := os.Mkdir(root, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/", filepath.Join(root, "l")); err != nil {
		t.Fatal(err)
	}
	or, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = or.Close() }()
	_, err = or.Stat("l")
	if err == nil || KindOf(mapErr("stat", "l", err)) != KindForbidden {
		t.Fatalf("os.Root escape error no longer recognised: %v", err)
	}
}

func TestSpecialFiles(t *testing.T) {
	root := t.TempDir()
	if err := syscall.Mkfifo(filepath.Join(root, "fifo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("fifo", filepath.Join(root, "link-fifo")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ok.md"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRoot(config.Root{Name: "t", Path: root})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Close() }()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, p := range []string{"fifo", "link-fifo"} {
			f, err := r.Open(p)
			if f != nil {
				_ = f.Close()
			}
			if KindOf(err) != KindForbidden {
				t.Errorf("Open(%q) err = %v; want forbidden", p, err)
			}
			if _, err := r.ReadDir(p); KindOf(err) != KindForbidden {
				t.Errorf("ReadDir(%q) err = %v; want forbidden", p, err)
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Open on FIFO blocked")
	}

	f, err := r.Open("ok.md")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(f)
	if err != nil || string(b) != "hello" {
		t.Fatalf("read = %q, %v", b, err)
	}
}
