package fsroot

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"syscall"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

func fixtureHandle(t *testing.T, maxEntries int) *Handle {
	t.Helper()
	r := openFixtures(t)
	return NewHandle("fx", config.WatchPoll, r, 5*time.Second, 4, maxEntries)
}

func dirHandle(t *testing.T, dir string) *Handle {
	t.Helper()
	r, err := OpenRoot(config.Root{Name: "tmp", Path: dir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return NewHandle("tmp", config.WatchPoll, r, 5*time.Second, 4, 1000)
}

func names(l *Listing) []string {
	var out []string
	for _, e := range l.Entries {
		out = append(out, e.Name)
	}
	return out
}

func find(t *testing.T, l *Listing, name string) Entry {
	t.Helper()
	for _, e := range l.Entries {
		if e.Name == name {
			return e
		}
	}
	t.Fatalf("%q not in listing %v", name, names(l))
	return Entry{}
}

func TestClassify(t *testing.T) {
	tests := map[string]FileKind{
		"a.md": FileKindMarkdown, "A.MARKDOWN": FileKindMarkdown, "x.mdx": FileKindMarkdown,
		"f.mmd": FileKindDiagram, "f.Mermaid": FileKindDiagram, "f.d2": FileKindDiagram,
		"p.PNG": FileKindImage, "p.jpg": FileKindImage, "p.jpeg": FileKindImage, "p.gif": FileKindImage,
		"p.webp": FileKindImage, "p.svg": FileKindImage, "p.avif": FileKindImage,
		"n.txt": FileKindText, "main.go": FileKindText, "c.yaml": FileKindText, "dir/x.JSON": FileKindText,
		"page.html": FileKindOther, "a.xml": FileKindOther, "blob.bin": FileKindOther,
		"noext": FileKindOther, ".hidden": FileKindOther, ".md": FileKindOther, "": FileKindOther,
	}
	for name, want := range tests {
		if got := ClassifyName(name); got != want {
			t.Errorf("ClassifyName(%q) = %q, want %q", name, got, want)
		}
	}
	if KindForExt("md") != FileKindMarkdown || KindForExt(".MD") != FileKindMarkdown || KindForExt("") != FileKindOther {
		t.Error("KindForExt dot/case handling")
	}
}

func TestListFixturesRoot(t *testing.T) {
	h := fixtureHandle(t, 1000)
	l, err := h.List(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if l.Path != "." || l.Truncated {
		t.Fatalf("path %q truncated %v", l.Path, l.Truncated)
	}
	// Dirs first (case-insensitive: ".hidden" < "diagrams" < ...), then files.
	want := []string{
		".hidden", "diagrams", "docs", "generated", "html", "images", "other", "text",
		".dotfile.md", "name with spaces.md", "README.md", "Unicode Ünïcödé name.md",
	}
	if got := names(l); !slices.Equal(got, want) {
		t.Fatalf("order\n got %q\nwant %q", got, want)
	}
	if e := find(t, l, ".dotfile.md"); e.Type != "file" || e.Kind != FileKindMarkdown || e.Size == 0 || e.ModTime.IsZero() {
		t.Fatalf("dotfile entry %+v", e)
	}
	if e := find(t, l, "docs"); e.Type != "dir" || e.Size != 0 {
		t.Fatalf("dir entry %+v", e)
	}
}

func TestListKinds(t *testing.T) {
	h := fixtureHandle(t, 1000)
	want := map[string]map[string]FileKind{
		"diagrams": {"arch.d2": FileKindDiagram, "flow.mmd": FileKindDiagram, "flow.mermaid": FileKindDiagram, "inline.md": FileKindMarkdown},
		"images":   {"pixel.png": FileKindImage, "logo.svg": FileKindImage},
		"text":     {"notes.txt": FileKindText, "config.yaml": FileKindText, "sample.go": FileKindText},
		"other":    {"blob.bin": FileKindOther},
		"html":     {"page.html": FileKindOther},
	}
	for dir, kinds := range want {
		l, err := h.List(context.Background(), dir)
		if err != nil {
			t.Fatal(err)
		}
		if l.Path != dir {
			t.Fatalf("path %q", l.Path)
		}
		for name, k := range kinds {
			if e := find(t, l, name); e.Kind != k || e.Type != "file" {
				t.Errorf("%s/%s = %+v, want kind %s", dir, name, e, k)
			}
		}
	}
}

func TestListGeneratedSymlinks(t *testing.T) {
	h := fixtureHandle(t, 1000)
	l, err := h.List(context.Background(), "generated/")
	if err != nil {
		t.Fatal(err)
	}
	if l.Path != "generated" {
		t.Fatalf("path %q", l.Path)
	}
	if e := find(t, l, "link-inside.md"); e.Type != "file" || e.Kind != FileKindMarkdown || e.Size == 0 {
		t.Fatalf("link-inside.md = %+v", e)
	}
	if e := find(t, l, "link-dir"); e.Type != "dir" {
		t.Fatalf("link-dir = %+v", e)
	}
	find(t, l, "large.md")
	for _, omitted := range []string{"link-escape", "link-escape-file.md", "link-dangling"} {
		if slices.Contains(names(l), omitted) {
			t.Errorf("%s should be omitted: %v", omitted, names(l))
		}
	}
	// Listing through the inside-root directory symlink works.
	if l, err := h.List(context.Background(), "generated/link-dir"); err != nil || len(l.Entries) == 0 {
		t.Fatalf("list via link-dir: %v %v", l, err)
	}
	// An escaping directory symlink is refused outright.
	if _, err := h.List(context.Background(), "generated/link-escape"); KindOf(err) != KindForbidden {
		t.Fatalf("escaping dir: %v", err)
	}
}

func TestListTruncation(t *testing.T) {
	h := fixtureHandle(t, 3)
	l, err := h.List(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if !l.Truncated || len(l.Entries) != 3 {
		t.Fatalf("truncated %v, %d entries", l.Truncated, len(l.Entries))
	}
	// Truncation happens after sorting: the first three are directories.
	if got := names(l); !slices.Equal(got, []string{".hidden", "diagrams", "docs"}) {
		t.Fatalf("got %q", got)
	}
	h = fixtureHandle(t, 5) // diagrams has exactly 5 entries
	l, err = h.List(context.Background(), "diagrams")
	if err != nil || l.Truncated || len(l.Entries) != 5 {
		t.Fatalf("exact fit: %+v %v", l, err)
	}
}

func TestListErrors(t *testing.T) {
	h := fixtureHandle(t, 100)
	ctx := context.Background()
	for _, tc := range []struct {
		rel  string
		kind Kind
	}{
		{"README.md", KindBadRequest},
		{"README.md/x", KindNotFound},
		{"nope", KindNotFound},
		{"../x", KindBadRequest},
	} {
		_, err := h.List(ctx, tc.rel)
		if KindOf(err) != tc.kind {
			t.Errorf("List(%q) = %v, want %v", tc.rel, err, tc.kind)
			continue
		}
		assertNoHostPath(t, err)
	}
}

func TestListOrderingAndSpecialFiles(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"b", "A", "a", "B"} {
		if err := os.WriteFile(filepath.Join(dir, f), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []string{"z", "Y"} {
		if err := os.Mkdir(filepath.Join(dir, d), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("loop2", filepath.Join(dir, "loop1")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("loop1", filepath.Join(dir, "loop2")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("a", filepath.Join(dir, "ok")); err != nil {
		t.Fatal(err)
	}
	l, err := dirHandle(t, dir).List(context.Background(), ".")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := names(l), []string{"Y", "z", "A", "a", "B", "b", "ok"}; !slices.Equal(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestNFCRequestFindsNFDFile(t *testing.T) {
	h := fixtureHandle(t, 100)
	ctx := context.Background()
	const nfc, nfd = "generated/caf\u00e9.md", "generated/cafe\u0301.md"
	for _, rel := range []string{nfc, nfd} {
		fi, err := h.Stat(ctx, rel)
		if err != nil || fi.IsDir() {
			t.Fatalf("Stat(%q) = %v, %v", rel, fi, err)
		}
		f, err := h.Open(ctx, rel)
		if err != nil {
			t.Fatalf("Open(%q): %v", rel, err)
		}
		_ = f.Close()
	}
	// The NFD file is listed under its on-disk (decomposed) name.
	l, err := h.List(ctx, "generated")
	if err != nil {
		t.Fatal(err)
	}
	find(t, l, "cafe\u0301.md")
	// An NFC-named file is found from an NFD request too.
	if _, err := h.Stat(ctx, "Unicode U\u0308ni\u0308co\u0308de\u0301 name.md"); err != nil {
		t.Fatalf("NFD request for NFC-named file: %v", err)
	}
	if _, err := h.Stat(ctx, "generated/nope\u00e9.md"); KindOf(err) != KindNotFound {
		t.Fatalf("missing file: %v", err)
	}
	if _, err := h.Open(ctx, "generated/nope\u00e9.md"); KindOf(err) != KindNotFound {
		t.Fatalf("missing file: %v", err)
	}
}

func TestListNFCRequestFindsNFDDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "cafe\u0301", "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	h := dirHandle(t, dir)
	l, err := h.List(context.Background(), "caf\u00e9")
	if err != nil {
		t.Fatal(err)
	}
	if l.Path != "caf\u00e9" || len(l.Entries) != 1 {
		t.Fatalf("%+v", l)
	}
	if _, err := h.List(context.Background(), "nope"); KindOf(err) != KindNotFound {
		t.Fatal(err)
	}
}

func TestListTimeout(t *testing.T) {
	f := &fakeFS{block: make(chan struct{})}
	h := newFakeHandle(f, 10*time.Millisecond, 2)
	_, err := h.List(context.Background(), "")
	wantTimeout(t, err)
	close(f.block)
}

func TestRetryTimeoutSurfaces(t *testing.T) {
	// First attempt not-found, alternate form times out: the timeout wins.
	f := &notFoundThenBlock{block: make(chan struct{})}
	h := newFakeHandle(f, 10*time.Millisecond, 2)
	_, err := h.Stat(context.Background(), "caf\u00e9")
	wantTimeout(t, err)
	close(f.block)
}

type notFoundThenBlock struct {
	fakeFS
	block chan struct{}
}

func (f *notFoundThenBlock) Stat(rel string) (os.FileInfo, error) {
	if rel == "caf\u00e9" {
		return nil, &PathError{Kind: KindNotFound, Op: "stat", Path: rel}
	}
	<-f.block
	return nil, errors.New("late")
}

func TestRegistry(t *testing.T) {
	good := t.TempDir()
	cfg := &config.Config{
		FSTimeout: time.Second, FSMaxInflight: 2, MaxListEntries: 10,
		Roots: []config.Root{
			{Name: "b", Path: fixtures, Watch: config.WatchPoll},
			{Name: "a", Path: good, Watch: config.WatchFSNotify},
		},
	}
	reg, err := NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	infos := reg.Roots()
	if len(infos) != 2 || infos[0] != (RootInfo{"b", config.WatchPoll, true}) ||
		infos[1] != (RootInfo{"a", config.WatchFSNotify, true}) {
		t.Fatalf("roots %+v", infos)
	}
	h, err := reg.Get("b")
	if err != nil || h.Name() != "b" || h.Watch() != config.WatchPoll {
		t.Fatal(h, err)
	}
	if _, err := h.List(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	_, err = reg.Get("nope")
	if KindOf(err) != KindNotFound {
		t.Fatal(err)
	}
	var pe *PathError
	if !errors.As(err, &pe) || pe.PublicMessage() != `not_found: "nope" (unknown root)` {
		t.Fatalf("%v", err)
	}
	if err := reg.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRegistryOpenFailureClosesAll(t *testing.T) {
	cfg := &config.Config{
		FSTimeout: time.Second, FSMaxInflight: 1, MaxListEntries: 1,
		Roots: []config.Root{
			{Name: "ok", Path: t.TempDir()},
			{Name: "bad", Path: filepath.Join(t.TempDir(), "missing")},
		},
	}
	if reg, err := NewRegistry(cfg); err == nil || reg != nil {
		t.Fatalf("want error, got %v %v", reg, err)
	}
}
