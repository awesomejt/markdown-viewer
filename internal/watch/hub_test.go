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
				{Sub{Root: "nope", Path: "ok.md"}, fsroot.KindNotFound},
				{Sub{Root: "r", Path: "../x"}, fsroot.KindBadRequest},
				{Sub{Root: "r", Path: "/abs"}, fsroot.KindBadRequest},
				{Sub{Root: "r", Path: "esc"}, fsroot.KindForbidden},
			}
			if mode == config.WatchFSNotify { // the parent must exist to be watched
				tests = append(tests,
					struct {
						sub  Sub
						kind fsroot.Kind
					}{Sub{Root: "r", Path: "nodir/missing.md"}, fsroot.KindNotFound},
					struct {
						sub  Sub
						kind fsroot.Kind
					}{Sub{Root: "r", Path: "ok.md/child"}, fsroot.KindNotFound})
			}
			for _, tc := range tests {
				// A good sub alongside must not stay registered.
				_, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "ok.md"}, tc.sub})
				if fsroot.KindOf(err) != tc.kind {
					t.Errorf("%v: got %v, want kind %v", tc.sub, err, tc.kind)
				}
			}
			if n := hub.Watching(); n != 0 {
				t.Fatalf("%d keys left registered after failed subscribes", n)
			}
		})
	}
}

func TestRefCounting(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			write(t, filepath.Join(dir, "a.md"), "x")
			write(t, filepath.Join(dir, "b.md"), "x")
			s1 := subscribe(t, hub, "a.md", "b.md", "a.md") // duplicate collapses
			s2 := subscribe(t, hub, "a.md")
			if n := hub.Watching(); n != 2 {
				t.Fatalf("keys = %d, want 2", n)
			}
			s1.Close()
			if n := hub.Watching(); n != 1 {
				t.Fatalf("after first close keys = %d, want 1 (a.md still has a subscriber)", n)
			}
			// The remaining subscriber still hears about a.md.
			write(t, filepath.Join(dir, "a.md"), "changed")
			expect(t, s2, ev("a.md", OpModified))
			s2.Close()
			s2.Close() // idempotent
			if n := hub.Watching(); n != 0 {
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
			if _, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "a.md"}}); !errors.Is(err, ErrClosed) {
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
	if n := hub.Watching(); n != 0 {
		t.Fatalf("keys = %d", n)
	}
	// And the hub still works afterwards.
	s := subscribe(t, hub, "a.md")
	write(t, filepath.Join(dir, "a.md"), "changed")
	expect(t, s, ev("a.md", OpModified))
}

func TestMissingPathCreated(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			s := subscribe(t, hub, "later.md")
			write(t, filepath.Join(dir, "later.md"), "x")
			expect(t, s, ev("later.md", OpCreated))
			write(t, filepath.Join(dir, "later.md"), "changed, longer")
			expect(t, s, ev("later.md", OpModified))
			if err := os.Remove(filepath.Join(dir, "later.md")); err != nil {
				t.Fatal(err)
			}
			expect(t, s, ev("later.md", OpDeleted))
			write(t, filepath.Join(dir, "later.md"), "again")
			expect(t, s, ev("later.md", OpCreated))
		})
	}
}

func TestMaxWatches(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			hub.opts.MaxWatches = 2
			for _, n := range []string{"a.md", "b.md", "c.md"} {
				write(t, filepath.Join(dir, n), "x")
			}
			sa := subscribe(t, hub, "a.md", "b.md")
			// Existing keys cost nothing, duplicates count once.
			subscribe(t, hub, "a.md", "b.md", "a.md")
			// One new key would be the third; nothing of the request stays.
			_, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "a.md"}, {Root: "r", Path: "c.md"}})
			if !errors.Is(err, ErrTooManyWatches) {
				t.Fatalf("err = %v, want ErrTooManyWatches", err)
			}
			if n := hub.Watching(); n != 2 {
				t.Fatalf("watching %d, want 2", n)
			}
			// The second subscription still holds both keys, so room appears
			// only once both are gone.
			sa.Close()
			if _, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "c.md"}}); !errors.Is(err, ErrTooManyWatches) {
				t.Fatalf("err = %v, want ErrTooManyWatches", err)
			}
		})
	}
}

