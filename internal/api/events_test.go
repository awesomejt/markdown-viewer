package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/watch"
)

const evWait = 5 * time.Second

// eventServer serves a temp-dir poll root over a real listener, with short
// poll and ping intervals.
func eventServer(t *testing.T) (*Server, *httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := testConfig(config.Root{Name: "r", Path: dir, Watch: config.WatchPoll})
	cfg.PollInterval = 5 * time.Millisecond
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reg.Close() })
	s := New(reg, cfg, nil)
	s.pingInterval = 20 * time.Millisecond
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	t.Cleanup(s.Close)
	return s, ts, dir
}

func eventsURL(ts *httptest.Server, subs ...string) string {
	q := url.Values{"sub": subs}
	return ts.URL + "/api/events?" + q.Encode()
}

// stream is an open SSE response read line by line.
type stream struct {
	resp  *http.Response
	lines chan string
}

func openStream(t *testing.T, u string) *stream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	st := &stream{resp: resp, lines: make(chan string, 64)}
	go func() {
		defer close(st.lines)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			st.lines <- sc.Text()
		}
	}()
	return st
}

// next returns the next line, or fails on timeout; ok is false at EOF.
func (st *stream) next(t *testing.T) (string, bool) {
	t.Helper()
	select {
	case l, ok := <-st.lines:
		return l, ok
	case <-time.After(evWait):
		t.Fatal("timed out reading stream")
		return "", false
	}
}

// change reads lines until a change event and returns its decoded data.
func (st *stream) change(t *testing.T) watch.Event {
	t.Helper()
	for {
		l, ok := st.next(t)
		if !ok {
			t.Fatal("stream ended")
		}
		if l == "event: change" {
			d, _ := st.next(t)
			var ev watch.Event
			if err := json.Unmarshal([]byte(strings.TrimPrefix(d, "data: ")), &ev); err != nil {
				t.Fatalf("bad data %q: %v", d, err)
			}
			return ev
		}
	}
}

func TestEventsBadRequests(t *testing.T) {
	_, ts, dir := eventServer(t)
	if err := os.Symlink(t.TempDir(), filepath.Join(dir, "esc")); err != nil {
		t.Fatal(err)
	}
	many := make([]string, 33)
	for i := range many {
		many[i] = fmt.Sprintf("r:f%d", i)
	}
	tests := []struct {
		name string
		subs []string
		want int
		code string
	}{
		{"none", nil, 400, "bad_request"},
		{"33 subs", many, 400, "bad_request"},
		{"no colon", []string{"r"}, 400, "bad_request"},
		{"empty root", []string{":x"}, 400, "bad_request"},
		{"unknown root", []string{"zz:"}, 404, "not_found"},
		{"missing path", []string{"r:nope.md"}, 404, "not_found"},
		{"traversal", []string{"r:../x"}, 400, "bad_request"},
		{"escape", []string{"r:esc"}, 403, "forbidden"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := http.Get(eventsURL(ts, tc.subs...))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = resp.Body.Close() }()
			var body errorBody
			_ = json.NewDecoder(resp.Body).Decode(&body)
			if resp.StatusCode != tc.want || body.Error.Code != tc.code {
				t.Fatalf("got %d %q, want %d %q", resp.StatusCode, body.Error.Code, tc.want, tc.code)
			}
		})
	}
	// Exactly 32 is accepted.
	for i := range 32 {
		write(t, filepath.Join(dir, fmt.Sprintf("f%d", i)), "x")
	}
	st := openStream(t, eventsURL(ts, many[:32]...))
	if st.resp.StatusCode != 200 {
		t.Fatalf("32 subs: status %d", st.resp.StatusCode)
	}
}

func write(t *testing.T, p, content string) {
	t.Helper()
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestEventsMethodNotAllowed(t *testing.T) {
	_, ts, _ := eventServer(t)
	resp, err := http.Post(eventsURL(ts, "r:"), "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestEventsStream(t *testing.T) {
	s, ts, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "one")
	st := openStream(t, eventsURL(ts, "r:a.md", "r:"))
	h := st.resp.Header
	if h.Get("Content-Type") != "text/event-stream" || h.Get("Cache-Control") != "no-cache" ||
		h.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("headers: %v", h)
	}
	// An idle stream pings.
	for {
		l, ok := st.next(t)
		if !ok {
			t.Fatal("stream ended")
		}
		if l == ": ping" {
			break
		}
	}
	write(t, filepath.Join(dir, "a.md"), "two, longer")
	for {
		ev := st.change(t)
		if ev == (watch.Event{Root: "r", Path: "a.md", Op: watch.OpModified}) {
			break
		}
	}
	if n := s.hub.Watching(); n != 2 {
		t.Fatalf("watching %d keys, want 2", n)
	}
}

func TestEventsDisconnectCleansUp(t *testing.T) {
	s, ts, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "one")
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, eventsURL(ts, "r:a.md"), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if n := s.hub.Watching(); n != 1 {
		t.Fatalf("watching %d, want 1", n)
	}
	cancel()
	deadline := time.Now().Add(evWait)
	for s.hub.Watching() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("subscription not released after client disconnect")
		}
		time.Sleep(time.Millisecond)
	}
}

// Shutdown must not wait for open event streams (it would block until its
// drain deadline otherwise).
func TestEventsShutdownIsPrompt(t *testing.T) {
	s, ts, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "one")
	ts.Config.RegisterOnShutdown(s.Close)
	st := openStream(t, eventsURL(ts, "r:a.md"))
	if _, ok := st.next(t); !ok { // stream is live: first ping or event
		t.Fatal("stream ended early")
	}
	ctx, cancel := context.WithTimeout(context.Background(), evWait)
	defer cancel()
	start := time.Now()
	if err := ts.Config.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("shutdown took %v with an open stream", d)
	}
	for { // the client sees the stream end
		if _, ok := st.next(t); !ok {
			break
		}
	}
}

func TestEventsAfterCloseIs503(t *testing.T) {
	s, _, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "one")
	s.Close()
	rec := do(s.Handler(), http.MethodGet, "/api/events?sub=r:a.md")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}
