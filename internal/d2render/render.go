package d2render

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"sync"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2dagrelayout"
	"github.com/d2lang/d2/d2layouts/d2elklayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2themes/d2themescatalog"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
	"github.com/d2lang/util-go/go2"
)

// d2Version is part of the cache key so a library upgrade invalidates entries.
const d2Version = "d2@v0.9.0"

const (
	defaultTimeout      = 10 * time.Second
	defaultConcurrency  = 2
	defaultCacheEntries = 256
	defaultSlotWait     = time.Second
)

// Theme and layout names accepted by [Renderer.Render].
const (
	ThemeLight  = "light"
	ThemeDark   = "dark"
	LayoutDagre = "dagre"
	LayoutELK   = "elk"
)

// Options configures a [Renderer]. Zero values select the defaults.
type Options struct {
	Timeout      time.Duration // wall-clock render limit (default 10s)
	Concurrency  int           // concurrent renders (default 2)
	CacheEntries int           // LRU size (default 256)
	SlotWait     time.Duration // max wait for a slot before ErrBusy (default 1s)
}

// slot is one unit of render concurrency. It owns a Ruler because
// textmeasure.Ruler's concurrency safety is unverified; a Ruler is therefore
// never shared between concurrent renders.
type slot struct{ ruler *textmeasure.Ruler }

// compileFunc renders source to SVG. It is a field so tests can inject slow or
// counting implementations.
type compileFunc func(ctx context.Context, s *slot, source string, themeID int64, layout string) ([]byte, error)

// call is an in-flight render shared by identical concurrent requests.
type call struct {
	done chan struct{}
	res  result
}

// Renderer renders D2 to SVG. It is safe for concurrent use.
type Renderer struct {
	timeout  time.Duration
	slotWait time.Duration
	slots    chan *slot
	cache    *lru
	compile  compileFunc

	mu       sync.Mutex
	inflight map[[32]byte]*call
}

// New creates a Renderer.
func New(o Options) *Renderer {
	if o.Timeout <= 0 {
		o.Timeout = defaultTimeout
	}
	if o.Concurrency <= 0 {
		o.Concurrency = defaultConcurrency
	}
	if o.CacheEntries <= 0 {
		o.CacheEntries = defaultCacheEntries
	}
	if o.SlotWait <= 0 {
		o.SlotWait = defaultSlotWait
	}
	r := &Renderer{
		timeout:  o.Timeout,
		slotWait: o.SlotWait,
		slots:    make(chan *slot, o.Concurrency),
		cache:    newLRU(o.CacheEntries),
		compile:  realCompile,
		inflight: make(map[[32]byte]*call),
	}
	for range o.Concurrency {
		r.slots <- &slot{}
	}
	return r
}

func themeID(theme string) (int64, error) {
	switch theme {
	case "", ThemeLight:
		return d2themescatalog.NeutralDefault.ID, nil
	case ThemeDark:
		return d2themescatalog.DarkMauve.ID, nil
	}
	return 0, &BadRequestError{Msg: fmt.Sprintf("unknown theme %q (want light or dark)", theme)}
}

func layoutName(layout string) (string, error) {
	switch layout {
	case "", LayoutDagre:
		return LayoutDagre, nil
	case LayoutELK:
		return LayoutELK, nil
	}
	return "", &BadRequestError{Msg: fmt.Sprintf("unknown layout %q (want dagre or elk)", layout)}
}

// cacheKey hashes the version, layout, theme ID and source with length
// prefixes so field boundaries are unambiguous.
func cacheKey(layout string, themeID int64, source string) [32]byte {
	h := sha256.New()
	var n [8]byte
	put := func(s string) {
		binary.BigEndian.PutUint64(n[:], uint64(len(s)))
		h.Write(n[:])
		h.Write([]byte(s))
	}
	put(d2Version)
	put(layout)
	put(fmt.Sprint(themeID))
	put(source)
	var k [32]byte
	h.Sum(k[:0])
	return k
}

