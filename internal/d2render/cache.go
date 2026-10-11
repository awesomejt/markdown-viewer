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

// lru is a fixed-size least-recently-used cache, safe for concurrent use.
type lru struct {
	mu    sync.Mutex
	max   int
	ll    *list.List
	items map[[32]byte]*list.Element
}

func newLRU(limit int) *lru {
	return &lru{max: limit, ll: list.New(), items: make(map[[32]byte]*list.Element)}
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

func (c *lru) put(k [32]byte, r result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[k]; ok {
		el.Value.(*lruEntry).res = r //nolint:forcetypeassert // list only holds *lruEntry
		c.ll.MoveToFront(el)
		return
	}
	c.items[k] = c.ll.PushFront(&lruEntry{key: k, res: r})
	for c.ll.Len() > c.max {
		last := c.ll.Back()
		c.ll.Remove(last)
		delete(c.items, last.Value.(*lruEntry).key) //nolint:forcetypeassert // list only holds *lruEntry
	}
}

func (c *lru) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}
