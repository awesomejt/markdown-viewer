package fsroot

import (
	"errors"
	"io/fs"
	"os"
	"sync"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// lazyRoot is an [FS] that opens its [Root] on first use, so a root that is
// down at boot (a NAS that has not mounted yet) does not stop the server. An
// open that fails is retried by the next call; the [Handle] only issues such
// calls from its timeout machinery or its recovery probe.
//
// Opening can block on a dead mount, so it never runs under the state lock:
// openMu serializes open attempts (callers queue inside goroutines that
// already hold a Handle slot) while mu only guards the fields and is never
// held across filesystem calls.
type lazyRoot struct {
	cfg  config.Root
	open func(config.Root) (*Root, error)

	openMu sync.Mutex // serializes open attempts

	mu     sync.Mutex // guards root and closed
	root   *Root
	closed bool
}

var _ FS = (*lazyRoot)(nil)

var errRootClosed = errors.New("root closed")

func newLazyRoot(cfg config.Root, open func(config.Root) (*Root, error)) *lazyRoot {
	return &lazyRoot{cfg: cfg, open: open}
}

// get returns the open root, opening it if needed. A failure is a
// [KindTimeout] error: the root is simply not reachable yet, which must not
// be mistaken for a missing client path (404).
func (l *lazyRoot) get(op string) (*Root, error) {
	l.mu.Lock()
	r, closed := l.root, l.closed
	l.mu.Unlock()
	if closed {
		return nil, timeoutErr(op, ".", "root closed", errRootClosed)
	}
	if r != nil {
		return r, nil
	}

	l.openMu.Lock()
	defer l.openMu.Unlock()
	l.mu.Lock()
	r, closed = l.root, l.closed
	l.mu.Unlock()
	if closed {
		return nil, timeoutErr(op, ".", "root closed", errRootClosed)
	}
	if r != nil {
		return r, nil
	}
	r, err := l.open(l.cfg)
	if err != nil {
		return nil, timeoutErr(op, ".", "root unavailable", err)
	}
	l.mu.Lock()
	if l.closed {
		// Closed while the open was in flight: do not leak the new root.
		l.mu.Unlock()
		_ = r.Close()
		return nil, timeoutErr(op, ".", "root closed", errRootClosed)
	}
	l.root = r
	l.mu.Unlock()
	return r, nil
}

func (l *lazyRoot) Stat(rel string) (fs.FileInfo, error) {
	r, err := l.get("stat")
	if err != nil {
		return nil, err
	}
	return r.Stat(rel)
}

func (l *lazyRoot) Lstat(rel string) (fs.FileInfo, error) {
	r, err := l.get("lstat")
	if err != nil {
		return nil, err
	}
	return r.Lstat(rel)
}

func (l *lazyRoot) ReadDir(rel string) ([]fs.DirEntry, error) {
	r, err := l.get("readdir")
	if err != nil {
		return nil, err
	}
	return r.ReadDir(rel)
}

func (l *lazyRoot) Open(rel string) (*os.File, error) {
	r, err := l.get("open")
	if err != nil {
		return nil, err
	}
	return r.Open(rel)
}

// Close releases the root if it was opened and makes later opens fail. It never
// waits for an open attempt in flight; that attempt closes its own result when
// it finishes, unless it hangs forever, in which case it holds one goroutine
// (already bounded by the Handle's in-flight cap).
func (l *lazyRoot) Close() error {
	l.mu.Lock()
	r := l.root
	l.root = nil
	l.closed = true
	l.mu.Unlock()
	if r == nil {
		return nil
	}
	return r.Close()
}
