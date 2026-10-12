package watch

import (
	"context"
	"errors"
	"log/slog"
	"path"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// ErrClosed is returned by [Hub.Subscribe] after [Hub.Close].
var ErrClosed = errors.New("watch: hub closed")

// ErrTooManyWatches is returned by [Hub.Subscribe] when registering the
// request would push the hub past [Options.MaxWatches] present keys or
// [Options.MaxMissing] missing-path keys.
var ErrTooManyWatches = errors.New("watch: too many watched paths")

// Defaults for [Options] fields left zero.
const (
	DefaultPollInterval = 2 * time.Second
	DefaultCoalesce     = 250 * time.Millisecond
	DefaultMaxWatches   = 256
	DefaultMaxMissing   = 64
)

// Options configures a [Hub].
type Options struct {
	PollInterval time.Duration // poll roots; default [DefaultPollInterval]
	Coalesce     time.Duration // per-path event window; default [DefaultCoalesce]
	MaxWatches   int           // distinct (root, path) keys whose path exists; default [DefaultMaxWatches]
	MaxMissing   int           // distinct keys whose path did not exist when first watched; default [DefaultMaxMissing]
	Logger       *slog.Logger  // nil discards
}

// Sub names one watched path. Path is root-relative; "" is the root.
type Sub struct {
	Root string
	Path string
}

type key struct{ root, path string }

type watcher interface{ stop() }

// entry is the shared state of one watched key.
type entry struct {
	subs map[*Subscription]struct{}
	w    watcher
	// missing records that the path did not exist when the entry was created.
	// It counts against MaxMissing for the entry's whole life, even once the
	// path appears, so the counts need no re-evaluation.
	missing bool
}

// Hub fans filesystem changes out to subscribers, with one watcher per
// distinct (root, path) however many subscribe.
type Hub struct {
	reg    *fsroot.Registry
	opts   Options
	logger *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu      sync.Mutex
	closed  bool
	entries map[key]*entry
	missing int         // entries with missing set
	fsn     *fsnotifier // created on first fsnotify subscription
}

// New builds a Hub over the registry's roots.
func New(reg *fsroot.Registry, opts Options) *Hub {
	if opts.PollInterval <= 0 {
		opts.PollInterval = DefaultPollInterval
	}
	if opts.Coalesce <= 0 {
		opts.Coalesce = DefaultCoalesce
	}
	if opts.MaxWatches <= 0 {
		opts.MaxWatches = DefaultMaxWatches
	}
	if opts.MaxMissing <= 0 {
		opts.MaxMissing = DefaultMaxMissing
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Hub{reg: reg, opts: opts, logger: logger, ctx: ctx, cancel: cancel, entries: make(map[key]*entry)}
}

// target is a validated subscription awaiting registration.
type target struct {
	key   key
	h     *fsroot.Handle
	isDir bool
	host  string    // fsnotify roots: host path of the path itself
	gone  bool      // the path does not exist yet; a later creation is reported
	base  pollState // poll roots: baseline observation
}

// prepare validates one sub through the guarded handle and takes the baseline
// the watcher will compare against. It touches the filesystem, so the hub
// lock must not be held.
func (h *Hub) prepare(ctx context.Context, s Sub) (target, error) {
	fh, err := h.reg.Get(s.Root)
	if err != nil {
		return target{}, err
	}
	rel, err := fsroot.Resolve(s.Path)
	if err != nil {
		return target{}, err
	}
	if rel == "." {
		rel = ""
	}
	t := target{key: key{s.Root, rel}, h: fh}
	if fh.Watch() == config.WatchFSNotify {
		host, fi, err := fh.HostPath(ctx, rel)
		if fsroot.KindOf(err) == fsroot.KindNotFound {
			// Watch the parent for the path to appear.
			if host, err = fh.HostPathMissing(ctx, rel); err == nil {
				t.host, t.gone = host, true
				return t, nil
			}
		}
		if err != nil {
			return target{}, err
		}
		t.host, t.isDir = host, fi.IsDir()
		return t, nil
	}
	fi, err := fh.Stat(ctx, rel)
	if fsroot.KindOf(err) == fsroot.KindNotFound {
		t.gone = true // zero baseline: not present
		return t, nil
	}
	if err != nil {
		return target{}, err
	}
	t.isDir = fi.IsDir()
	if !t.isDir {
		t.base = observeFile(fi)
		return t, nil
	}
	ds, err := fh.ReadNames(ctx, rel)
	if err != nil {
		return target{}, err
	}
	t.base = observeDir(ds)
	return t, nil
}

// Subscribe registers interest in subs and returns the subscription. Every
// sub is validated first; on any error nothing is registered. ctx bounds only
// the validation, not the subscription's life.
func (h *Hub) Subscribe(ctx context.Context, subs []Sub) (*Subscription, error) {
	targets := make([]target, 0, len(subs))
	seen := make(map[key]bool, len(subs))
	for _, s := range subs {
		t, err := h.prepare(ctx, s)
		if err != nil {
			return nil, err
		}
		if !seen[t.key] {
			seen[t.key] = true
			targets = append(targets, t)
		}
	}

	sub := &Subscription{hub: h, pend: make(map[key]Op), notify: make(chan struct{}, 1), done: make(chan struct{})}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil, ErrClosed
	}
	var fresh, freshMissing int
	for _, t := range targets {
		if h.entries[t.key] == nil {
			if t.gone {
				freshMissing++
			} else {
				fresh++
			}
		}
	}
	if len(h.entries)-h.missing+fresh > h.opts.MaxWatches || h.missing+freshMissing > h.opts.MaxMissing {
		h.mu.Unlock()
		return nil, ErrTooManyWatches
	}
	for _, t := range targets {
		e := h.entries[t.key]
		if e == nil {
			var err error
			if e, err = h.startLocked(t); err != nil {
				stops := h.detachLocked(sub)
				h.mu.Unlock()
				stopAll(stops)
				return nil, err
			}
		}
		e.subs[sub] = struct{}{}
		sub.keys = append(sub.keys, t.key)
	}
	h.mu.Unlock()
	return sub, nil
}

// startLocked creates the entry and watcher for a key's first subscriber.
func (h *Hub) startLocked(t target) (*entry, error) {
	e := &entry{subs: make(map[*Subscription]struct{}), missing: t.gone}
	co := newCoalescer(t.key.root, h.opts.Coalesce, func(ev Event) { h.dispatch(e, ev) })
	if t.h.Watch() == config.WatchFSNotify {
		if h.fsn == nil {
			f, err := newFSNotifier(h.ctx, h.logger, &h.wg)
			if err != nil {
				return nil, err
			}
			h.fsn = f
		}
		w := &fsWatch{fsn: h.fsn, co: co, h: t.h, path: t.key.path, hostRel: t.key.path,
			host: t.host, isDir: t.isDir, exists: !t.gone}
		if !t.isDir {
			w.host, w.base = filepath.Dir(t.host), filepath.Base(t.host)
			if w.hostRel = path.Dir(t.key.path); w.hostRel == "." {
				w.hostRel = ""
			}
		}
		if err := h.fsn.add(w); err != nil {
			return nil, err
		}
		e.w = w
	} else {
		e.w = startPoller(h.ctx, &h.wg, t.h, t.key.path, h.opts.PollInterval, co, t.base)
	}
	h.entries[t.key] = e
	if e.missing {
		h.missing++
	}
	return e, nil
}

// dispatch delivers a coalesced event to the key's current subscribers.
func (h *Hub) dispatch(e *entry, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range e.subs {
		s.push(ev)
	}
}

// detachLocked removes sub from every entry and returns the watchers whose
// last subscriber it was. They must be stopped after unlocking, because a
// watcher may be blocked delivering into dispatch, which takes the lock.
func (h *Hub) detachLocked(sub *Subscription) []watcher {
	var stops []watcher
	for _, k := range sub.keys {
		e := h.entries[k]
		if e == nil {
			continue
		}
		delete(e.subs, sub)
		if len(e.subs) == 0 {
			delete(h.entries, k)
			if e.missing {
				h.missing--
			}
			stops = append(stops, e.w)
		}
	}
	sub.keys = nil
	return stops
}

func stopAll(ws []watcher) {
	for _, w := range ws {
		w.stop()
	}
}

// Close stops every watcher and ends every subscription. It waits for the
// hub's goroutines and is safe to call more than once.
func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		h.wg.Wait()
		return
	}
	h.closed = true
	h.cancel()
	var stops []watcher
	subs := make(map[*Subscription]struct{})
	for _, e := range h.entries {
		stops = append(stops, e.w)
		for s := range e.subs {
			subs[s] = struct{}{}
		}
	}
	clear(h.entries)
	h.missing = 0
	fsn := h.fsn
	h.mu.Unlock()

	stopAll(stops)
	for s := range subs {
		s.finish()
	}
	if fsn != nil {
		fsn.close()
	}
	h.wg.Wait()
}

