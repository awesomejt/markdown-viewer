package watch

import (
	"sync"
	"time"
)

// Op is the kind of change an [Event] reports.
type Op string

// The possible ops.
const (
	OpModified Op = "modified"
	OpCreated  Op = "created"
	OpDeleted  Op = "deleted"
)

// Event is one change notification. Path is root-relative ("" is the root)
// and never contains host paths.
type Event struct {
	Root string `json:"root"`
	Path string `json:"path"`
	Op   Op     `json:"op"`
}

// merge combines an op already pending for a path with a newer one.
func merge(old, next Op) Op {
	switch {
	case next == OpDeleted:
		return OpDeleted
	case old == OpCreated && next == OpModified:
		return OpCreated
	case old == OpDeleted && next == OpCreated:
		return OpModified // replaced in place
	default:
		return next
	}
}

type pending struct {
	op    Op
	timer *time.Timer
}

// coalescer delays each path's event by window and merges whatever else
// arrives for that path meanwhile. The window starts at the first event.
type coalescer struct {
	root   string
	window time.Duration
	sink   func(Event)

	mu     sync.Mutex
	pend   map[string]*pending
	closed bool
}

func newCoalescer(root string, window time.Duration, sink func(Event)) *coalescer {
	return &coalescer{root: root, window: window, sink: sink, pend: make(map[string]*pending)}
}

func (c *coalescer) add(p string, op Op) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if e, ok := c.pend[p]; ok {
		e.op = merge(e.op, op)
		return
	}
	c.pend[p] = &pending{op: op, timer: time.AfterFunc(c.window, func() { c.flush(p) })}
}

func (c *coalescer) flush(p string) {
	c.mu.Lock()
	e, ok := c.pend[p]
	if !ok || c.closed {
		c.mu.Unlock()
		return
	}
	delete(c.pend, p)
	c.mu.Unlock()
	c.sink(Event{Root: c.root, Path: p, Op: e.op})
}

// stop drops everything pending and ignores later adds.
func (c *coalescer) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	for _, e := range c.pend {
		e.timer.Stop()
	}
	clear(c.pend)
}
