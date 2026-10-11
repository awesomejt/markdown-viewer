package watch

import (
	"errors"
	"log/slog"
	"path"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// fsWatch is one key's interest in a host directory. For a directory key the
// host directory is the path itself; for a file key it is the parent, and
// events are filtered to base so editors that write via rename are caught.
// handle runs only on the notifier's reader goroutine, so exists needs no lock.
type fsWatch struct {
	fsn    *fsnotifier
	co     *coalescer
	path   string // normalized watched path ("" is the root)
	host   string // host directory handed to the kernel; never leaves this package
	isDir  bool
	base   string // file name within host, for file keys
	exists bool   // file keys: last known presence
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
	if w.isDir {
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
// (instances are a scarce per-user resource) and refcounts host directories.
type fsnotifier struct {
	w      *fsnotify.Watcher
	logger *slog.Logger

	mu   sync.Mutex
	dirs map[string]map[*fsWatch]struct{}
}

func newFSNotifier(logger *slog.Logger, wg *sync.WaitGroup) (*fsnotifier, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	f := &fsnotifier{w: w, logger: logger, dirs: make(map[string]map[*fsWatch]struct{})}
	wg.Go(f.loop)
	return f, nil
}

// add registers w, starting a kernel watch on its host directory if it is the
// first interested key.
func (f *fsnotifier) add(w *fsWatch) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	set := f.dirs[w.host]
	if set == nil {
		if err := f.w.Add(w.host); err != nil {
			return err
		}
		set = make(map[*fsWatch]struct{})
		f.dirs[w.host] = set
	}
	set[w] = struct{}{}
	return nil
}

// remove unregisters w and drops the kernel watch with the last interested key.
func (f *fsnotifier) remove(w *fsWatch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	set := f.dirs[w.host]
	delete(set, w)
	if len(set) == 0 {
		delete(f.dirs, w.host)
		_ = f.w.Remove(w.host) // already gone when the directory was deleted
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
	f.mu.Unlock()
	for _, w := range children {
		w.child(ev)
	}
	for _, w := range selves {
		w.self(ev)
	}
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
