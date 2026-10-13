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
	// The stream starts with a comment so the browser fires "open" at once.
	if l, ok := st.next(t); !ok || l != ": open" {
		t.Fatalf("first line %q, want \": open\"", l)
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

func TestEventsMissingPathStreams(t *testing.T) {
	_, ts, dir := eventServer(t)
	st := openStream(t, eventsURL(ts, "r:later.md"))
	if st.resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d for a missing path", st.resp.StatusCode)
	}
	write(t, filepath.Join(dir, "later.md"), "hi")
	for {
		if st.change(t) == (watch.Event{Root: "r", Path: "later.md", Op: watch.OpCreated}) {
			return
		}
	}
}

func TestEventsHeadAndOtherMethods(t *testing.T) {
	s, ts, _ := eventServer(t)
	for _, m := range []string{http.MethodHead, http.MethodPut, http.MethodDelete} {
		req, _ := http.NewRequest(m, eventsURL(ts, "r:"), nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusMethodNotAllowed || resp.Header.Get("Allow") != "GET" {
			t.Errorf("%s: status %d, Allow %q", m, resp.StatusCode, resp.Header.Get("Allow"))
		}
	}
	if n := s.hub.Watching(); n != 0 {
		t.Fatalf("%d keys watched after rejected methods", n)
	}
}

func TestEventsTooManyWatchesIs503(t *testing.T) {
	s, ts, dir := eventServer(t)
	s.hub.Close()
	s.hub = watch.New(s.reg, watch.Options{PollInterval: 5 * time.Millisecond, MaxWatches: 1})
	t.Cleanup(s.hub.Close)
	write(t, filepath.Join(dir, "a.md"), "x")
	write(t, filepath.Join(dir, "b.md"), "x")
	st := openStream(t, eventsURL(ts, "r:a.md"))
	if st.resp.StatusCode != http.StatusOK {
		t.Fatalf("first stream: %d", st.resp.StatusCode)
	}
	resp, err := http.Get(eventsURL(ts, "r:b.md"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var body errorBody
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != http.StatusServiceUnavailable || body.Error.Code != "busy" || body.Error.Message == "" {
		t.Fatalf("got %d %+v", resp.StatusCode, body)
	}
	// A key that is already watched costs nothing.
	st2 := openStream(t, eventsURL(ts, "r:a.md"))
	if st2.resp.StatusCode != http.StatusOK {
		t.Fatalf("shared key: %d", st2.resp.StatusCode)
	}
}

// deadlineWriter records write deadlines and fails them after okCalls.
type deadlineWriter struct {
	*httptest.ResponseRecorder
	okCalls   int
	deadlines []time.Time
}

func (d *deadlineWriter) SetWriteDeadline(t time.Time) error {
	d.deadlines = append(d.deadlines, t)
	if len(d.deadlines) > d.okCalls {
		return os.ErrDeadlineExceeded
	}
	return nil
}

func TestEventsWriteDeadline(t *testing.T) {
	s, _, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "x")
	s.writeTimeout = time.Minute
	// The deadline is set before the headers and before the first ping, which
	// is refused: the handler must end the stream.
	dw := &deadlineWriter{ResponseRecorder: httptest.NewRecorder(), okCalls: 1}
	req := httptest.NewRequest(http.MethodGet, "/api/events?sub=r:a.md", nil)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.events(dw, req)
	}()
	select {
	case <-done:
	case <-time.After(evWait):
		t.Fatal("stream survived a failing write deadline")
	}
	if len(dw.deadlines) != 2 {
		t.Fatalf("%d deadlines set, want 2", len(dw.deadlines))
	}
	if d := time.Until(dw.deadlines[0]); d < 30*time.Second || d > time.Minute {
		t.Fatalf("deadline %v ahead, want about writeTimeout", d)
	}
	if strings.Contains(dw.Body.String(), "ping") {
		t.Fatal("wrote after the deadline failed")
	}
}

func TestEventsUnsupportedDeadlineStillStreams(t *testing.T) {
	s, _, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "x")
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/events?sub=r:a.md", nil).WithContext(ctx)
	rec := httptest.NewRecorder() // no SetWriteDeadline: ErrNotSupported
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.events(rec, req)
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-done
	if !strings.Contains(rec.Body.String(), ": ping") {
		t.Fatalf("no ping written: %q", rec.Body.String())
	}
}

// streamCounts reads the limiter's totals.
func streamCounts(s *Server) (total, ips int) {
	s.streamsMu.Lock()
	defer s.streamsMu.Unlock()
	return s.streams, len(s.streamsByIP)
}

// holdStream runs the events handler for a client at addr until stop is
// called, and returns once the stream is open.
func holdStream(t *testing.T, s *Server, addr, query string) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/events?"+query, nil).WithContext(ctx)
	req.RemoteAddr = addr
	rec := httptest.NewRecorder()
	// Read the baseline before the handler starts: it can take its slot
	// before this goroutine runs again, so a later read may already count it.
	before, _ := streamCounts(s)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.events(rec, req)
	}()
	t.Cleanup(func() { cancel(); <-done })
	deadline := time.Now().Add(evWait)
	for {
		if n, _ := streamCounts(s); n > before {
			return func() { cancel(); <-done }
		}
		if time.Now().After(deadline) {
			t.Fatal("stream did not open")
		}
		time.Sleep(time.Millisecond)
	}
}

