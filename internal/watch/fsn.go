package watch

import (
	"context"
	"errors"
	"log/slog"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// rearmTimeout bounds one re-validation pass through the guarded handle.
const rearmTimeout = 5 * time.Second

// fsWatch is one key's interest in a host directory. For a directory key the
// host directory is the path itself; for a file key it is the parent, and
// events are filtered to base so editors that write via rename are caught.
//
// The kernel drops an inotify watch when its directory is deleted or renamed
// away, so a watch is "armed" only while the kernel watch is live. A disarmed
// watch instead holds a kernel watch on its nearest existing ancestor (never
// above the root) and re-arms when the missing directory reappears.
type fsWatch struct {
	fsn     *fsnotifier
	co      *coalescer
	h       *fsroot.Handle // guards re-arming against recreated symlinks
	path    string         // normalized watched path ("" is the root)
	hostRel string         // root-relative path of the host directory
	host    string         // host directory handed to the kernel; never leaves this package
	isDir   bool
	base    string // file name within host, for file keys

	mu      sync.Mutex // guards exists and deleted (reader and re-arm goroutines)
	exists  bool       // file keys: last known presence
	deleted bool       // dir keys: reported deleted and not yet recreated

	// Guarded by fsn.mu.
	armed bool   // the kernel watch on host is live
	anc   string // while disarmed: ancestor host dir holding a kernel ref
	next  string // while disarmed: path whose creation should trigger a re-check
	dead  bool   // removed from the notifier
	busy  bool   // a re-arm goroutine is running
	again bool   // another trigger arrived while busy
}

func (w *fsWatch) stop() {
	w.fsn.remove(w)
	w.co.stop()
}

// self handles an event on the watched host directory itself.
func (w *fsWatch) self(ev fsnotify.Event) {
	if !ev.Has(fsnotify.Remove) && !ev.Has(fsnotify.Rename) {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.isDir {
		w.deleted = true
		w.co.add(w.path, OpDeleted)
	} else if w.exists {
		w.exists = false
		w.co.add(w.path, OpDeleted)
	}
}

// child handles an event on a direct child of the host directory.
func (w *fsWatch) child(ev fsnotify.Event) {
	name := filepath.Base(ev.Name)
	gone := ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename)
	if !w.isDir {
		if name != w.base {
			return
		}
		w.mu.Lock()
		defer w.mu.Unlock()
		switch {
		case gone:
			w.exists = false
			w.co.add(w.path, OpDeleted)
		case ev.Has(fsnotify.Create):
			op := OpCreated
			if w.exists {
				op = OpModified // rename-over of an existing file
			}
			w.exists = true
			w.co.add(w.path, op)
		case ev.Has(fsnotify.Write):
			w.exists = true
			w.co.add(w.path, OpModified)
		}
		return
	}
	cp := path.Join(w.path, name)
	switch {
	case gone:
		w.co.add(cp, OpDeleted)
		w.co.add(w.path, OpModified)
	case ev.Has(fsnotify.Create):
		w.co.add(cp, OpCreated)
		w.co.add(w.path, OpModified)
	case ev.Has(fsnotify.Write):
		w.co.add(cp, OpModified)
	}
}

// fsnotifier multiplexes every fsnotify watch over one inotify instance
// (instances are a scarce per-user resource) and refcounts kernel watches per
// host directory, shared between armed watches and ancestor watches.
type fsnotifier struct {
	w      *fsnotify.Watcher
	logger *slog.Logger
	ctx    context.Context // ends with the hub; bounds re-arm work
	wg     *sync.WaitGroup

	mu   sync.Mutex
	dirs map[string]map[*fsWatch]struct{} // host dir -> interested keys
	refs map[string]int                   // kernel-watched path -> holders
}

func newFSNotifier(ctx context.Context, logger *slog.Logger, wg *sync.WaitGroup) (*fsnotifier, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	f := &fsnotifier{w: w, logger: logger, ctx: ctx, wg: wg,
		dirs: make(map[string]map[*fsWatch]struct{}), refs: make(map[string]int)}
	wg.Go(f.loop)
	return f, nil
}

// acquire takes a reference on the kernel watch for p, adding it first if
// nobody holds it. Callers hold f.mu.
func (f *fsnotifier) acquire(p string) error {
	if f.refs[p] == 0 {
		if err := f.w.Add(p); err != nil {
			return err
		}
	}
	f.refs[p]++
	return nil
}

// release drops a reference, removing the kernel watch with the last one. The
// kernel may have dropped it already when the directory was deleted. Callers
// hold f.mu.
func (f *fsnotifier) release(p string) {
	if f.refs[p] > 1 {
		f.refs[p]--
		return
	}
	delete(f.refs, p)
	_ = f.w.Remove(p)
}

// add registers w, starting a kernel watch on its host directory if it is the
// first interested key.
func (f *fsnotifier) add(w *fsWatch) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.acquire(w.host); err != nil {
		return err
	}
	w.armed = true
	set := f.dirs[w.host]
	if set == nil {
		set = make(map[*fsWatch]struct{})
		f.dirs[w.host] = set
	}
	set[w] = struct{}{}
	return nil
}