// Render returns the SVG for source. It returns *BadRequestError for an
// invalid theme/layout, *CompileError for D2 errors, ErrTimeout, ErrBusy, or
// ctx.Err() when the caller gives up. Successes, compile errors and timeouts
// are cached; the rest are not.
func (r *Renderer) Render(ctx context.Context, source, theme, layout string) ([]byte, error) {
	tid, err := themeID(theme)
	if err != nil {
		return nil, err
	}
	lay, err := layoutName(layout)
	if err != nil {
		return nil, err
	}
	key := cacheKey(lay, tid, source)

	if res, ok := r.cache.get(key); ok {
		return res.svg, res.err
	}

	r.mu.Lock()
	c, ok := r.inflight[key]
	if !ok {
		// Re-check under the lock: a leader may have just finished.
		if res, hit := r.cache.get(key); hit {
			r.mu.Unlock()
			return res.svg, res.err
		}
		c = &call{done: make(chan struct{})}
		r.inflight[key] = c
		go r.lead(key, c, source, tid, lay)
	}
	r.mu.Unlock()

	select {
	case <-c.done:
		return c.res.svg, c.res.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// lead performs the render detached from any caller's context, so one
// cancelled caller cannot fail or poison the others.
func (r *Renderer) lead(key [32]byte, c *call, source string, tid int64, layout string) {
	res := r.run(source, tid, layout)
	if cacheable(res.err) {
		r.cache.put(key, res)
	}
	r.mu.Lock()
	delete(r.inflight, key)
	r.mu.Unlock()
	c.res = res
	close(c.done)
}

func cacheable(err error) bool {
	if err == nil || errors.Is(err, ErrTimeout) {
		return true
	}
	var ce *CompileError
	return errors.As(err, &ce)
}

func (r *Renderer) run(source string, tid int64, layout string) result {
	wait := time.NewTimer(r.slotWait)
	defer wait.Stop()
	var s *slot
	select {
	case s = <-r.slots:
	case <-wait.C:
		return result{err: ErrBusy}
	}

	ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), r.timeout)
	out := make(chan result, 1)
	go func() {
		// The slot is released only when the render goroutine returns, even
		// after a timeout: dagre ignores ctx and would otherwise pile up.
		defer func() { r.slots <- s }()
		defer cancel()
		defer func() {
			if p := recover(); p != nil {
				out <- result{err: fmt.Errorf("d2render: panic: %v", p)}
			}
		}()
		svg, err := r.compile(ctx, s, source, tid, layout)
		out <- result{svg: svg, err: err}
	}()

	timer := time.NewTimer(r.timeout)
	defer timer.Stop()
	select {
	case res := <-out:
		if errors.Is(res.err, context.DeadlineExceeded) {
			res.err = ErrTimeout
		}
		return res
	case <-timer.C:
		return result{err: ErrTimeout}
	}
}

// emptyFS is an fs.FS with no files: every Open fails with ErrNotExist.
type emptyFS struct{}

func (emptyFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func realCompile(ctx context.Context, s *slot, source string, themeID int64, layout string) ([]byte, error) {
	if s.ruler == nil {
		ruler, err := textmeasure.NewRuler()
		if err != nil {
			return nil, fmt.Errorf("d2render: ruler: %w", err)
		}
		s.ruler = ruler
	}
	var lg d2graph.LayoutGraph = d2dagrelayout.DefaultLayout
	if layout == LayoutELK {
		lg = d2elklayout.DefaultLayout
	}
	renderOpts := &d2svg.RenderOpts{Pad: go2.Pointer(int64(5)), ThemeID: go2.Pointer(themeID)}
	opts := &d2lib.CompileOptions{
		Ruler: s.ruler,
		// Verified in D2 v0.9.0 (d2ir/import.go): CompileOptions.FS is passed
		// through d2compiler to d2ir, which opens imports with os.Open when FS
		// is nil and with FS.Open otherwise. A nil FS would therefore read the
		// host, so an explicit empty FS is always set.
		FS:             emptyFS{},
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) { return lg, nil },
	}
	diagram, _, err := d2lib.Compile(ctx, source, opts, renderOpts)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, ErrTimeout
		}
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		return nil, &CompileError{Msg: err.Error()}
	}
	svg, err := d2svg.Render(diagram, renderOpts)
	if err != nil {
		return nil, fmt.Errorf("d2render: svg: %w", err)
	}
	return svg, nil
}
