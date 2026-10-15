package settings

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSemBoundsConcurrency(t *testing.T) {
	s := NewSem(MaxConcurrentParses)
	var cur, peak atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rel, err := s.Acquire(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			n := cur.Add(1)
			for {
				p := peak.Load()
				if n <= p || peak.CompareAndSwap(p, n) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			cur.Add(-1)
			rel()
		}()
	}
	wg.Wait()
	if peak.Load() != MaxConcurrentParses {
		t.Errorf("peak = %d, want %d", peak.Load(), MaxConcurrentParses)
	}
}

func TestSemContextCancel(t *testing.T) {
	s := NewSem(1)
	rel, err := s.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := s.Acquire(ctx); err == nil {
		t.Fatal("acquired a full semaphore")
	}
	pre, cancel2 := context.WithCancel(context.Background())
	cancel2()
	rel() // slot free, but a cancelled context must still fail
	if _, err := s.Acquire(pre); err == nil {
		t.Fatal("acquired with cancelled context")
	}
	rel() // idempotent: must not free a second slot
	r1, err := s.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx2, cancel3 := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel3()
	if _, err := s.Acquire(ctx2); err == nil {
		t.Fatal("double release freed an extra slot")
	}
	r1()
	if NewSem(0) == nil || cap(NewSem(-1).ch) != 1 {
		t.Error("NewSem minimum")
	}
}
