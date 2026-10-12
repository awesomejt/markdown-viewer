package fsroot

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

func lazyCfg(timeout time.Duration) *config.Config {
	return &config.Config{FSTimeout: timeout, FSMaxInflight: 4, MaxListEntries: 100}
}

func TestOpenHandleMissingRecovers(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "later")
	h, err := OpenHandle(config.Root{Name: "r", Path: dir, Watch: config.WatchPoll}, lazyCfg(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	if h.StartupErr() == nil || !errors.Is(h.StartupErr(), os.ErrNotExist) {
		t.Fatalf("startup err = %v", h.StartupErr())
	}
	ctx := context.Background()
	start := time.Now()
	_, err = h.List(ctx, "")
	wantTimeout(t, err)
	if !strings.Contains(err.Error(), "root unavailable") || time.Since(start) > 500*time.Millisecond {
		t.Fatalf("not a fast unavailable failure: %v after %v", err, time.Since(start))
	}
	if h.Available() {
		t.Fatal("available while directory is missing")
	}
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	eventually(t, "probe to recover the root", h.Available)
	if _, err := h.List(ctx, ""); err != nil {
		t.Fatal(err)
	}
}

func TestOpenHandleNotDirectory(t *testing.T) {
	file := filepath.Join(t.TempDir(), "f")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := OpenHandle(config.Root{Name: "r", Path: file}, lazyCfg(time.Second))
	if err == nil || h != nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("got %v, %v", h, err)
	}
}

