package api

import (
	"context"
	"sync"
	"time"
)

// maxFlights bounds the number of keys the stat-result cache holds. When it
// is full of live entries, new keys run unshared (still behind the per-Handle
// stat limiter), so memory stays bounded whatever the request mix.
const maxFlights = 256

// statRes is one reference's stat outcome. code is "" on success. It holds no
// error values, so nothing host-specific is retained.
type statRes struct {
	dir  bool
	code string
}

type flightKey struct {
	root, path string
	sum        [32]byte
}

type flight struct {
	done    chan struct{}
	res     map[string]statRes
	expires time.Time // valid once done is closed
}

// statFlight deduplicates the stat phase of project resolution: concurrent
// requests for the same (root, path, content hash) share one fan-out, and the
// result stays valid for ttl afterwards. The content hash in the key means a
// live edit never sees a stale answer.
type statFlight struct {
	mu  sync.Mutex
	m   map[flightKey]*flight
	ttl time.Duration
	now func() time.Time
}

func newStatFlight(ttl time.Duration) *statFlight {
	return &statFlight{m: make(map[flightKey]*flight), ttl: ttl, now: time.Now}
}

// do returns the shared result for key, running fn at most once per live
// entry. fn runs on a context detached from the caller's cancellation (it
// carries its own deadline), so a caller that goes away cannot poison the
// result for the others. A caller whose ctx ends first returns ctx.Err().
func (f *statFlight) do(ctx context.Context, key flightKey, fn func(context.Context) map[string]statRes) (map[string]statRes, error) {
	f.mu.Lock()
	now := f.now()
	for k, e := range f.m {
		select {
		case <-e.done:
			if !now.Before(e.expires) {
				delete(f.m, k)
			}
		default:
		}
	}
	e, ok := f.m[key]
	if !ok {
		if len(f.m) >= maxFlights {
			f.mu.Unlock()
			return fn(ctx), nil
		}
		e = &flight{done: make(chan struct{})}
		f.m[key] = e
		go func() {
			res := fn(context.WithoutCancel(ctx))
			f.mu.Lock()
			e.res = res
			e.expires = f.now().Add(f.ttl)
			if f.ttl <= 0 {
				delete(f.m, key)
			}
			f.mu.Unlock()
			close(e.done)
		}()
	}
	f.mu.Unlock()
	select {
	case <-e.done:
		return e.res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