func TestDefaultMaxWatches(t *testing.T) {
	hub, _ := newEnv(t, config.WatchPoll)
	if hub.opts.MaxWatches != DefaultMaxWatches {
		t.Fatalf("MaxWatches = %d", hub.opts.MaxWatches)
	}
}

// waitArmed blocks until every fsnotify watch is armed on its host directory,
// i.e. a re-arm after a delete and recreate has completed.
func waitArmed(t *testing.T, hub *Hub) {
	t.Helper()
	hub.mu.Lock()
	f := hub.fsn
	hub.mu.Unlock()
	deadline := time.Now().Add(waitFor)
	for time.Now().Before(deadline) {
		f.mu.Lock()
		ok := true
		for _, set := range f.dirs {
			for w := range set {
				ok = ok && w.armed
			}
		}
		f.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for watches to re-arm")
}

func mkdirAll(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o750); err != nil {
		t.Fatal(err)
	}
}

func TestRearmDirKey(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	mkdirAll(t, filepath.Join(dir, "sub"))
	s := subscribe(t, hub, "sub")
	if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("sub", OpDeleted))
	mkdirAll(t, filepath.Join(dir, "sub"))
	waitArmed(t, hub)
	write(t, filepath.Join(dir, "sub", "c.md"), "x")
	expect(t, s, ev("sub/c.md", OpCreated))
}

func TestRearmFileKey(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	mkdirAll(t, filepath.Join(dir, "sub"))
	write(t, filepath.Join(dir, "sub", "f.md"), "x")
	s := subscribe(t, hub, "sub/f.md")
	if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("sub/f.md", OpDeleted))
	mkdirAll(t, filepath.Join(dir, "sub"))
	waitArmed(t, hub)
	write(t, filepath.Join(dir, "sub", "f.md"), "again")
	expect(t, s, ev("sub/f.md", OpCreated))
}

func TestRearmFileCreatedBeforeArm(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	mkdirAll(t, filepath.Join(dir, "sub"))
	write(t, filepath.Join(dir, "sub", "f.md"), "x")
	s := subscribe(t, hub, "sub/f.md")
	if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	// Recreate with the file already inside: only the catch-up stat sees it.
	mkdirAll(t, filepath.Join(dir, "sub"))
	write(t, filepath.Join(dir, "sub", "f.md"), "again")
	// The delete and the re-creation may merge into modified, but the final
	// state must be reported as present, not deleted.
	timeout := time.After(waitFor)
	for last := OpDeleted; last == OpDeleted; {
		select {
		case <-s.Notify():
			for _, e := range s.Drain() {
				last = e.Op
			}
		case <-timeout:
			t.Fatal("timed out waiting for the file to be reported present")
		}
	}
}

func TestRearmNested(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	mkdirAll(t, filepath.Join(dir, "a", "b", "c"))
	sd := subscribe(t, hub, "a/b/c")
	sf := subscribe(t, hub, "a/b/c/f.md")
	if err := os.RemoveAll(filepath.Join(dir, "a")); err != nil {
		t.Fatal(err)
	}
	expect(t, sd, ev("a/b/c", OpDeleted))
	mkdirAll(t, filepath.Join(dir, "a", "b", "c"))
	waitArmed(t, hub)
	write(t, filepath.Join(dir, "a", "b", "c", "f.md"), "x")
	expect(t, sd, ev("a/b/c/f.md", OpCreated))
	expect(t, sf, ev("a/b/c/f.md", OpCreated))

	// Step down level by level, with a pause between levels.
	if err := os.RemoveAll(filepath.Join(dir, "a")); err != nil {
		t.Fatal(err)
	}
	expect(t, sd, ev("a/b/c", OpDeleted))
	mkdirAll(t, filepath.Join(dir, "a"))
	mkdirAll(t, filepath.Join(dir, "a", "b"))
	mkdirAll(t, filepath.Join(dir, "a", "b", "c"))
	waitArmed(t, hub)
	write(t, filepath.Join(dir, "a", "b", "c", "g.md"), "x")
	expect(t, sd, ev("a/b/c/g.md", OpCreated))
}

