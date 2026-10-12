package fsroot

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
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
// bounded in-flight cap, and availability tracking.
//
// Every filesystem call runs in its own goroutine; the caller selects on its
// context. A goroutine stuck on a dead mount cannot be killed, so the cap
// bounds how many can ever accumulate: the semaphore slot is released only
// when the fs call actually returns, never when the caller gives up. Callers
// that find the cap full wait for a slot (spawning no goroutine) within the
// same budget as the operation itself, MDV_FS_TIMEOUT; a wait that expires is a
// [KindTimeout] but does not mark the root unavailable.
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
// Reads: the file returned by Open is not itself covered, but [Handle.Reader]
// wraps it so each Read runs under the same timeout and slot machinery. Use it
// for any read of a file that may live on a network mount.
type Handle struct {
	name       string
	watch      config.WatchMode
	hostDir    string // absolute host path of the root; empty for test handles
	fs         FS
	closer     func() error
	timeout    time.Duration
	maxEntries int

	sem         chan struct{}
	unavailable atomic.Bool
	probing     atomic.Bool
	startErr    error // why the root was unavailable at creation; nil if it was not
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

// OpenHandle wraps the configured root with the limits in cfg. The root is
// opened lazily, and one initial open plus Stat of "." is attempted within
// cfg.FSTimeout.
//
// A root that is not a directory is a fatal misconfiguration and returns an
// error. Any other failure (missing path, I/O error, permission, stale mount,
// no answer in time) is not: the handle starts unavailable, requests fail fast
// with [KindTimeout], and the recovery probe retries until the root answers.
// [Handle.StartupErr] reports why such a handle started unavailable.
func OpenHandle(root config.Root, cfg *config.Config) (*Handle, error) {
	return openHandle(root, cfg, OpenRoot)
}

func openHandle(root config.Root, cfg *config.Config, open func(config.Root) (*Root, error)) (*Handle, error) {
	lr := newLazyRoot(root, open)
	h := NewHandle(root.Name, root.Watch, lr, cfg.FSTimeout, cfg.FSMaxInflight, cfg.MaxListEntries)
	h.closer = lr.Close
	if abs, aerr := filepath.Abs(root.Path); aerr == nil {
		h.hostDir = abs
	}
	_, err := run(context.Background(), h, "open", ".", func() (struct{}, error) {
		fi, err := lr.Stat(".")
		if err == nil && !fi.IsDir() {
			return struct{}{}, errNotDir
		}
		return struct{}{}, err
	}, nil)
	if err == nil {
		return h, nil
	}
	if errors.Is(err, errNotDir) || errors.Is(err, syscall.ENOTDIR) {
		_ = h.Close()
		return nil, fmt.Errorf("fsroot: root %q: path %q is not a directory", root.Name, root.Path)
	}
	h.unavailable.Store(true)
	h.startErr = err
	return h, nil
}

var errNotDir = errors.New("not a directory")

// StartupErr returns why the root was unavailable when the handle was created,
// or nil if it was available. It is a snapshot: the root may have recovered
// since. It can contain host paths and is for logs only.
func (h *Handle) StartupErr() error { return h.startErr }

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

// acquire takes a slot, waiting until ctx is done if none is free.
func (h *Handle) acquire(ctx context.Context) bool {
	if h.tryAcquire() {
		return true
	}
	select {
	case h.sem <- struct{}{}:
		return true
	case <-ctx.Done():
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
	// One budget covers both the slot wait and the operation.
	tctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	if !h.acquire(tctx) {
		if cerr := ctx.Err(); cerr != nil {
			return zero, timeoutErr(op, rel, "request canceled", cerr)
		}
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