// busyEvents issues one events request and returns the response.
func busyEvents(s *Server, addr, query string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/events?"+query, nil)
	req.RemoteAddr = addr
	rec := httptest.NewRecorder()
	s.events(rec, req)
	return rec
}

func wantBusy(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var body errorBody
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if rec.Code != http.StatusServiceUnavailable || body.Error.Code != "busy" || body.Error.Message == "" {
		t.Fatalf("got %d %+v", rec.Code, body)
	}
}

func TestEventsPerIPStreamCap(t *testing.T) {
	s, _, _ := eventServer(t)
	s.maxStreamsPerIP = 2
	holdStream(t, s, "192.0.2.1:1000", "sub=r:a.md")
	stop := holdStream(t, s, "192.0.2.1:1001", "sub=r:a.md") // same host, new port
	wantBusy(t, busyEvents(s, "192.0.2.1:1002", "sub=r:a.md"))
	// Another client is unaffected.
	holdStream(t, s, "192.0.2.2:1000", "sub=r:a.md")
	// Closing a stream frees its slot.
	stop()
	holdStream(t, s, "192.0.2.1:1003", "sub=r:a.md")
}

func TestEventsGlobalStreamCap(t *testing.T) {
	s, _, _ := eventServer(t)
	s.maxStreams = 2
	holdStream(t, s, "192.0.2.1:1000", "sub=r:a.md")
	holdStream(t, s, "192.0.2.2:1000", "sub=r:a.md")
	wantBusy(t, busyEvents(s, "192.0.2.3:1000", "sub=r:a.md"))
}

func TestEventsRemoteAddrWithoutPort(t *testing.T) {
	s, _, _ := eventServer(t)
	s.maxStreamsPerIP = 1
	holdStream(t, s, "pipe", "sub=r:a.md")
	wantBusy(t, busyEvents(s, "pipe", "sub=r:a.md"))
}

func TestEventsStreamSlotReleasedOnSubscribeError(t *testing.T) {
	s, _, _ := eventServer(t)
	rec := busyEvents(s, "192.0.2.1:1000", "sub=nope:a.md")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
	if n, ips := streamCounts(s); n != 0 || ips != 0 {
		t.Fatalf("streams = %d, ips = %d, want 0", n, ips)
	}
}

func TestEventsStreamSlotsReleasedAfterClose(t *testing.T) {
	s, _, _ := eventServer(t)
	stop := holdStream(t, s, "192.0.2.1:1000", "sub=r:a.md")
	stop()
	if n, ips := streamCounts(s); n != 0 || ips != 0 {
		t.Fatalf("streams = %d, ips = %d, want 0", n, ips)
	}
}

func TestEventsLowSubsDropped(t *testing.T) {
	_, ts, dir := eventServer(t)
	if err := os.Symlink(t.TempDir(), filepath.Join(dir, "esc")); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "doc.md"), "one")
	u := ts.URL + "/api/events?" + url.Values{
		"sub":  {"r:doc.md"},
		"lsub": {"r:../x", "r:esc", "zz:a", "r:\x01.png", "nocolon", ":x"},
	}.Encode()
	st := openStream(t, u)
	if st.resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", st.resp.StatusCode)
	}
	write(t, filepath.Join(dir, "doc.md"), "two, longer")
	want := watch.Event{Root: "r", Path: "doc.md", Op: watch.OpModified}
	for ev := st.change(t); ev != want; ev = st.change(t) {
		t.Logf("skipping %+v", ev)
	}
}

func TestEventsOnlyInvalidLowSubsStreams(t *testing.T) {
	_, ts, _ := eventServer(t)
	u := ts.URL + "/api/events?" + url.Values{"lsub": {"r:../x", "nocolon"}}.Encode()
	st := openStream(t, u)
	if st.resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", st.resp.StatusCode)
	}
	for { // the stream is alive: it pings
		if l, ok := st.next(t); !ok {
			t.Fatal("stream ended")
		} else if l == ": ping" {
			return
		}
	}
}

func TestEventsCombinedCapAndNormalFailure(t *testing.T) {
	_, ts, _ := eventServer(t)
	lows := make([]string, 30)
	for i := range lows {
		lows[i] = fmt.Sprintf("r:l%d", i)
	}
	for name, q := range map[string]url.Values{
		"33 combined":    {"sub": {"r:a", "r:b", "r:c"}, "lsub": lows},
		"invalid normal": {"sub": {"r:../x"}, "lsub": {"r:ok"}},
	} {
		resp, err := http.Get(ts.URL + "/api/events?" + q.Encode())
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
	}
	// 2 + 30 combined is accepted.
	resp, err := http.Get(ts.URL + "/api/events?" + url.Values{"sub": {"r:a", "r:b"}, "lsub": lows}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("32 combined: status %d", resp.StatusCode)
	}
}
