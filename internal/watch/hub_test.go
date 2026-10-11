package watch

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"go.uber.org/goleak"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const waitFor = 5 * time.Second

var modes = []config.WatchMode{config.WatchPoll, config.WatchFSNotify}

// newEnv builds a hub over one temp-dir root in the given mode, with short
// intervals so tests run in milliseconds.
func newEnv(t *testing.T, mode config.WatchMode) (*Hub, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{
		Roots:     []config.Root{{Name: "r", Path: dir, Watch: mode}},
		FSTimeout: time.Second, FSMaxInflight: 8, MaxListEntries: 100,
	}
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	hub := New(reg, Options{PollInterval: 5 * time.Millisecond, Coalesce: 20 * time.Millisecond})
	t.Cleanup(func() {
		hub.Close()
		_ = reg.Close()
	})
	return hub, dir
}

func write(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func subscribe(t *testing.T, hub *Hub, paths ...string) *Subscription {
	t.Helper()
	subs := make([]Sub, len(paths))
	for i, p := range paths {
		subs[i] = Sub{Root: "r", Path: p}
	}
	s, err := hub.Subscribe(context.Background(), subs)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

// expect waits until the subscription has delivered want. Other events seen
// meanwhile are tolerated.
func expect(t *testing.T, s *Subscription, want ...Event) {
	t.Helper()
	missing := make(map[Event]bool, len(want))
	for _, w := range want {
		missing[w] = true
	}
	timeout := time.After(waitFor)
	var seen []Event
	for len(missing) > 0 {
		select {
		case <-s.Notify():
			for _, ev := range s.Drain() {
				seen = append(seen, ev)
				delete(missing, ev)
			}
		case <-timeout:
			t.Fatalf("timed out waiting for %v; saw %v", missing, seen)
		}
	}
}

func ev(p string, op Op) Event { return Event{Root: "r", Path: p, Op: op} }

func TestFileChanges(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			f := filepath.Join(dir, "a.md")
			write(t, f, "one")
			s := subscribe(t, hub, "a.md")

			write(t, f, "two, longer")
			expect(t, s, ev("a.md", OpModified))

			// Editors that write a temp file and rename it over the target.
			tmp := filepath.Join(dir, ".a.md.tmp")
			write(t, tmp, "three")
			if err := os.Rename(tmp, f); err != nil {
				t.Fatal(err)
			}
			expect(t, s, ev("a.md", OpModified))

			if err := os.Remove(f); err != nil {
				t.Fatal(err)
			}
			expect(t, s, ev("a.md", OpDeleted))

			write(t, f, "back")
			expect(t, s, ev("a.md", OpCreated))
		})
	}
}

func TestDirChildren(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
				t.Fatal(err)
			}
			write(t, filepath.Join(dir, "sub", "old.md"), "x")
			s := subscribe(t, hub, "sub")

			write(t, filepath.Join(dir, "sub", "new.md"), "x")
			expect(t, s, ev("sub/new.md", OpCreated), ev("sub", OpModified))

			if err := os.Remove(filepath.Join(dir, "sub", "old.md")); err != nil {
				t.Fatal(err)
			}
			expect(t, s, ev("sub/old.md", OpDeleted), ev("sub", OpModified))
		})
	}
}

func TestRootDirChildren(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			s := subscribe(t, hub, "")
			write(t, filepath.Join(dir, "top.md"), "x")
			expect(t, s, ev("top.md", OpCreated), ev("", OpModified))
		})
	}
}

func TestWatchedDirRemoved(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			if err := os.Mkdir(filepath.Join(dir, "sub"), 0o750); err != nil {
				t.Fatal(err)
			}
			write(t, filepath.Join(dir, "sub", "f.md"), "x")
			sd := subscribe(t, hub, "sub")
			sf := subscribe(t, hub, "sub/f.md")
			if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
				t.Fatal(err)
			}
			expect(t, sd, ev("sub", OpDeleted))
			expect(t, sf, ev("sub/f.md", OpDeleted))
		})
	}
}

func TestSubscribeErrors(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			write(t, filepath.Join(dir, "ok.md"), "x")
			if err := os.Symlink(t.TempDir(), filepath.Join(dir, "esc")); err != nil {
				t.Fatal(err)
			}
			tests := []struct {
				sub  Sub
				kind fsroot.Kind
			}{
				{Sub{"nope", "ok.md"}, fsroot.KindNotFound},
				{Sub{"r", "missing.md"}, fsroot.KindNotFound},
				{Sub{"r", "../x"}, fsroot.KindBadRequest},
				{Sub{"r", "/abs"}, fsroot.KindBadRequest},
				{Sub{"r", "esc"}, fsroot.KindForbidden},
			}
			for _, tc := range tests {
				// A good sub alongside must not stay registered.
				_, err := hub.Subscribe(context.Background(), []Sub{{"r", "ok.md"}, tc.sub})
				if fsroot.KindOf(err) != tc.kind {
					t.Errorf("%v: got %v, want kind %v", tc.sub, err, tc.kind)
				}
			}
			if n := hubKeys(hub); n != 0 {
				t.Fatalf("%d keys left registered after failed subscribes", n)
			}
		})
	}
}

