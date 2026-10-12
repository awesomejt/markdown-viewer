package d2render

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fake(r *Renderer, f compileFunc) { r.compile = f }

func okFake(calls *atomic.Int32) compileFunc {
	return func(_ context.Context, _ *slot, src string, _ int64, _ string) ([]byte, error) {
		calls.Add(1)
		return []byte("<svg>" + src + "</svg>"), nil
	}
}

func TestRealRenderValid(t *testing.T) {
	r := New(Options{})
	for _, tc := range [][2]string{{"light", "dagre"}, {"dark", "elk"}, {"", ""}} {
		svg, err := r.Render(context.Background(), "a -> b: hi", tc[0], tc[1])
		if err != nil {
			t.Fatalf("%v: %v", tc, err)
		}
		if !strings.Contains(string(svg), "<svg") {
			t.Fatalf("%v: not svg: %.80s", tc, svg)
		}
	}
}

func TestRealRenderThemesDiffer(t *testing.T) {
	r := New(Options{})
	l, _ := r.Render(context.Background(), "a -> b", "light", "")
	d, _ := r.Render(context.Background(), "a -> b", "dark", "")
	if string(l) == string(d) {
		t.Fatal("light and dark output identical")
	}
}

func TestRealCompileError(t *testing.T) {
	r := New(Options{})
	_, err := r.Render(context.Background(), "a ->", "", "")
	var ce *CompileError
	if !errors.As(err, &ce) {
		t.Fatalf("want CompileError, got %v", err)
	}
	if !strings.Contains(ce.Msg, "1:") {
		t.Fatalf("no line:col in %q", ce.Msg)
	}
}

func TestImportsFail(t *testing.T) {
	r := New(Options{})
	srcs := []string{
		"x: @../../etc/passwd",
		"...@../../etc/passwd",
		"...@x",
		"x: @/etc/passwd",
		"x: @x.d2",
		"x: {\n  ...@/etc/passwd\n}",
		"...@/etc/hostname",
	}
	for _, src := range srcs {
		_, err := r.Render(context.Background(), src, "", "")
		var ce *CompileError
		if !errors.As(err, &ce) {
			t.Errorf("%q: want CompileError, got %v", src, err)
		}
	}
}

func TestEmptyFS(t *testing.T) {
	if _, err := (emptyFS{}).Open("anything"); err == nil {
		t.Fatal("expected error")
	}
}

func TestBadRequest(t *testing.T) {
	r := New(Options{})
	for _, tc := range [][2]string{{"neon", ""}, {"", "tala"}} {
		_, err := r.Render(context.Background(), "a", tc[0], tc[1])
		var br *BadRequestError
		if !errors.As(err, &br) {
			t.Fatalf("%v: got %v", tc, err)
		}
	}
}

func TestCacheHit(t *testing.T) {
	var n atomic.Int32
	r := New(Options{})
	fake(r, okFake(&n))
	for range 3 {
		if _, err := r.Render(context.Background(), "a", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if n.Load() != 1 {
		t.Fatalf("compile ran %d times", n.Load())
	}
	// Different theme/layout are distinct keys.
	_, _ = r.Render(context.Background(), "a", "dark", "")
	_, _ = r.Render(context.Background(), "a", "", "elk")
	if n.Load() != 3 {
		t.Fatalf("compile ran %d times, want 3", n.Load())
	}
}

func TestNegativeCacheCompileError(t *testing.T) {
	var n atomic.Int32
	r := New(Options{})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) {
		n.Add(1)
		return nil, &CompileError{Msg: "1:1: bad"}
	})
	for range 2 {
		_, err := r.Render(context.Background(), "x", "", "")
		var ce *CompileError
		if !errors.As(err, &ce) {
			t.Fatal(err)
		}
	}
	if n.Load() != 1 {
		t.Fatalf("ran %d times", n.Load())
	}
}

