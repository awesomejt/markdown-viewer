package watch

import (
	"testing"
	"time"
)

func TestMerge(t *testing.T) {
	tests := []struct{ old, next, want Op }{
		{OpModified, OpModified, OpModified},
		{OpCreated, OpModified, OpCreated},
		{OpModified, OpDeleted, OpDeleted},
		{OpCreated, OpDeleted, OpDeleted},
		{OpDeleted, OpCreated, OpModified},
		{OpDeleted, OpModified, OpModified},
		{OpModified, OpCreated, OpCreated},
	}
	for _, tc := range tests {
		if got := merge(tc.old, tc.next); got != tc.want {
			t.Errorf("merge(%s,%s) = %s, want %s", tc.old, tc.next, got, tc.want)
		}
	}
}

func TestCoalescerMergesBurst(t *testing.T) {
	out := make(chan Event, 8)
	c := newCoalescer("r", 30*time.Millisecond, func(ev Event) { out <- ev })
	defer c.stop()
	for range 10 {
		c.add("a.md", OpModified)
	}
	c.add("b.md", OpCreated)
	c.add("b.md", OpModified)
	got := map[string]Op{}
	for range 2 {
		select {
		case ev := <-out:
			got[ev.Path] = ev.Op
		case <-time.After(waitFor):
			t.Fatal("timed out")
		}
	}
	if got["a.md"] != OpModified || got["b.md"] != OpCreated {
		t.Fatalf("got %v", got)
	}
	// Exactly one event per path: nothing else may arrive after the window.
	select {
	case ev := <-out:
		t.Fatalf("unexpected extra event %v", ev)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCoalescerStopDropsPending(t *testing.T) {
	out := make(chan Event, 1)
	c := newCoalescer("r", 20*time.Millisecond, func(ev Event) { out <- ev })
	c.add("a.md", OpModified)
	c.stop()
	c.add("b.md", OpModified) // ignored after stop
	select {
	case ev := <-out:
		t.Fatalf("event after stop: %v", ev)
	case <-time.After(80 * time.Millisecond):
	}
}

func TestSubscriptionMergesPending(t *testing.T) {
	s := &Subscription{pend: map[key]Op{}, notify: make(chan struct{}, 1)}
	s.push(ev("b", OpCreated))
	s.push(ev("b", OpModified))
	s.push(ev("a", OpDeleted))
	select {
	case <-s.Notify():
	default:
		t.Fatal("no notification")
	}
	got := s.Drain()
	want := []Event{ev("a", OpDeleted), ev("b", OpCreated)}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
	if len(s.Drain()) != 0 {
		t.Fatal("drain did not clear")
	}
}