func hubKeys(h *Hub) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.entries)
}

func TestRefCounting(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			write(t, filepath.Join(dir, "a.md"), "x")
			write(t, filepath.Join(dir, "b.md"), "x")
			s1 := subscribe(t, hub, "a.md", "b.md", "a.md") // duplicate collapses
			s2 := subscribe(t, hub, "a.md")
			if n := hubKeys(hub); n != 2 {
				t.Fatalf("keys = %d, want 2", n)
			}
			s1.Close()
			if n := hubKeys(hub); n != 1 {
				t.Fatalf("after first close keys = %d, want 1 (a.md still has a subscriber)", n)
			}
			// The remaining subscriber still hears about a.md.
			write(t, filepath.Join(dir, "a.md"), "changed")
			expect(t, s2, ev("a.md", OpModified))
			s2.Close()
			s2.Close() // idempotent
			if n := hubKeys(hub); n != 0 {
				t.Fatalf("after last close keys = %d, want 0", n)
			}
			select {
			case <-s2.Done():
			default:
				t.Fatal("Done not closed")
			}
			if mode == config.WatchFSNotify {
				hub.mu.Lock()
				defer hub.mu.Unlock()
				if len(hub.fsn.dirs) != 0 || len(hub.fsn.w.WatchList()) != 0 {
					t.Fatalf("kernel watch left behind: %v %v", hub.fsn.dirs, hub.fsn.w.WatchList())
				}
			}
		})
	}
}

func TestSharedParentWatch(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	write(t, filepath.Join(dir, "a.md"), "x")
	write(t, filepath.Join(dir, "b.md"), "x")
	sa := subscribe(t, hub, "a.md")
	sb := subscribe(t, hub, "b.md")
	hub.mu.Lock()
	n := len(hub.fsn.w.WatchList())
	hub.mu.Unlock()
	if n != 1 {
		t.Fatalf("watch list = %d, want one shared parent watch", n)
	}
	write(t, filepath.Join(dir, "b.md"), "changed")
	expect(t, sb, ev("b.md", OpModified))
	sa.Close()
	write(t, filepath.Join(dir, "b.md"), "changed again")
	expect(t, sb, ev("b.md", OpModified)) // parent watch survives a.md leaving
}

func TestHubClose(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			write(t, filepath.Join(dir, "a.md"), "x")
			s := subscribe(t, hub, "a.md")
			hub.Close()
			hub.Close()
			select {
			case <-s.Done():
			case <-time.After(waitFor):
				t.Fatal("subscription not ended by hub close")
			}
			if _, err := hub.Subscribe(context.Background(), []Sub{{"r", "a.md"}}); !errors.Is(err, ErrClosed) {
				t.Fatalf("err = %v, want ErrClosed", err)
			}
			s.Close() // safe after hub close
		})
	}
}

func TestFSNotifyErrors(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	write(t, filepath.Join(dir, "a.md"), "x")
	s := subscribe(t, hub, "a.md")
	hub.mu.Lock()
	f := hub.fsn
	hub.mu.Unlock()
	f.error(errors.New("boom"))
	f.error(fsnotify.ErrEventOverflow) // lost events: everyone is told to refetch
	expect(t, s, ev("a.md", OpModified))
}

func TestFSNotifyAddFailureRollsBack(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	write(t, filepath.Join(dir, "a.md"), "x")
	write(t, filepath.Join(dir, "b.md"), "x")
	if err := os.Mkdir(filepath.Join(dir, "gone"), 0o750); err != nil {
		t.Fatal(err)
	}
	// Validate "gone", then remove it before registration, so the kernel
	// watch cannot be added.
	h, err := hub.reg.Get("r")
	if err != nil {
		t.Fatal(err)
	}
	host, _, err := h.HostPath(context.Background(), "gone")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(host); err != nil {
		t.Fatal(err)
	}
	hub.mu.Lock()
	_, err = hub.startLocked(target{key: key{"r", "gone"}, h: h, isDir: true, host: host})
	hub.mu.Unlock()
	if err == nil {
		t.Fatal("want error adding a watch on a missing directory")
	}
	if n := hubKeys(hub); n != 0 {
		t.Fatalf("keys = %d", n)
	}
	// And the hub still works afterwards.
	s := subscribe(t, hub, "a.md")
	write(t, filepath.Join(dir, "a.md"), "changed")
	expect(t, s, ev("a.md", OpModified))
}