func TestOpenHandleHungOpen(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	open := func(cfg config.Root) (*Root, error) {
		calls.Add(1)
		<-release
		return OpenRoot(cfg)
	}
	dir := t.TempDir()
	start := time.Now()
	h, err := openHandle(config.Root{Name: "r", Path: dir}, lazyCfg(50*time.Millisecond), open)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("OpenHandle took %v", d)
	}
	if h.Available() || h.StartupErr() == nil {
		t.Fatal("hung open must leave the handle unavailable")
	}
	wantTimeout(t, func() error { _, err := h.List(context.Background(), ""); return err }())
	close(release)
	eventually(t, "probe to recover after the open returns", h.Available)
	if _, err := h.List(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLazyRootClose(t *testing.T) {
	cfg := config.Root{Name: "r", Path: t.TempDir()}
	t.Run("before open", func(t *testing.T) {
		l := newLazyRoot(cfg, OpenRoot)
		if err := l.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := l.Stat("."); KindOf(err) != KindTimeout {
			t.Fatalf("stat after close: %v", err)
		}
	})
	t.Run("after open", func(t *testing.T) {
		l := newLazyRoot(cfg, OpenRoot)
		if _, err := l.Stat("."); err != nil {
			t.Fatal(err)
		}
		if err := l.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := l.Stat("."); KindOf(err) != KindTimeout {
			t.Fatalf("stat after close: %v", err)
		}
	})
	t.Run("during open", func(t *testing.T) {
		entered, release := make(chan struct{}), make(chan struct{})
		var opened *Root
		l := newLazyRoot(cfg, func(c config.Root) (*Root, error) {
			close(entered)
			<-release
			r, err := OpenRoot(c)
			opened = r
			return r, err
		})
		res := make(chan error, 1)
		go func() { _, err := l.Stat("."); res <- err }()
		<-entered
		if err := l.Close(); err != nil {
			t.Fatal(err)
		}
		close(release)
		if err := <-res; KindOf(err) != KindTimeout {
			t.Fatalf("stat: %v", err)
		}
		if _, err := opened.Stat("."); err == nil {
			t.Fatal("root opened during Close was leaked")
		}
	})
}

func TestLazyRootMethods(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, OpenRoot)
	defer func() { _ = l.Close() }()
	if _, err := l.Lstat("a.md"); err != nil {
		t.Fatal(err)
	}
	if ents, err := l.ReadDir("."); err != nil || len(ents) != 1 {
		t.Fatal(ents, err)
	}
	f, err := l.Open("a.md")
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	bad := newLazyRoot(config.Root{Name: "r", Path: filepath.Join(dir, "none")}, OpenRoot)
	for name, call := range map[string]func() error{
		"stat":    func() error { _, err := bad.Stat("."); return err },
		"lstat":   func() error { _, err := bad.Lstat("."); return err },
		"readdir": func() error { _, err := bad.ReadDir("."); return err },
		"open":    func() error { _, err := bad.Open("."); return err },
	} {
		if err := call(); KindOf(err) != KindTimeout || !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestRegistryStartup(t *testing.T) {
	good := t.TempDir()
	cfg := lazyCfg(time.Second)
	cfg.Roots = []config.Root{
		{Name: "up", Path: good, Watch: config.WatchPoll},
		{Name: "down", Path: filepath.Join(good, "missing"), Watch: config.WatchPoll},
	}
	reg, err := NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reg.Close() }()
	infos := reg.Roots()
	if len(infos) != 2 || !infos[0].Available || infos[1].Available {
		t.Fatalf("roots %+v", infos)
	}
	se := reg.StartupErrors()
	if len(se) != 1 || se[0].Name != "down" || !errors.Is(se[0].Err, os.ErrNotExist) {
		t.Fatalf("startup errors %+v", se)
	}
}

func TestRegistryFatalClosesAll(t *testing.T) {
	file := filepath.Join(t.TempDir(), "f")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := lazyCfg(time.Second)
	cfg.Roots = []config.Root{{Name: "ok", Path: t.TempDir()}, {Name: "bad", Path: file}}
	if reg, err := NewRegistry(cfg); err == nil || reg != nil || !strings.Contains(err.Error(), `"bad"`) {
		t.Fatalf("want error, got %v %v", reg, err)
	}
}

// replaceDir swaps the directory at path for a new one holding only name, as a
// mount appearing over (or vanishing from) a mount point does. The old
// directory survives at a new name, like the hidden mount-point directory.
func replaceDir(t *testing.T, path, name string) {
	t.Helper()
	if err := os.Rename(path, path+"-"+name); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, name), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func rootNames(t *testing.T, l *lazyRoot) string {
	t.Helper()
	ents, err := l.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range ents {
		out = append(out, e.Name())
	}
	return strings.Join(out, ",")
}

func TestLazyRootReopensReplacedDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mnt")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, OpenRoot)
	l.checkEvery = 0
	defer func() { _ = l.Close() }()
	if got := rootNames(t, l); got != "" {
		t.Fatalf("empty mount point lists %q", got)
	}
	first := l.root

	replaceDir(t, dir, "nas.md")
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("after mount: %q", got)
	}
	if l.retired != first {
		t.Fatal("old root not retired")
	}
	if _, err := first.Stat("."); err != nil {
		t.Fatalf("retired root closed while it may be in use: %v", err)
	}
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("unchanged path reopened or changed: %q", got)
	}

	replaceDir(t, dir, "again.md")
	if got := rootNames(t, l); got != "again.md" {
		t.Fatalf("after second swap: %q", got)
	}
	if _, err := first.Stat("."); err == nil {
		t.Fatal("root retired two swaps ago was not closed")
	}
}

func TestLazyRootCheckInterval(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mnt")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, OpenRoot)
	l.checkEvery = time.Hour
	defer func() { _ = l.Close() }()
	_ = rootNames(t, l)
	replaceDir(t, dir, "nas.md")
	if got := rootNames(t, l); got != "" {
		t.Fatalf("revalidated before the interval: %q", got)
	}
	l.mu.Lock()
	l.lastCheck = time.Time{}
	l.mu.Unlock()
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("not revalidated after the interval: %q", got)
	}
}

func TestLazyRootHostPathGoneKeepsRoot(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mnt")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, OpenRoot)
	l.checkEvery = 0
	defer func() { _ = l.Close() }()
	_ = rootNames(t, l)
	if err := os.Rename(dir, dir+"-gone"); err != nil {
		t.Fatal(err)
	}
	if got := rootNames(t, l); got != "a.md" {
		t.Fatalf("failed host stat dropped the root: %q", got)
	}
}

