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
