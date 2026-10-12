package fsroot

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

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
//
// Remounts: a root opened before its NAS is mounted holds the empty
// mount-point directory, and the mount appearing later does not change that
// descriptor. At most once per checkEvery, a call compares the device and
// inode of the host path with those of the open root; when they differ (a
// mount appeared or went away, or the directory was replaced) the root is
// reopened. The replaced root is retired rather than closed, because calls may
// still be using it; it is closed at the next swap or by Close.
//
// Path pinning: the configured path is resolved once (symlinks included) at
// the first open attempt that finds it, and every open uses that pinned path.
// After each open, the pinned path must still be a real directory, not a
// symlink, with the identity of the opened root. Someone who can write to the
// root's parent folder therefore cannot redirect the root by replacing it with
// a symlink (FIX-21): the reopen fails and the root stays unavailable until
// the directory is back. Symlinks in the parent folders are only resolved
// once, so those folders must not be writable by untrusted users.
type lazyRoot struct {
	cfg        config.Root
	open       func(config.Root) (*Root, error)
	checkEvery time.Duration

	openMu sync.Mutex // serializes open and revalidation attempts

	// pinned is the resolved root path; set once by the first resolve and
	// then read only under openMu.
	pinned string

	mu        sync.Mutex // guards the fields below
	root      *Root
	id        fileID // identity of root's directory; valid when hasID
	hasID     bool
	lastCheck time.Time
	retired   *Root
	closed    bool
}

// fileID identifies a directory by device and inode.
type fileID struct{ dev, ino uint64 }

// rootCheckInterval bounds how often a lazyRoot compares its host path with
// the open root (one extra stat per interval while the root is in use).
const rootCheckInterval = 2 * time.Second

var _ FS = (*lazyRoot)(nil)

var errRootClosed = errors.New("root closed")

// errRootMoved means the pinned root path no longer names the opened
// directory, for example because it was replaced by a symlink.
var errRootMoved = errors.New("root path replaced (symlink or moved directory)")

func newLazyRoot(cfg config.Root, open func(config.Root) (*Root, error)) *lazyRoot {
	return &lazyRoot{cfg: cfg, open: open, checkEvery: rootCheckInterval}
}

// get returns the open root, opening it if needed. A failure is a
// [KindTimeout] error: the root is simply not reachable yet, which must not
// be mistaken for a missing client path (404).
func (l *lazyRoot) get(op string) (*Root, error) {
	l.mu.Lock()
	r, closed := l.root, l.closed
	check := r != nil && l.claimCheckLocked()
	l.mu.Unlock()
	if closed {
		return nil, timeoutErr(op, ".", "root closed", errRootClosed)
	}
	if r != nil && !check {
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
		if !check {
			return r, nil
		}
		return l.revalidate(op, r)
	}
	return l.reopen(op, nil)
}

// claimCheckLocked reports whether the caller should revalidate the open
// root now, and if so records the check so concurrent callers skip it.
func (l *lazyRoot) claimCheckLocked() bool {
	now := time.Now()
	if now.Sub(l.lastCheck) < l.checkEvery {
		return false
	}
	l.lastCheck = now
	return true
}

// revalidate returns cur unless the host path now names a different directory,
// in which case it reopens. A failed stat of the host path keeps cur: the
// operation itself will report the outage. Callers hold openMu.
func (l *lazyRoot) revalidate(op string, cur *Root) (*Root, error) {
	l.mu.Lock()
	id, hasID := l.id, l.hasID
	l.mu.Unlock()
	if !hasID {
		return cur, nil
	}
	fi, err := os.Stat(l.pinned)
	if err != nil {
		return cur, nil
	}
	if now, ok := fileIdentity(fi); !ok || now == id {
		return cur, nil
	}
	return l.reopen(op, cur)
}

// reopen opens the root and installs it in place of old (nil when none is
// open). If the open fails, old is retired so the next call retries. Callers
// hold openMu.
func (l *lazyRoot) reopen(op string, old *Root) (*Root, error) {
	r, id, hasID, err := l.openPinned()
	l.mu.Lock()
	if l.closed {
		// Closed while the open was in flight: do not leak the new root.
		l.mu.Unlock()
		if r != nil {
			_ = r.Close()
		}
		return nil, timeoutErr(op, ".", "root closed", errRootClosed)
	}
	var stale *Root
	if old != nil {
		stale, l.retired = l.retired, old
	}
	if err != nil {
		l.root, l.hasID = nil, false
	} else {
		l.root, l.id, l.hasID, l.lastCheck = r, id, hasID, time.Now()
	}
	l.mu.Unlock()
	if stale != nil {
		_ = stale.Close()
	}
	if err != nil {
		return nil, timeoutErr(op, ".", "root unavailable", err)
	}
	return r, nil
}

// openPinned resolves the root path on first use, opens the pinned path and
// checks that it still names the opened directory. It returns the identity of
// the opened directory (hasID is false where identities are unsupported, which
// also disables the check). Callers hold openMu.
func (l *lazyRoot) openPinned() (r *Root, id fileID, hasID bool, err error) {
	if l.pinned == "" {
		p, perr := filepath.Abs(l.cfg.Path)
		if perr == nil {
			p, perr = filepath.EvalSymlinks(p)
		}
		if perr != nil {
			// Not found yet (a mount point created later) or unreadable.
			return nil, fileID{}, false, perr
		}
		l.pinned = p
	}
	cfg := l.cfg
	cfg.Path = l.pinned
	if r, err = l.open(cfg); err != nil {
		return nil, fileID{}, false, err
	}
	// Identify the directory actually opened, not whatever the path names
	// now; a failure only disables remount detection for this root.
	fi, serr := r.root.Stat(".")
	if serr == nil {
		id, hasID = fileIdentity(fi)
	}
	if !hasID {
		return r, id, false, nil
	}
	// Lstat does not follow a symlink in the last component, so a root
	// replaced by a symlink (or swapped and restored around the open) fails.
	li, lerr := os.Lstat(l.pinned)
	if lerr == nil && li.IsDir() {
		if now, ok := fileIdentity(li); ok && now == id {
			return r, id, true, nil
		}
	}
	_ = r.Close()
	return nil, fileID{}, false, fmt.Errorf("fsroot: root %q: %w", cfg.Name, errRootMoved)
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

// Close releases the root (and any retired one) and makes later opens fail. It
// never waits for an open attempt in flight; that attempt closes its own result
// when it finishes, unless it hangs forever, in which case it holds one
// goroutine (already bounded by the Handle's in-flight cap).
func (l *lazyRoot) Close() error {
	l.mu.Lock()
	r, old := l.root, l.retired
	l.root, l.retired = nil, nil
	l.closed = true
	l.mu.Unlock()
	var errs []error
	for _, x := range []*Root{r, old} {
		if x != nil {
			errs = append(errs, x.Close())
		}
	}
	return errors.Join(errs...)
}