func TestRearmRejectsEscapingSymlink(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	outside := t.TempDir()
	mkdirAll(t, filepath.Join(dir, "sub"))
	s := subscribe(t, hub, "sub")
	if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("sub", OpDeleted))
	if err := os.Symlink(outside, filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	// Let the re-arm pass settle on the ancestor, then touch the outside dir.
	hub.mu.Lock()
	f := hub.fsn
	hub.mu.Unlock()
	deadline := time.Now().Add(waitFor)
	for {
		f.mu.Lock()
		settled := false
		for _, set := range f.dirs {
			for w := range set {
				settled = settled || (!w.armed && w.anc != "" && !w.busy)
			}
		}
		f.mu.Unlock()
		if settled {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("watch never settled on the ancestor")
		}
		time.Sleep(time.Millisecond)
	}
	write(t, filepath.Join(outside, "leak.md"), "x")
	time.Sleep(100 * time.Millisecond) // several coalesce windows
	for _, e := range s.Drain() {
		t.Fatalf("event from outside the root: %v", e)
	}
	f.mu.Lock()
	for _, set := range f.dirs {
		for w := range set {
			if w.armed {
				t.Fatal("watch re-armed through an escaping symlink")
			}
		}
	}
	f.mu.Unlock()
}

func TestRearmCleanup(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	mkdirAll(t, filepath.Join(dir, "a", "b"))
	s := subscribe(t, hub, "a/b", "a/b/f.md")
	if err := os.RemoveAll(filepath.Join(dir, "a")); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("a/b", OpDeleted))
	// Disarmed and waiting on an ancestor: unsubscribing must release it.
	deadline := time.Now().Add(waitFor)
	for {
		hub.fsn.mu.Lock()
		n := len(hub.fsn.refs)
		busy := false
		for _, set := range hub.fsn.dirs {
			for w := range set {
				busy = busy || w.busy
			}
		}
		hub.fsn.mu.Unlock()
		if n > 0 && !busy {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("watch never settled on an ancestor")
		}
		time.Sleep(time.Millisecond)
	}
	s.Close()
	hub.fsn.mu.Lock()
	defer hub.fsn.mu.Unlock()
	if len(hub.fsn.dirs) != 0 || len(hub.fsn.refs) != 0 || len(hub.fsn.w.WatchList()) != 0 {
		t.Fatalf("left behind: %v %v %v", hub.fsn.dirs, hub.fsn.refs, hub.fsn.w.WatchList())
	}
}

func TestMaxMissing(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			hub.opts.MaxWatches, hub.opts.MaxMissing = 2, 2
			for _, n := range []string{"a.md", "b.md", "c.md"} {
				write(t, filepath.Join(dir, n), "x")
			}
			sm := subscribe(t, hub, "m1.md", "m2.md")
			// A third missing key fails and registers nothing, even with a
			// valid sibling in the same request.
			_, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "a.md"}, {Root: "r", Path: "m3.md"}})
			if !errors.Is(err, ErrTooManyWatches) {
				t.Fatalf("err = %v, want ErrTooManyWatches", err)
			}
			if n := hub.Watching(); n != 2 {
				t.Fatalf("watching %d, want 2", n)
			}
			// Missing keys do not use up the present cap.
			subscribe(t, hub, "a.md", "b.md")
			if _, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "c.md"}}); !errors.Is(err, ErrTooManyWatches) {
				t.Fatalf("present cap: err = %v", err)
			}
			// An already watched missing key costs nothing.
			subscribe(t, hub, "m1.md")
			// Closing frees a missing slot (m1 is still held by the other sub).
			sm.Close()
			if s := subscribe(t, hub, "m3.md"); s == nil {
				t.Fatal("no subscription")
			}
		})
	}
}

func TestDefaultMaxMissing(t *testing.T) {
	hub, _ := newEnv(t, config.WatchPoll)
	if hub.opts.MaxMissing != DefaultMaxMissing {
		t.Fatalf("MaxMissing = %d", hub.opts.MaxMissing)
	}
}