func TestTimeoutCachedAndSlotHeld(t *testing.T) {
	var n atomic.Int32
	release := make(chan struct{})
	started := make(chan struct{}, 4)
	r := New(Options{Timeout: 20 * time.Millisecond, Concurrency: 1, SlotWait: 20 * time.Millisecond})
	fake(r, func(_ context.Context, _ *slot, src string, _ int64, _ string) ([]byte, error) {
		n.Add(1)
		started <- struct{}{}
		if src == "slow" {
			<-release
		}
		return []byte("<svg/>"), nil
	})
	_, err := r.Render(context.Background(), "slow", "", "")
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("want timeout, got %v", err)
	}
	// Negative cache: no second compile.
	_, err = r.Render(context.Background(), "slow", "", "")
	if !errors.Is(err, ErrTimeout) || n.Load() != 1 {
		t.Fatalf("err=%v n=%d", err, n.Load())
	}
	// The goroutine is still running, so the only slot is still held.
	<-started
	_, err = r.Render(context.Background(), "other", "", "")
	if !errors.Is(err, ErrBusy) {
		t.Fatalf("want busy while goroutine runs, got %v", err)
	}
	close(release)
	deadline := time.After(2 * time.Second)
	for {
		if _, err = r.Render(context.Background(), "other", "", ""); err == nil {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("slot never released: %v", err)
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func TestBusyNotCached(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	r := New(Options{Concurrency: 1, SlotWait: 10 * time.Millisecond})
	fake(r, func(_ context.Context, _ *slot, src string, _ int64, _ string) ([]byte, error) {
		if src == "block" {
			close(started)
			<-release
		}
		return []byte("<svg/>"), nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := r.Render(context.Background(), "block", "", "")
		done <- err
	}()
	<-started
	if _, err := r.Render(context.Background(), "b", "", ""); !errors.Is(err, ErrBusy) {
		t.Fatalf("want busy, got %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := r.Render(context.Background(), "b", "", ""); err != nil {
		t.Fatalf("busy was cached: %v", err)
	}
}

func TestCancelNotCached(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once
	var n atomic.Int32
	r := New(Options{})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) {
		n.Add(1)
		once.Do(func() { close(started) })
		<-release
		return []byte("<svg/>"), nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		_, err := r.Render(ctx, "a", "", "")
		errc <- err
	}()
	<-started
	cancel()
	if err := <-errc; !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	close(release)
	// A later caller gets a good result (the detached render completes).
	if _, err := r.Render(context.Background(), "a", "", ""); err != nil {
		t.Fatal(err)
	}
	if n.Load() != 1 {
		t.Fatalf("ran %d times", n.Load())
	}
}

func TestSingleflight(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	var n atomic.Int32
	r := New(Options{Concurrency: 1})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) {
		if n.Add(1) == 1 {
			close(started)
		}
		<-release
		return []byte("<svg/>"), nil
	})
	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.Render(context.Background(), "same", "", ""); err != nil {
				t.Error(err)
			}
		}()
	}
	<-started
	time.Sleep(20 * time.Millisecond) // let followers join the in-flight call
	close(release)
	wg.Wait()
	if n.Load() != 1 {
		t.Fatalf("ran %d times", n.Load())
	}
}

func TestPanicRecovered(t *testing.T) {
	r := New(Options{})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) { panic("boom") })
	_, err := r.Render(context.Background(), "a", "", "")
	if err == nil || strings.Contains(err.Error(), "CompileError") {
		t.Fatalf("got %v", err)
	}
	if r.cache.len() != 0 {
		t.Fatal("panic result cached")
	}
	// Slot must have been returned.
	if _, err = r.Render(context.Background(), "b", "", ""); err == nil || errors.Is(err, ErrBusy) {
		t.Fatalf("got %v", err)
	}
}

func TestDeadlineErrorMapsToTimeout(t *testing.T) {
	r := New(Options{})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	})
	if _, err := r.Render(context.Background(), "a", "", ""); !errors.Is(err, ErrTimeout) {
		t.Fatal(err)
	}
}

func TestLRUEviction(t *testing.T) {
	c := newLRU(2, 1<<20, 1<<20)
	k := func(b byte) [32]byte { return [32]byte{b} }
	c.put(k(1), result{svg: []byte("1")})
	c.put(k(2), result{svg: []byte("2")})
	if _, ok := c.get(k(1)); !ok { // 1 becomes most recent
		t.Fatal("miss 1")
	}
	c.put(k(3), result{svg: []byte("3")}) // evicts 2
	if _, ok := c.get(k(2)); ok {
		t.Fatal("2 should be evicted")
	}
	if _, ok := c.get(k(1)); !ok {
		t.Fatal("1 should remain")
	}
	c.put(k(1), result{svg: []byte("1b")}) // update in place
	if r, _ := c.get(k(1)); string(r.svg) != "1b" || c.len() != 2 {
		t.Fatalf("update failed: %s len=%d", r.svg, c.len())
	}
	c.put(k(4), result{}) // evicts 3
	if _, ok := c.get(k(3)); ok {
		t.Fatal("3 should be evicted")
	}
}

