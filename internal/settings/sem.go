package settings

import (
	"context"
	"sync"
)

// MaxConcurrentParses is the server-wide bound on simultaneous parses.
const MaxConcurrentParses = 4

// Sem is a counting semaphore whose waiting is bounded by a context.
type Sem struct {
	ch chan struct{}
}

// NewSem returns a semaphore with n slots (at least 1).
func NewSem(n int) *Sem {
	return &Sem{ch: make(chan struct{}, max(n, 1))}
}

// Acquire takes a slot, waiting until one is free or ctx ends. The returned
// release function is idempotent.
func (s *Sem) Acquire(ctx context.Context) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case s.ch <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-s.ch }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