// A sub requested in NFC for names stored in NFD (macOS, some shares) must
// watch the on-disk names: file keys and dir keys both deliver events.
func TestNormalizationMismatch(t *testing.T) {
	const nfc, nfd = "café", "café"
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			// File key: the parent watch is fine, but events carry the NFD name.
			f := filepath.Join(dir, nfd+".md")
			write(t, f, "one")
			s := subscribe(t, hub, nfc+".md")
			write(t, f, "two, longer")
			expect(t, s, ev(nfc+".md", OpModified))

			// Dir key: the watch itself must be added on the NFD directory.
			mkdirAll(t, filepath.Join(dir, nfd))
			dirKey := nfc
			s = subscribe(t, hub, dirKey)
			write(t, filepath.Join(dir, nfd, "new.md"), "x")
			expect(t, s, ev(dirKey, OpModified))
		})
	}
}

func TestLowSubsDroppedWhenInvalid(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			write(t, filepath.Join(dir, "ok.md"), "x")
			if err := os.Symlink(t.TempDir(), filepath.Join(dir, "esc")); err != nil {
				t.Fatal(err)
			}
			subs := []Sub{
				{Root: "r", Path: "ok.md"},
				{Root: "r", Path: "../x", Low: true},
				{Root: "r", Path: "esc", Low: true},
				{Root: "nope", Path: "a", Low: true},
				{Root: "r", Path: "nodir/img.png", Low: true},
			}
			s, err := hub.Subscribe(context.Background(), subs)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(s.Close)
			if mode == config.WatchPoll {
				// Poll roots watch a missing path, so only the invalid ones were dropped.
				if n := hub.Watching(); n != 2 {
					t.Fatalf("watching %d, want 2", n)
				}
			} else if n := hub.Watching(); n != 1 {
				t.Fatalf("watching %d, want 1", n)
			}
			write(t, filepath.Join(dir, "ok.md"), "changed")
			expect(t, s, ev("ok.md", OpModified))

			// Only invalid low subs: still a subscription, watching nothing.
			s2, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "../x", Low: true}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(s2.Close)

			// A normal sub that is invalid still fails everything.
			_, err = hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "ok.md", Low: true}, {Root: "r", Path: "../x"}})
			if fsroot.KindOf(err) != fsroot.KindBadRequest {
				t.Fatalf("err = %v, want bad request", err)
			}
		})
	}
}

func TestLowSubCanceledContextDropped(t *testing.T) {
	hub, dir := newEnv(t, config.WatchFSNotify)
	write(t, filepath.Join(dir, "ok.md"), "x")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s, err := hub.Subscribe(ctx, []Sub{{Root: "r", Path: "ok.md", Low: true}})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
}

func TestLowSubUpgradedByNormalDuplicate(t *testing.T) {
	hub, dir := newEnv(t, config.WatchPoll)
	hub.opts.MaxWatches = 1
	write(t, filepath.Join(dir, "a.md"), "x")
	write(t, filepath.Join(dir, "b.md"), "x")
	// The same key as low then normal counts as normal and is kept.
	s, err := hub.Subscribe(context.Background(), []Sub{
		{Root: "r", Path: "a.md", Low: true}, {Root: "r", Path: "b.md", Low: true}, {Root: "r", Path: "a.md"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if n := hub.Watching(); n != 1 {
		t.Fatalf("watching %d, want 1", n)
	}
}

func TestLowSubsDroppedOverCap(t *testing.T) {
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			hub, dir := newEnv(t, mode)
			hub.opts.MaxWatches = 2
			for _, n := range []string{"a.md", "b.md", "c.md"} {
				write(t, filepath.Join(dir, n), "x")
			}
			// Low subs that would exceed the cap are dropped, normal ones kept.
			s, err := hub.Subscribe(context.Background(), []Sub{
				{Root: "r", Path: "a.md"}, {Root: "r", Path: "b.md", Low: true}, {Root: "r", Path: "c.md", Low: true},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(s.Close)
			if n := hub.Watching(); n != 1 {
				t.Fatalf("watching %d, want 1", n)
			}
			// Normal subs alone over the cap still fail.
			_, err = hub.Subscribe(context.Background(), []Sub{
				{Root: "r", Path: "b.md"}, {Root: "r", Path: "c.md"}, {Root: "r", Path: "a.md", Low: true},
			})
			if !errors.Is(err, ErrTooManyWatches) {
				t.Fatalf("err = %v, want ErrTooManyWatches", err)
			}
		})
	}
}
