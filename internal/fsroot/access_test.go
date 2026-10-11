package fsroot

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// fakeFS blocks every call until release is closed (or returns at once if
// block is nil), counting how many calls are currently stuck inside it.
type fakeFS struct {
	block   chan struct{}
	entered chan struct{} // receives a token per call entering, if non-nil
	stuck   atomic.Int32
	maxSeen atomic.Int32
	calls   atomic.Int32
	openFn  func() (*os.File, error)
}

func (f *fakeFS) enter() {
	f.calls.Add(1)
	n := f.stuck.Add(1)
	for {
		m := f.maxSeen.Load()
		if n <= m || f.maxSeen.CompareAndSwap(m, n) {
			break
		}
	}
	if f.entered != nil {
		f.entered <- struct{}{}
	}
	if f.block != nil {
		<-f.block
	}
	f.stuck.Add(-1)
}

type fakeInfo struct{ fs.FileInfo }

func (fakeInfo) IsDir() bool { return true }

func (f *fakeFS) Stat(string) (fs.FileInfo, error)  { f.enter(); return fakeInfo{}, nil }
func (f *fakeFS) Lstat(string) (fs.FileInfo, error) { f.enter(); return fakeInfo{}, nil }
func (f *fakeFS) ReadDir(string) ([]fs.DirEntry, error) {
	f.enter()
	return nil, nil
}
func (f *fakeFS) Open(string) (*os.File, error) {
	f.enter()
	if f.openFn != nil {
		return f.openFn()
	}
	return nil, nil
}

func newFakeHandle(f FS, timeout time.Duration, inflight int) *Handle {
	return NewHandle("fake", config.WatchPoll, f, timeout, inflight, 100)
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func wantTimeout(t *testing.T, err error) {
	t.Helper()
	if KindOf(err) != KindTimeout || !errors.Is(err, ErrTimeout) {
		t.Fatalf("want KindTimeout, got %v", err)
	}
	if KindTimeout.String() != "fs_timeout" {
		t.Fatalf("String = %q", KindTimeout.String())
	}
}

func TestSlowFSTimesOutAndRecovers(t *testing.T) {
	f := &fakeFS{block: make(chan struct{})}
	h := newFakeHandle(f, 10*time.Millisecond, 2)
	_, err := h.Stat(context.Background(), "a")
	wantTimeout(t, err)
	var pe *PathError
	if !errors.As(err, &pe) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline cause, got %v", err)
	}
	if h.Available() {
		t.Fatal("root should be unavailable after a timeout")
	}
	close(f.block)
	eventually(t, "probe to restore availability", h.Available)
	if _, err := h.Stat(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "slots released", func() bool { return len(h.sem) == 0 })
}

