package fsroot

import (
	"context"
	"io/fs"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestClassifyNameProject(t *testing.T) {
	cases := map[string]FileKind{
		"a.mdv.yaml":      FileKindProject,
		"a/b/x.mdv.yml":   FileKindProject,
		".mdv.yaml":       FileKindProject,
		".mdv.yml":        FileKindProject,
		"d/.MDV.YML":      FileKindProject,
		"Course.MDV.Yaml": FileKindProject,
		"plain.yaml":      FileKindText,
		"plain.yml":       FileKindText,
		"mdv.yaml":        FileKindText,
		"x.mdv.yaml.bak":  FileKindOther,
		"x.mdv.json":      FileKindText,
		".hidden":         FileKindOther,
	}
	for name, want := range cases {
		if got := ClassifyName(name); got != want {
			t.Errorf("ClassifyName(%q) = %q, want %q", name, got, want)
		}
	}
	if KindForExt(".yaml") != FileKindText {
		t.Error("KindForExt must be unchanged")
	}
}

func TestStatLimitSizes(t *testing.T) {
	for in, want := range map[int]int{1: 1, 2: 1, 3: 2, 4: 2, 64: 2, 0: 1} {
		if got := newFakeHandle(&fakeFS{}, time.Second, in).StatLimit(); got != want {
			t.Errorf("inflight %d: limit %d, want %d", in, got, want)
		}
	}
}

func TestLimitedStatBound(t *testing.T) {
	f := &fakeFS{block: make(chan struct{}), entered: make(chan struct{}, 64)}
	h := newFakeHandle(f, 5*time.Second, 4) // limit 2
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	for range 10 {
		go func() { _, _ = h.LimitedStat(ctx, "x"); done <- struct{}{} }()
	}
	eventually(t, "two stats in flight", func() bool { return f.stuck.Load() == 2 })
	time.Sleep(50 * time.Millisecond)
	if n := f.maxSeen.Load(); n != 2 {
		t.Fatalf("max concurrent stats %d, want 2", n)
	}
	// A normal operation still gets one of the two remaining Handle slots.
	if !h.tryAcquire() {
		t.Fatal("no free handle slot left for other requests")
	}
	h.release()
	cancel() // waiting callers give up; the two in the fs finish when released
	close(f.block)
	for range 10 {
		<-done
	}
}

func TestLimitedStatCanceledWhileWaiting(t *testing.T) {
	f := &fakeFS{block: make(chan struct{})}
	defer close(f.block)
	h := newFakeHandle(f, 5*time.Second, 2) // limit 1
	go func() { _, _ = h.LimitedStat(context.Background(), "a") }()
	eventually(t, "slot taken", func() bool { return f.stuck.Load() == 1 })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := h.LimitedStat(ctx, "b")
	wantTimeout(t, err)
}

// selFS blocks Stat for every name except "." (the recovery probe), counting
// the blocked calls per name.
type selFS struct {
	fakeFS
	block   chan struct{}
	started sync.Map // name -> *atomic.Int32
}

func (f *selFS) Stat(rel string) (fs.FileInfo, error) {
	if rel == "." {
		return fakeInfo{}, nil
	}
	c, _ := f.started.LoadOrStore(rel, new(atomic.Int32))
	c.(*atomic.Int32).Add(1)
	<-f.block
	return fakeInfo{}, nil
}

func (f *selFS) count(rel string) int32 {
	if c, ok := f.started.Load(rel); ok {
		return c.(*atomic.Int32).Load()
	}
	return 0
}

func TestLimitedStatSlotHeldUntilFSReturns(t *testing.T) {
	f := &selFS{block: make(chan struct{})}
	h := newFakeHandle(f, 30*time.Millisecond, 8) // limit 2, plenty of handle slots
	for _, name := range []string{"a", "b"} {
		_, err := h.LimitedStat(context.Background(), name)
		wantTimeout(t, err) // abandoned after the handle timeout; the fs call is still stuck
		h.unavailable.Store(false)
	}
	// Both limiter slots are held by the stuck calls. A recovered flag (any
	// success elsewhere) must not let a third stat start: only the limiter,
	// not the handle's own slots, can be what blocks it.
	h.unavailable.Store(false)
	_, err := h.LimitedStat(context.Background(), "c")
	wantTimeout(t, err)
	if f.count("c") != 0 {
		t.Fatal("third stat reached the fs while both limiter slots were held")
	}
	close(f.block)
	eventually(t, "slots released after the fs calls returned", func() bool {
		_, err := h.LimitedStat(context.Background(), "d")
		return err == nil
	})
}

func TestLimitedStatFailsFastWhenUnavailable(t *testing.T) {
	f := &fakeFS{}
	h := newFakeHandle(f, time.Second, 4)
	h.unavailable.Store(true)
	f.block = make(chan struct{})
	defer close(f.block)
	start := time.Now()
	_, err := h.LimitedStat(context.Background(), "a")
	wantTimeout(t, err)
	if time.Since(start) > 200*time.Millisecond {
		t.Fatal("did not fail fast")
	}
}

func TestLimitedStatBadPathAndCanceled(t *testing.T) {
	h := newFakeHandle(&fakeFS{}, time.Second, 4)
	if _, err := h.LimitedStat(context.Background(), "../x"); KindOf(err) != KindBadRequest {
		t.Fatalf("got %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := h.LimitedStat(ctx, "x")
	wantTimeout(t, err)
	if _, err := h.LimitedStat(context.Background(), "x"); err != nil {
		t.Fatal(err)
	}
}
