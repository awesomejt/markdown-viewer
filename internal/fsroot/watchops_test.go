package fsroot

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

func openTemp(t *testing.T) (*Handle, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{FSTimeout: time.Second, FSMaxInflight: 4, MaxListEntries: 100}
	h, err := OpenHandle(config.Root{Name: "r", Path: dir, Watch: config.WatchPoll}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	return h, dir
}

func TestReadNames(t *testing.T) {
	h, dir := openTemp(t)
	for _, n := range []string{"b.md", "a.md"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
		t.Fatal(err)
	}
	st, err := h.ReadNames(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"a.md", "b.md", "sub"}; !reflect.DeepEqual(st.Names, want) {
		t.Fatalf("names = %v, want %v", st.Names, want)
	}
	if st.ModTime.IsZero() {
		t.Fatal("zero mtime")
	}
	if _, err := h.ReadNames(context.Background(), "a.md"); KindOf(err) != KindBadRequest {
		t.Fatalf("file: want bad request, got %v", err)
	}
	if _, err := h.ReadNames(context.Background(), "nope"); KindOf(err) != KindNotFound {
		t.Fatalf("missing: want not found, got %v", err)
	}
	if _, err := h.ReadNames(context.Background(), "../x"); KindOf(err) != KindBadRequest {
		t.Fatalf("traversal: want bad request, got %v", err)
	}
}

func TestHostPath(t *testing.T) {
	h, dir := openTemp(t)
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "f.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	p, fi, err := h.HostPath(context.Background(), "sub/f.md")
	if err != nil || fi.IsDir() || p != filepath.Join(dir, "sub", "f.md") {
		t.Fatalf("got %q %v %v", p, fi, err)
	}
	p, fi, err = h.HostPath(context.Background(), "")
	if err != nil || !fi.IsDir() || p != dir {
		t.Fatalf("root: got %q %v", p, err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "esc")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.HostPath(context.Background(), "esc"); KindOf(err) != KindForbidden {
		t.Fatalf("escape: want forbidden, got %v", err)
	}
	if _, _, err := h.HostPath(context.Background(), "a/../.."); KindOf(err) != KindBadRequest {
		t.Fatalf("traversal: got %v", err)
	}
	if _, _, err := h.HostPath(context.Background(), "missing"); KindOf(err) != KindNotFound {
		t.Fatalf("missing: got %v", err)
	}
	// A handle without a host directory refuses.
	nh := NewHandle("x", config.WatchPoll, &fakeFS{}, time.Second, 1, 10)
	if _, _, err := nh.HostPath(context.Background(), ""); KindOf(err) != KindInternal {
		t.Fatalf("no host dir: got %v", err)
	}
}

func TestInode(t *testing.T) {
	h, dir := openTemp(t)
	if err := os.WriteFile(filepath.Join(dir, "f"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	fi, err := h.Stat(context.Background(), "f")
	if err != nil {
		t.Fatal(err)
	}
	if Inode(fi) == 0 {
		t.Skip("platform without inode numbers")
	}
}

func TestHostPathMissing(t *testing.T) {
	h, dir := openTemp(t)
	ctx := context.Background()
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "f.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(dir, "esc")); err != nil {
		t.Fatal(err)
	}
	for rel, want := range map[string]string{
		"new.md":     filepath.Join(dir, "new.md"),
		"sub/new.md": filepath.Join(dir, "sub", "new.md"),
	} {
		if p, err := h.HostPathMissing(ctx, rel); err != nil || p != want {
			t.Fatalf("%q: got %q %v, want %q", rel, p, err, want)
		}
	}
	for rel, kind := range map[string]Kind{
		"nodir/new.md": KindNotFound,   // parent missing
		"f.md/new.md":  KindNotFound,   // parent is a file
		"esc/new.md":   KindForbidden,  // parent escapes
		"../x":         KindBadRequest, // traversal
		"":             KindBadRequest, // the root always exists
	} {
		if _, err := h.HostPathMissing(ctx, rel); KindOf(err) != kind {
			t.Fatalf("%q: got %v, want kind %v", rel, err, kind)
		}
	}
}

func TestHostPathUsesOnDiskForm(t *testing.T) {
	h, dir := openTemp(t)
	ctx := context.Background()
	const nfc, nfd = "café", "café"
	if err := os.Mkdir(filepath.Join(dir, nfd), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, nfd, nfd+".md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	for rel, want := range map[string]string{
		nfc:                     filepath.Join(dir, nfd),
		nfc + "/" + nfc + ".md": filepath.Join(dir, nfd, nfd+".md"),
		nfd:                     filepath.Join(dir, nfd),
	} {
		if p, _, err := h.HostPath(ctx, rel); err != nil || p != want {
			t.Fatalf("%q: got %q %v, want %q", rel, p, err, want)
		}
	}
	if p, err := h.HostPathMissing(ctx, nfc+"/new.md"); err != nil || p != filepath.Join(dir, nfd, "new.md") {
		t.Fatalf("missing child: got %q %v", p, err)
	}
}