func TestLazyRootReopenFails(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mnt")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, func(c config.Root) (*Root, error) {
		if calls.Add(1) == 2 {
			return nil, os.ErrPermission
		}
		return OpenRoot(c)
	})
	l.checkEvery = 0
	defer func() { _ = l.Close() }()
	_ = rootNames(t, l)
	replaceDir(t, dir, "nas.md")
	if _, err := l.ReadDir("."); KindOf(err) != KindTimeout || !errors.Is(err, os.ErrPermission) {
		t.Fatalf("failed reopen: %v", err)
	}
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("next call did not retry the open: %q", got)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	if l.retired != nil || l.root != nil {
		t.Fatal("Close kept roots")
	}
}

// TestOpenHandleMountsLater is the FIX-16 scenario end to end: the handle
// opens the empty mount point at boot and lists the share once it appears,
// without a restart.
func TestOpenHandleMountsLater(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mnt")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	h, err := OpenHandle(config.Root{Name: "r", Path: dir, Watch: config.WatchPoll}, lazyCfg(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	h.fs.(*lazyRoot).checkEvery = 0
	ctx := context.Background()
	if l, err := h.List(ctx, ""); err != nil || len(l.Entries) != 0 {
		t.Fatalf("before mount: %+v %v", l, err)
	}
	replaceDir(t, dir, "nas.md")
	l, err := h.List(ctx, "")
	if err != nil || len(l.Entries) != 1 || l.Entries[0].Name != "nas.md" {
		t.Fatalf("after mount: %+v %v", l, err)
	}
}

// FIX-21: a root replaced by a symlink must not be followed on reopen.
func TestLazyRootRefusesSymlinkSwap(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "docs")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{dir, outside} {
		if err := os.Mkdir(d, 0o750); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("s"), 0o600); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, OpenRoot)
	l.checkEvery = 0
	defer func() { _ = l.Close() }()
	if got := rootNames(t, l); got != "" {
		t.Fatalf("initial listing %q", got)
	}

	if err := os.Rename(dir, dir+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, dir); err != nil {
		t.Fatal(err)
	}
	for range 2 { // the swap is detected, then the retry fails the same way
		_, err := l.ReadDir(".")
		wantTimeout(t, err)
		if !errors.Is(err, errRootMoved) {
			t.Fatalf("err = %v, want errRootMoved", err)
		}
	}
	if _, err := l.Open("secret.txt"); err == nil {
		t.Fatal("read a file through the swapped symlink")
	}

	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(dir+".old", dir); err != nil {
		t.Fatal(err)
	}
	if got := rootNames(t, l); got != "" {
		t.Fatalf("after restore: %q", got)
	}
}

// A configured path that is a symlink is resolved once and keeps working,
// including remount detection on the resolved directory.
func TestLazyRootConfiguredSymlink(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "mnt")
	if err := os.Mkdir(target, 0o750); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	l := newLazyRoot(config.Root{Name: "r", Path: link}, OpenRoot)
	l.checkEvery = 0
	defer func() { _ = l.Close() }()
	if got := rootNames(t, l); got != "" {
		t.Fatalf("initial listing %q", got)
	}
	replaceDir(t, target, "nas.md")
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("after mount: %q", got)
	}
	// Retargeting the configured symlink is not followed: the root stays pinned.
	other := filepath.Join(base, "other")
	if err := os.Mkdir(other, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, link); err != nil {
		t.Fatal(err)
	}
	if got := rootNames(t, l); got != "nas.md" {
		t.Fatalf("after retarget: %q", got)
	}
}

// An open that lands on another directory than the pinned path names (a swap
// to a symlink and back around the open) is refused and closed.
func TestLazyRootOpenedOtherDir(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "docs")
	other := filepath.Join(base, "other")
	for _, d := range []string{dir, other} {
		if err := os.Mkdir(d, 0o750); err != nil {
			t.Fatal(err)
		}
	}
	var opened *Root
	open := func(c config.Root) (*Root, error) {
		r, err := OpenRoot(config.Root{Name: c.Name, Path: other})
		opened = r
		return r, err
	}
	l := newLazyRoot(config.Root{Name: "r", Path: dir}, open)
	defer func() { _ = l.Close() }()
	_, err := l.ReadDir(".")
	if !errors.Is(err, errRootMoved) {
		t.Fatalf("err = %v, want errRootMoved", err)
	}
	if _, err := opened.Stat("."); err == nil {
		t.Fatal("refused root was not closed")
	}
}
