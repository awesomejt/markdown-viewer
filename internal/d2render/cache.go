package d2render

import (
	"container/list"
	"sync"
)

// result is a cached outcome: SVG bytes, or a deterministic error (compile
// error or timeout).
type result struct {
	svg []byte
	err error
}

type lruEntry struct {
	key [32]byte
	res result
}

// entryOverhead is a fixed per-entry cost so empty and negative-cache entries
// still count toward the byte bound.
const entryOverhead = 64

// size is the number of bytes an entry is charged against the cache bound.
func (r result) size() int64 {
	n := int64(len(r.svg)) + entryOverhead
	if r.err != nil {
		n += int64(len(r.err.Error()))
	}
	return n
}

// lru is a least-recently-used cache bounded by entry count and total bytes,
// safe for concurrent use.
type lru struct {
	mu       sync.Mutex
	max      int
	maxBytes int64
	maxEntry int64
	bytes    int64
	ll       *list.List
	items    map[[32]byte]*list.Element
}

func newLRU(limit int, maxBytes, maxEntry int64) *lru {
	return &lru{
		max: limit, maxBytes: maxBytes, maxEntry: maxEntry,
		ll: list.New(), items: make(map[[32]byte]*list.Element),
	}
}

func (c *lru) get(k [32]byte) (result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[k]
	if !ok {
		return result{}, false
	}
	c.ll.MoveToFront(el)
	return el.Value.(*lruEntry).res, true //nolint:forcetypeassert // list only holds *lruEntry
}

// put stores r unless it is larger than the per-entry cap. An oversize r also
// removes any older value for k so a stale entry is not kept.
func (c *lru) put(k [32]byte, r result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	size := r.size()
	if size > c.maxEntry {
		if el, ok := c.items[k]; ok {
			c.remove(el)
		}
		return
	}
	if el, ok := c.items[k]; ok {
		e := el.Value.(*lruEntry) //nolint:forcetypeassert // list only holds *lruEntry
		c.bytes += size - e.res.size()
		e.res = r
		c.ll.MoveToFront(el)
	} else {
		c.items[k] = c.ll.PushFront(&lruEntry{key: k, res: r})
		c.bytes += size
	}
	for c.ll.Len() > c.max || c.bytes > c.maxBytes {
		c.remove(c.ll.Back())
	}
}

// remove deletes el and its byte charge. The caller holds c.mu.
func (c *lru) remove(el *list.Element) {
	e := c.ll.Remove(el).(*lruEntry) //nolint:forcetypeassert // list only holds *lruEntry
	delete(c.items, e.key)
	c.bytes -= e.res.size()
}

func (c *lru) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}

// size returns the bytes currently charged to the cache.
func (c *lru) size() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bytes
}
