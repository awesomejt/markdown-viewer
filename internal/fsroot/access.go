package fsroot

import (
	"context"
	"io/fs"
	"os"
	"sync/atomic"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// FS is the filesystem surface a [Handle] needs. The guarded [*Root]
// satisfies it; tests substitute fakes that are slow or block forever.
type FS interface {
	Stat(rel string) (fs.FileInfo, error)
	Lstat(rel string) (fs.FileInfo, error)
	ReadDir(rel string) ([]fs.DirEntry, error)
	Open(rel string) (*os.File, error)
}

var _ FS = (*Root)(nil)

// Handle wraps one root's filesystem with a per-operation timeout, a
// non-blocking in-flight cap, and availability tracking.
//
// Every filesystem call runs in its own goroutine; the caller selects on its
// context. A goroutine stuck on a dead mount cannot be killed, so the cap
// bounds how many can ever accumulate: the semaphore slot is released only
// when the fs call actually returns, never when the caller gives up.
//
// Availability: when an operation exceeds the handle's timeout the root is
// marked unavailable. While unavailable, calls fail immediately with
// [KindTimeout] and spawn no work, except one background probe (a Stat of ".")
// at a time, which needs a free slot. A successful probe, or any fs call that
// returns successfully, marks the root available again.
//
// Caller cancellation (or a caller deadline that fires before the handle's own
// timeout) returns [KindTimeout] too, wrapping the context error, but does
// NOT mark the root unavailable: it says nothing about the mount's health.
//
// Limitation: reads from a file returned by Open happen outside this
// machinery, so a mount that dies after Open can still block the reader.
type Handle struct {
	name       string
	watch      config.WatchMode
	fs         FS
	closer     func() error
	timeout    time.Duration
	maxEntries int

	sem         chan struct{}
	unavailable atomic.Bool
	probing     atomic.Bool
}

// NewHandle builds a Handle over fsys. closer may be nil.
func NewHandle(name string, watch config.WatchMode, fsys FS, timeout time.Duration, maxInflight, maxEntries int) *Handle {
	if maxInflight < 1 {
		maxInflight = 1
	}
	return &Handle{
		name: name, watch: watch, fs: fsys,
		timeout: timeout, maxEntries: maxEntries,
		sem: make(chan struct{}, maxInflight),
	}
}

// OpenHandle opens the configured root and wraps it with the limits in cfg.
func OpenHandle(root config.Root, cfg *config.Config) (*Handle, error) {
	r, err := OpenRoot(root)
	if err != nil {
		return nil, err
	}
	h := NewHandle(root.Name, root.Watch, r, cfg.FSTimeout, cfg.FSMaxInflight, cfg.MaxListEntries)
	h.closer = r.Close
	return h, nil
}

// Name returns the root's configured name.
func (h *Handle) Name() string { return h.name }

// Watch returns the root's configured watch mode.
func (h *Handle) Watch() config.WatchMode { return h.watch }

// Close releases the underlying root, if the handle owns one.
func (h *Handle) Close() error {
	if h.closer == nil {
		return nil
	}
	return h.closer()
}

// Available reports whether the root is believed healthy. While unavailable it
// also starts a recovery probe (at most one outstanding), whose result shows
// up in later calls.
func (h *Handle) Available() bool {
	if !h.unavailable.Load() {
		return true
	}
	h.probe()
	return !h.unavailable.Load()
}

func (h *Handle) tryAcquire() bool {
	select {
	case h.sem <- struct{}{}:
		return true
	default:
		return false
	}
}

func (h *Handle) release() { <-h.sem }

func (h *Handle) probe() {
	if !h.probing.CompareAndSwap(false, true) {
		return
	}
	if !h.tryAcquire() {
		h.probing.Store(false)
		return
	}
	go func() {
		_, err := h.fs.Stat(".")
		if err == nil {
			h.unavailable.Store(false)
		}
		h.release()
		h.probing.Store(false)
	}()
}

func timeoutErr(op, rel, reason string, err error) error {
	return &PathError{Kind: KindTimeout, Op: op, Path: rel, Reason: reason, Err: err}
}

type result[T any] struct {
	val T
	err error
}

// run executes fn under the timeout and slot machinery. cleanup, if non-nil,
// disposes of a value that completed after the caller gave up.
func run[T any](ctx context.Context, h *Handle, op, rel string, fn func() (T, error), cleanup func(T)) (T, error) {
	var zero T
	if err := ctx.Err(); err != nil {
		return zero, timeoutErr(op, rel, "request canceled", err)
	}
	if h.unavailable.Load() {
		h.probe()
		return zero, timeoutErr(op, rel, "root unavailable", nil)
	}
	if !h.tryAcquire() {
		return zero, timeoutErr(op, rel, "too many operations in flight", nil)
	}
	const (
		pending = iota
		delivered
		abandoned
	)
	var state atomic.Int32
	done := make(chan result[T], 1)
	go func() {
		defer h.release()
		v, err := fn()
		if err == nil {
			h.unavailable.Store(false)
		}
		if state.CompareAndSwap(pending, delivered) {
			done <- result[T]{v, err}
			return
		}
		if err == nil && cleanup != nil {
			cleanup(v)
		}
	}()

	tctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	select {
	case r := <-done:
		return r.val, r.err
	case <-tctx.Done():
	}
	if !state.CompareAndSwap(pending, abandoned) {
		r := <-done // finished at the last moment; use it
		return r.val, r.err
	}
	if cerr := ctx.Err(); cerr != nil {
		return zero, timeoutErr(op, rel, "request canceled", cerr)
	}
	// Benign race: the abandoned fs call may succeed right after this point and
	// clear the flag before (or after) we set it. If we set it last, the next
	// call or Available() probe clears it again, so it self-heals. A slow but
	// succeeding mount can therefore flap between available and unavailable.
	h.unavailable.Store(true)
	return zero, timeoutErr(op, rel, "filesystem timeout", tctx.Err())
}