// Subscription is one client's set of watched paths. Events accumulate
// internally, merged per (root, path), until [Subscription.Drain] collects
// them, so a slow consumer never blocks the hub and never loses a change.
type Subscription struct {
	hub  *Hub
	keys []key // guarded by hub.mu

	mu     sync.Mutex
	pend   map[key]Op
	notify chan struct{}

	done chan struct{}
	once sync.Once
}

func (s *Subscription) push(ev Event) {
	k := key{ev.Root, ev.Path}
	s.mu.Lock()
	if old, ok := s.pend[k]; ok {
		ev.Op = merge(old, ev.Op)
	}
	s.pend[k] = ev.Op
	s.mu.Unlock()
	select {
	case s.notify <- struct{}{}:
	default:
	}
}

// Notify signals that Drain has events. The signal is level-ish: it may be
// spurious, and one signal covers any number of events.
func (s *Subscription) Notify() <-chan struct{} { return s.notify }

// Done is closed when the subscription ends, by Close or by the hub closing.
func (s *Subscription) Done() <-chan struct{} { return s.done }

// Drain returns and clears the pending events, sorted by path.
func (s *Subscription) Drain() []Event {
	s.mu.Lock()
	p := s.pend
	s.pend = make(map[key]Op)
	s.mu.Unlock()
	out := make([]Event, 0, len(p))
	for k, op := range p {
		out = append(out, Event{Root: k.root, Path: k.path, Op: op})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Root != out[j].Root {
			return out[i].Root < out[j].Root
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// Close ends the subscription and releases its watchers. Idempotent.
func (s *Subscription) Close() {
	h := s.hub
	h.mu.Lock()
	stops := h.detachLocked(s)
	h.mu.Unlock()
	stopAll(stops)
	s.finish()
}

func (s *Subscription) finish() { s.once.Do(func() { close(s.done) }) }

// Watching reports how many distinct (root, path) keys are being watched.
func (h *Hub) Watching() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.entries)
}