func TestLRUByteEviction(t *testing.T) {
	k := func(b byte) [32]byte { return [32]byte{b} }
	blob := func(n int) result { return result{svg: make([]byte, n)} }
	per := int64(100 + entryOverhead)
	c := newLRU(100, 3*per, 1000)
	c.put(k(1), blob(100))
	c.put(k(2), blob(100))
	c.put(k(3), blob(100))
	if c.len() != 3 || c.size() != 3*per {
		t.Fatalf("len=%d bytes=%d", c.len(), c.size())
	}
	c.get(k(1))            // 2 is now least recent
	c.put(k(4), blob(100)) // evicts 2
	if _, ok := c.get(k(2)); ok {
		t.Fatal("2 should be evicted")
	}
	if c.len() != 3 || c.size() != 3*per {
		t.Fatalf("len=%d bytes=%d", c.len(), c.size())
	}
	// A bigger entry evicts several from the back (3, then 1).
	c.put(k(5), blob(250))
	if _, ok := c.get(k(3)); ok {
		t.Fatal("3 should be evicted")
	}
	if _, ok := c.get(k(1)); ok {
		t.Fatal("1 should be evicted")
	}
	if want := per + 250 + entryOverhead; c.len() != 2 || c.size() != want {
		t.Fatalf("len=%d bytes=%d want %d", c.len(), c.size(), want)
	}
}

func TestLRUUpdateAdjustsBytes(t *testing.T) {
	k := [32]byte{1}
	c := newLRU(10, 10000, 1000)
	c.put(k, result{svg: make([]byte, 100)})
	c.put(k, result{svg: make([]byte, 40)})
	if c.len() != 1 || c.size() != 40+entryOverhead {
		t.Fatalf("len=%d bytes=%d", c.len(), c.size())
	}
}

func TestLRUOversizeNotCached(t *testing.T) {
	k := [32]byte{1}
	c := newLRU(10, 10000, 200)
	c.put(k, result{svg: make([]byte, 100)})
	c.put(k, result{svg: make([]byte, 500)}) // removes the stale smaller entry
	if _, ok := c.get(k); ok || c.len() != 0 || c.size() != 0 {
		t.Fatalf("oversize kept: len=%d bytes=%d", c.len(), c.size())
	}
	c.put(k, result{svg: make([]byte, 500)})
	if c.len() != 0 || c.size() != 0 {
		t.Fatalf("oversize stored: len=%d bytes=%d", c.len(), c.size())
	}
}

func TestLRUErrorCountsBytes(t *testing.T) {
	c := newLRU(10, 10000, 1000)
	c.put([32]byte{1}, result{err: errors.New("boom")})
	if want := int64(len("boom")) + entryOverhead; c.size() != want {
		t.Fatalf("bytes=%d want %d", c.size(), want)
	}
}

func TestNewCacheDefaultsAndClamp(t *testing.T) {
	r := New(Options{})
	if r.cache.maxBytes != defaultCacheBytes || r.cache.maxEntry != defaultEntryBytes {
		t.Fatalf("defaults: %d %d", r.cache.maxBytes, r.cache.maxEntry)
	}
	r = New(Options{CacheBytes: 1000, MaxEntryBytes: 5000})
	if r.cache.maxBytes != 1000 || r.cache.maxEntry != 1000 {
		t.Fatalf("clamp: %d %d", r.cache.maxBytes, r.cache.maxEntry)
	}
}

func TestOversizeSVGNotCached(t *testing.T) {
	var n atomic.Int32
	r := New(Options{CacheBytes: 1 << 20, MaxEntryBytes: 1024})
	fake(r, func(context.Context, *slot, string, int64, string) ([]byte, error) {
		n.Add(1)
		return make([]byte, 2048), nil
	})
	for i := 1; i <= 2; i++ {
		svg, err := r.Render(context.Background(), "a", "", "")
		if err != nil || len(svg) != 2048 {
			t.Fatalf("render %d: len=%d err=%v", i, len(svg), err)
		}
		if int(n.Load()) != i {
			t.Fatalf("compile ran %d times after render %d", n.Load(), i)
		}
	}
}

func TestCacheKeyUnambiguous(t *testing.T) {
	if cacheKey("dagre", 0, "ab") == cacheKey("dagre", 0, "a") {
		t.Fatal("collision")
	}
	if cacheKey("dagre", 0, "x") == cacheKey("elk", 0, "x") || cacheKey("dagre", 0, "x") == cacheKey("dagre", 200, "x") {
		t.Fatal("layout/theme ignored")
	}
}
