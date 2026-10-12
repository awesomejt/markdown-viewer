package watch

import (
	"context"
	"io/fs"
	"os"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

type stubInfo struct{ dir bool }

func (stubInfo) Name() string       { return "x" }
func (stubInfo) Size() int64        { return 1 }
func (stubInfo) Mode() fs.FileMode  { return 0o644 }
func (stubInfo) ModTime() time.Time { return time.Unix(1, 0) }
func (i stubInfo) IsDir() bool      { return i.dir }
func (stubInfo) Sys() any           { return nil }

// hangFS answers its first free calls normally, then blocks every call until
// release is closed, like a mount that died.
type hangFS struct {
	free    atomic.Int32
	release chan struct{}
	stuck   atomic.Int32
	calls   atomic.Int32
	dir     bool
}

func (f *hangFS) enter() {
	f.calls.Add(1)
	if f.free.Add(-1) >= 0 {
		return
	}
	f.stuck.Add(1)
	<-f.release
	f.stuck.Add(-1)
}

func (f *hangFS) Stat(string) (fs.FileInfo, error)  { f.enter(); return stubInfo{f.dir}, nil }
func (f *hangFS) Lstat(string) (fs.FileInfo, error) { f.enter(); return stubInfo{f.dir}, nil }
func (f *hangFS) ReadDir(string) ([]fs.DirEntry, error) {
	f.enter()
	return nil, nil
}
func (f *hangFS) Open(string) (*os.File, error) { f.enter(); return nil, fs.ErrNotExist }

func TestPollBlockedFSStaysBounded(t *testing.T) {
	for _, dir := range []bool{false, true} {
		name := "file"
		if dir {
			name = "dir"
		}
		t.Run(name, func(t *testing.T) {
			const inflight = 2
			f := &hangFS{release: make(chan struct{}), dir: dir}
			f.free.Store(3) // enough for the subscribe-time Stat/ReadNames
			h := fsroot.NewHandle("r", config.WatchPoll, f, 5*time.Millisecond, inflight, 10)
			hub := New(fsroot.NewRegistryFromHandles(h), Options{PollInterval: time.Millisecond, Coalesce: 5 * time.Millisecond})
			s, err := hub.Subscribe(context.Background(), []Sub{{Root: "r", Path: "p"}})
			if err != nil {
				t.Fatal(err)
			}
			base := runtime.NumGoroutine()
			// Let many poll intervals pass against the dead filesystem.
			time.Sleep(100 * time.Millisecond) // ~100 intervals
			if got := f.stuck.Load(); got > inflight {
				t.Fatalf("%d calls stuck in the fs, cap is %d", got, inflight)
			}
			if grew := runtime.NumGoroutine() - base; grew > inflight+2 {
				t.Fatalf("goroutines grew by %d against a dead fs", grew)
			}
			if evs := s.Drain(); len(evs) != 0 {
				t.Fatalf("an outage must not look like a change: %v", evs)
			}
			close(f.release)
			s.Close()
			hub.Close()
		})
	}
}

func TestPollRecreatedAsDirectory(t *testing.T) {
	hub, dir := newEnv(t, config.WatchPoll)
	p := dir + "/x"
	write(t, p, "file")
	s := subscribe(t, hub, "x")
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("x", OpDeleted))
	if err := os.Mkdir(p, 0o750); err != nil {
		t.Fatal(err)
	}
	expect(t, s, ev("x", OpCreated))
}

func TestPollKindSwaps(t *testing.T) {
	t.Run("file to dir", func(t *testing.T) {
		hub, dir := newEnv(t, config.WatchPoll)
		p := dir + "/x"
		write(t, p, "file")
		s := subscribe(t, hub, "x")
		if err := os.Remove(p); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(p, 0o750); err != nil {
			t.Fatal(err)
		}
		expect(t, s, ev("x", OpModified))
		// The poller now follows it as a directory.
		write(t, p+"/child", "c")
		expect(t, s, ev("x/child", OpCreated))
	})
	t.Run("dir to file", func(t *testing.T) {
		hub, dir := newEnv(t, config.WatchPoll)
		p := dir + "/x"
		if err := os.Mkdir(p, 0o750); err != nil {
			t.Fatal(err)
		}
		write(t, p+"/child", "c")
		s := subscribe(t, hub, "x")
		if err := os.RemoveAll(p); err != nil {
			t.Fatal(err)
		}
		write(t, p, "file")
		expect(t, s, ev("x", OpModified))
		// ...and as a file: content changes are seen.
		write(t, p, "file, now longer")
		expect(t, s, ev("x", OpModified))
	})
}