func TestBlockedForeverIsBounded(t *testing.T) {
	const limit, n = 4, 50
	f := &fakeFS{block: make(chan struct{}), entered: make(chan struct{}, n)}
	h := newFakeHandle(f, 10*time.Millisecond, limit)
	var wg sync.WaitGroup
	errs := make([]error, n)
	call := func(i int) {
		defer wg.Done()
		_, errs[i] = h.Stat(context.Background(), "a")
	}
	// Fill every slot first, so the storm below cannot race with the root
	// becoming unavailable before the cap is reached.
	for i := range limit {
		wg.Add(1)
		go call(i)
	}
	for range limit {
		<-f.entered
	}
	for i := limit; i < n; i++ {
		wg.Add(1)
		go call(i)
	}
	wg.Wait()
	for _, err := range errs {
		wantTimeout(t, err)
	}
	if got := f.maxSeen.Load(); got != limit {
		t.Fatalf("peak goroutines in fs = %d, want exactly the cap %d", got, limit)
	}
	// Quiesce: let every stuck call be accounted for, then check fail-fast.
	eventually(t, "stuck calls to settle", func() bool { return int(f.stuck.Load()) == int(f.calls.Load()) })
	before := f.calls.Load()
	start := time.Now()
	for range 100 {
		_, err := h.Stat(context.Background(), "a")
		wantTimeout(t, err)
		_, err = h.List(context.Background(), "")
		wantTimeout(t, err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("requests on an unavailable root did not fail fast")
	}
	if f.calls.Load() != before || int(f.stuck.Load()) > limit {
		t.Fatalf("new work spawned: calls %d -> %d, stuck %d", before, f.calls.Load(), f.stuck.Load())
	}
	close(f.block)
	eventually(t, "slots to be released", func() bool { return len(h.sem) == 0 && f.stuck.Load() == 0 })
	eventually(t, "probe to restore availability", h.Available)
	if _, err := h.Stat(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
}

func TestInflightCapFailsFastWithoutUnavailable(t *testing.T) {
	f := &fakeFS{block: make(chan struct{}), entered: make(chan struct{}, 4)}
	h := newFakeHandle(f, time.Minute, 1)
	first := make(chan error, 1)
	go func() { _, err := h.Stat(context.Background(), "a"); first <- err }()
	<-f.entered
	_, err := h.Stat(context.Background(), "b")
	wantTimeout(t, err)
	if !h.Available() {
		t.Fatal("a full cap must not mark the root unavailable")
	}
	close(f.block)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
}

func TestCancelDoesNotMarkUnavailable(t *testing.T) {
	f := &fakeFS{block: make(chan struct{}), entered: make(chan struct{}, 4)}
	h := newFakeHandle(f, time.Minute, 2)
	ctx, cancel := context.WithCancel(context.Background())
	res := make(chan error, 1)
	go func() { _, err := h.Stat(ctx, "a"); res <- err }()
	<-f.entered
	cancel()
	err := <-res
	wantTimeout(t, err)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want canceled cause, got %v", err)
	}
	if !h.Available() {
		t.Fatal("cancellation must not mark the root unavailable")
	}
	// Already-canceled context fails before any work.
	calls := f.calls.Load()
	wantTimeout(t, func() error { _, err := h.Stat(ctx, "a"); return err }())
	if f.calls.Load() != calls {
		t.Fatal("work spawned for a canceled context")
	}
	close(f.block)
	eventually(t, "slots released", func() bool { return len(h.sem) == 0 })
}

func TestOpenClosesLateFile(t *testing.T) {
	tmp, err := os.CreateTemp(t.TempDir(), "late")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeFS{block: make(chan struct{}), openFn: func() (*os.File, error) { return tmp, nil }}
	h := newFakeHandle(f, 10*time.Millisecond, 2)
	_, err = h.Open(context.Background(), "a")
	wantTimeout(t, err)
	close(f.block)
	eventually(t, "late file to be closed", func() bool {
		_, err := tmp.Stat()
		return errors.Is(err, os.ErrClosed)
	})
}

func TestProbeAtMostOneOutstanding(t *testing.T) {
	f := &fakeFS{block: make(chan struct{}), entered: make(chan struct{}, 64)}
	h := newFakeHandle(f, time.Minute, 4)
	h.unavailable.Store(true)
	for range 20 {
		if h.Available() {
			t.Fatal("should stay unavailable while the probe is stuck")
		}
		_, err := h.Stat(context.Background(), "a")
		wantTimeout(t, err)
	}
	<-f.entered
	if got := f.calls.Load(); got != 1 {
		t.Fatalf("probe calls = %d, want 1", got)
	}
	close(f.block)
	eventually(t, "probe to restore availability", h.Available)
	eventually(t, "probe slot released", func() bool { return len(h.sem) == 0 && !h.probing.Load() })
}

func TestProbeSkippedWhenNoSlot(t *testing.T) {
	f := &fakeFS{}
	h := newFakeHandle(f, time.Minute, 1)
	h.sem <- struct{}{} // occupy the only slot
	h.unavailable.Store(true)
	if h.Available() {
		t.Fatal("must stay unavailable")
	}
	if f.calls.Load() != 0 || h.probing.Load() {
		t.Fatal("probe must be skipped without a free slot")
	}
	<-h.sem
	eventually(t, "probe to restore availability", h.Available)
}

func TestCloseWithoutRoot(t *testing.T) {
	if err := newFakeHandle(&fakeFS{}, time.Second, 0).Close(); err != nil {
		t.Fatal(err)
	}
}