// remove unregisters w and drops its kernel watches with the last holder.
func (f *fsnotifier) remove(w *fsWatch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.dead = true
	if w.armed {
		w.armed = false
		f.release(w.host)
	}
	if w.anc != "" {
		f.release(w.anc)
		w.anc = ""
	}
	set := f.dirs[w.host]
	delete(set, w)
	if len(set) == 0 {
		delete(f.dirs, w.host)
	}
}

func (f *fsnotifier) close() { _ = f.w.Close() }

func (f *fsnotifier) loop() {
	for {
		select {
		case ev, ok := <-f.w.Events:
			if !ok {
				return
			}
			f.route(ev)
		case err, ok := <-f.w.Errors:
			if !ok {
				return
			}
			f.error(err)
		}
	}
}

// route delivers ev to the watches it concerns, outside the lock so handlers
// may take other locks.
func (f *fsnotifier) route(ev fsnotify.Event) {
	f.mu.Lock()
	var children, selves []*fsWatch
	for w := range f.dirs[filepath.Dir(ev.Name)] {
		children = append(children, w)
	}
	for w := range f.dirs[ev.Name] {
		selves = append(selves, w)
	}
	f.trackLocked(ev)
	f.mu.Unlock()
	for _, w := range children {
		w.child(ev)
	}
	for _, w := range selves {
		w.self(ev)
	}
}

// trackLocked keeps armed state in step with the kernel. When a directory is
// removed or renamed away the kernel watch on it is gone, so every watch that
// relied on it (as host or as ancestor) is disarmed and re-evaluated. When
// something is created where a disarmed watch is waiting, it is re-evaluated
// too.
func (f *fsnotifier) trackLocked(ev fsnotify.Event) {
	gone := ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename)
	created := ev.Has(fsnotify.Create)
	if !gone && !created {
		return
	}
	dropped := false
	for _, set := range f.dirs {
		for w := range set {
			switch {
			case gone && w.armed && w.host == ev.Name:
				w.armed = false
				dropped = true
				f.kick(w)
			case gone && !w.armed && w.anc == ev.Name:
				w.anc = ""
				dropped = true
				f.kick(w)
			case created && !w.armed && w.next == ev.Name:
				f.kick(w)
			}
		}
	}
	if dropped {
		// Forget every holder at once so a recreated directory is re-added
		// to the kernel rather than trusted as still watched.
		delete(f.refs, ev.Name)
		_ = f.w.Remove(ev.Name) // renamed-away inodes keep their watch
	}
}

// kick schedules a re-arm pass for w, coalescing triggers that arrive while
// one is running. The pass runs in a goroutine tracked by the hub's WaitGroup
// rather than inline: it does filesystem work through the guarded handle
// (bounded by rearmTimeout and the hub context), which must never stall the
// reader goroutine that drains the inotify queue. Callers hold f.mu.
func (f *fsnotifier) kick(w *fsWatch) {
	if w.dead {
		return
	}
	if w.busy {
		w.again = true
		return
	}
	w.busy = true
	f.wg.Go(func() { f.rearm(w) })
}

func (f *fsnotifier) rearm(w *fsWatch) {
	for {
		f.mu.Lock()
		w.again = false
		dead := w.dead
		f.mu.Unlock()
		if !dead {
			f.step(w)
		}
		f.mu.Lock()
		if !w.again {
			w.busy = false
			f.mu.Unlock()
			return
		}
		f.mu.Unlock()
	}
}

