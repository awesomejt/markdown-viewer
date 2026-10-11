package watch

import (
	"context"
	"io/fs"
	"path"
	"sync"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// pollState is one observation of a watched path.
type pollState struct {
	exists bool
	// File fields.
	size  int64
	ino   uint64
	mtime int64 // ns; also the directory's own mtime
	// Directory field: the child name set; nil for files.
	names map[string]struct{}
}

// poller watches one path by periodic observation. It runs one goroutine and
// never overlaps polls: the next tick is simply dropped while a poll is still
// waiting on the filesystem (bounded by MDV_FS_TIMEOUT and the root's
// in-flight cap), so a dead mount cannot accumulate goroutines.
type poller struct {
	h        *fsroot.Handle
	path     string // normalized: "" is the root
	isDir    bool
	interval time.Duration
	co       *coalescer
	prev     pollState

	cancel context.CancelFunc
	done   chan struct{}
}

// observeFile converts file info to a state.
func observeFile(fi fs.FileInfo) pollState {
	return pollState{exists: true, size: fi.Size(), mtime: fi.ModTime().UnixNano(), ino: fsroot.Inode(fi)}
}

func observeDir(ds *fsroot.DirState) pollState {
	names := make(map[string]struct{}, len(ds.Names))
	for _, n := range ds.Names {
		names[n] = struct{}{}
	}
	return pollState{exists: true, mtime: ds.ModTime.UnixNano(), names: names}
}

func startPoller(parent context.Context, wg *sync.WaitGroup, h *fsroot.Handle, p string, isDir bool,
	interval time.Duration, co *coalescer, base pollState,
) *poller {
	ctx, cancel := context.WithCancel(parent)
	pl := &poller{h: h, path: p, isDir: isDir, interval: interval, co: co, prev: base,
		cancel: cancel, done: make(chan struct{})}
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(pl.done)
		pl.run(ctx)
	}()
	return pl
}

func (pl *poller) stop() {
	pl.cancel()
	<-pl.done
	pl.co.stop()
}

func (pl *poller) run(ctx context.Context) {
	t := time.NewTicker(pl.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if cur, ok := pl.observe(ctx); ok {
				pl.diff(cur)
				pl.prev = cur
			}
		}
	}
}

// observe reads the current state. ok is false when the filesystem could not
// answer (timeout, unavailable, other error): the previous state is kept, so
// an outage never looks like a deletion.
func (pl *poller) observe(ctx context.Context) (pollState, bool) {
	var (
		st  pollState
		err error
	)
	if pl.isDir {
		var ds *fsroot.DirState
		if ds, err = pl.h.ReadNames(ctx, pl.path); err == nil {
			st = observeDir(ds)
		}
	} else {
		var fi fs.FileInfo
		if fi, err = pl.h.Stat(ctx, pl.path); err == nil {
			st = observeFile(fi)
		}
	}
	switch {
	case err == nil:
		return st, true
	case fsroot.KindOf(err) == fsroot.KindNotFound:
		return pollState{}, true
	default:
		return pollState{}, false
	}
}

func (pl *poller) diff(cur pollState) {
	prev := pl.prev
	switch {
	case !prev.exists && !cur.exists:
		return
	case !prev.exists:
		pl.co.add(pl.path, OpCreated)
		return
	case !cur.exists:
		pl.co.add(pl.path, OpDeleted)
		return
	}
	if prev.size != cur.size || prev.mtime != cur.mtime || prev.ino != cur.ino {
		pl.co.add(pl.path, OpModified)
	}
	for n := range cur.names {
		if _, ok := prev.names[n]; !ok {
			pl.co.add(path.Join(pl.path, n), OpCreated)
		}
	}
	for n := range prev.names {
		if _, ok := cur.names[n]; !ok {
			pl.co.add(path.Join(pl.path, n), OpDeleted)
		}
	}
}
