package api

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// fileTestServer serves a temp root "t" whose /api/file requests signal done
// when the handler returns.
func fileTestServer(t *testing.T, timeout time.Duration) (srv *httptest.Server, dir string, done chan struct{}) {
	t.Helper()
	dir = t.TempDir()
	s, _ := newServer(t, config.Root{Name: "t", Path: dir, Watch: config.WatchPoll})
	s.writeTimeout = timeout
	h := s.Handler()
	done = make(chan struct{}, 4)
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r)
		if r.URL.Path == "/api/file" {
			done <- struct{}{}
		}
	}))
	t.Cleanup(srv.Close)
	return srv, dir, done
}

func TestFileStalledClientTimesOut(t *testing.T) {
	srv, dir, done := fileTestServer(t, 200*time.Millisecond)
	// Far larger than the loopback socket buffers, so the copy must block.
	if err := os.WriteFile(filepath.Join(dir, "big.bin"), make([]byte, 64<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }() // runs before srv.Close, which waits for handlers
	_ = conn.(*net.TCPConn).SetReadBuffer(4096)
	if _, err := io.WriteString(conn, "GET "+fileURL("t", "big.bin")+" HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	// The client never reads: the handler must give up on its own.
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("handler still blocked on a client that stopped reading")
	}
}

func TestFileDeadlineClearedForKeepAlive(t *testing.T) {
	timeout := 100 * time.Millisecond
	srv, dir, done := fileTestServer(t, timeout)
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), make([]byte, 100<<10), 0o600); err != nil {
		t.Fatal(err)
	}
	client := srv.Client()
	get := func(target string) (body []byte, reused bool) {
		t.Helper()
		trace := &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reused = i.Reused }}
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(t.Context(), trace), http.MethodGet, srv.URL+target, nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		body, err = io.ReadAll(resp.Body)
		if err != nil || resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %v", target, resp.StatusCode, err)
		}
		return body, reused
	}
	if body, _ := get(fileURL("t", "a.bin")); len(body) != 100<<10 {
		t.Fatalf("file body %d bytes", len(body))
	}
	<-done
	// A leaked deadline would make the next response on this connection,
	// from a handler that sets none, fail.
	time.Sleep(3 * timeout)
	body, reused := get("/api/roots")
	if !reused {
		t.Fatal("connection not reused; the test proves nothing")
	}
	if len(body) == 0 {
		t.Fatal("empty roots body")
	}
}

func TestFileDeadlineErrorStopsBody(t *testing.T) {
	s, _, dir := eventServer(t)
	write(t, filepath.Join(dir, "a.md"), "hello")
	dw := &deadlineWriter{ResponseRecorder: httptest.NewRecorder()} // every deadline fails
	s.file(dw, httptest.NewRequest(http.MethodGet, fileURL("r", "a.md"), nil))
	if dw.Body.Len() != 0 || len(dw.deadlines) == 0 {
		t.Fatalf("body %q written, %d deadlines set", dw.Body, len(dw.deadlines))
	}
}