// step finds the deepest existing, valid level on the way from w's host
// directory up to the root: the host directory itself re-arms the watch, any
// ancestor is watched until the next level down appears. Every level is
// re-validated through the guarded handle and must be a real directory, so a
// path recreated as a symlink out of the root is never watched.
func (f *fsnotifier) step(w *fsWatch) {
	ctx, cancel := context.WithTimeout(f.ctx, rearmTimeout)
	defer cancel()
	rel := w.hostRel
	for ctx.Err() == nil {
		host, fi, err := w.h.HostPath(ctx, rel)
		if err == nil && fi.IsDir() {
			done, recheck := f.arm(ctx, w, rel, host)
			if done && !recheck {
				return
			}
			if recheck {
				rel = w.hostRel // the level below may have appeared meanwhile
				continue
			}
		}
		if rel == "" {
			// Not even the root directory is there; nothing to wait on.
			f.logger.Warn("fsnotify: root directory unavailable, watch stays disarmed", "path", w.path)
			f.mu.Lock()
			f.dropAncLocked(w)
			f.mu.Unlock()
			return
		}
		rel = parentRel(rel)
	}
}

// arm applies the level found by step. done reports that the level was usable;
// recheck that the ancestor watch changed, so existence must be re-evaluated
// now that the watch is live (the directory may have appeared in between).
func (f *fsnotifier) arm(ctx context.Context, w *fsWatch, rel, host string) (done, recheck bool) {
	f.mu.Lock()
	if w.dead {
		f.mu.Unlock()
		return true, false
	}
	if rel == w.hostRel {
		if err := f.acquire(host); err != nil {
			f.mu.Unlock()
			return false, false
		}
		f.dropAncLocked(w)
		w.armed = true
		w.next = ""
		f.mu.Unlock()
		f.catchUp(ctx, w)
		return true, false
	}
	if w.anc == host {
		f.mu.Unlock()
		return true, false
	}
	if err := f.acquire(host); err != nil {
		f.mu.Unlock()
		return false, false
	}
	f.dropAncLocked(w)
	w.anc = host
	w.next = filepath.Join(host, childToward(rel, w.hostRel))
	f.mu.Unlock()
	return true, true
}

// dropAncLocked releases w's ancestor watch, if any.
func (f *fsnotifier) dropAncLocked(w *fsWatch) {
	if w.anc != "" {
		f.release(w.anc)
	}
	w.anc, w.next = "", ""
}

// catchUp reports what may have happened between the directory's recreation
// and the kernel watch going live.
func (f *fsnotifier) catchUp(ctx context.Context, w *fsWatch) {
	if w.isDir {
		w.mu.Lock()
		if w.deleted {
			w.deleted = false
			w.co.add(w.path, OpCreated)
		}
		w.co.add(w.path, OpModified)
		w.mu.Unlock()
		return
	}
	_, err := w.h.Stat(ctx, w.path)
	if err != nil {
		return
	}
	w.mu.Lock()
	if !w.exists {
		w.exists = true
		w.co.add(w.path, OpCreated)
	}
	w.mu.Unlock()
}

// parentRel is the root-relative parent of a non-root rel ("" is the root).
func parentRel(rel string) string {
	if i := strings.LastIndexByte(rel, '/'); i >= 0 {
		return rel[:i]
	}
	return ""
}

// childToward is the name of the child of ancestor rel that leads to target.
func childToward(rel, target string) string {
	rest := target
	if rel != "" {
		rest = strings.TrimPrefix(target, rel+"/")
	}
	name, _, _ := strings.Cut(rest, "/")
	return name
}

func (f *fsnotifier) error(err error) {
	if !errors.Is(err, fsnotify.ErrEventOverflow) {
		f.logger.Warn("fsnotify error", "err", err)
		return
	}
	// Events were lost: tell everyone to refetch.
	f.logger.Warn("fsnotify queue overflow")
	f.mu.Lock()
	var all []*fsWatch
	for _, set := range f.dirs {
		for w := range set {
			all = append(all, w)
		}
	}
	f.mu.Unlock()
	for _, w := range all {
		w.co.add(w.path, OpModified)
	}
}
