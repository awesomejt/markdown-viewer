package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// prefsServer builds a server whose MDV_PREFS is path ("" means unset).
func prefsServer(t *testing.T, path string, timeout time.Duration) (*Server, *bytes.Buffer) {
	t.Helper()
	cfg := testConfig()
	cfg.Prefs = path
	if timeout > 0 {
		cfg.FSTimeout = timeout
	}
	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reg.Close() })
	var logs bytes.Buffer
	s := New(reg, cfg, slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(s.Close)
	return s, &logs
}

func writePrefs(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "preferences.yaml")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// getPrefs requests /api/prefs, checks the fixed headers and returns the raw
// body plus the decoded top-level object.
func getPrefs(t *testing.T, s *Server) (string, map[string]json.RawMessage) {
	t.Helper()
	rec := do(s.Handler(), http.MethodGet, "/api/prefs")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if rec.Header().Get("ETag") != "" {
		t.Error("unexpected ETag")
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"configured", "settings", "warnings", "error"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("missing %q in %s", k, rec.Body)
		}
	}
	return rec.Body.String(), m
}

func wantPrefs(t *testing.T, s *Server, configured, settings, warnings, errJSON string) {
	t.Helper()
	_, m := getPrefs(t, s)
	got := map[string]string{}
	for k, v := range m {
		got[k] = string(v)
	}
	want := map[string]string{"configured": configured, "settings": settings, "warnings": warnings, "error": errJSON}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("%s = %s, want %s", k, got[k], w)
		}
	}
}

func TestPrefsUnset(t *testing.T) {
	s, _ := prefsServer(t, "", 0)
	wantPrefs(t, s, "false", "{}", "[]", "null")
}

func TestPrefsMissing(t *testing.T) {
	s, logs := prefsServer(t, filepath.Join(t.TempDir(), "nope.yaml"), 0)
	wantPrefs(t, s, "true", "{}", "[]", "null")
	if !strings.Contains(logs.String(), "level=WARN") || !strings.Contains(logs.String(), "state=missing") {
		t.Errorf("want WARN missing, got %q", logs)
	}
}

func TestPrefsEmptyAndCommentOnly(t *testing.T) {
	for name, content := range map[string]string{"empty": "", "comment": "# just a comment\n"} {
		t.Run(name, func(t *testing.T) {
			s, _ := prefsServer(t, writePrefs(t, content), 0)
			wantPrefs(t, s, "true", "{}", "[]", "null")
		})
	}
}

func TestPrefsPermissionDenied(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores file modes")
	}
	p := writePrefs(t, "version: 1\n")
	if err := os.Chmod(p, 0); err != nil {
		t.Fatal(err)
	}
	s, _ := prefsServer(t, p, 0)
	wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_unreadable","message":"preferences file could not be read"}`)
}

func TestPrefsDirectory(t *testing.T) {
	s, _ := prefsServer(t, t.TempDir(), 0)
	wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_unreadable","message":"preferences file could not be read"}`)
}

func TestPrefsInvalidSyntaxLine(t *testing.T) {
	s, _ := prefsServer(t, writePrefs(t, "version: 1\nsettings: [\n"), 0)
	_, m := getPrefs(t, s)
	var e struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Line    int    `json:"line"`
	}
	if err := json.Unmarshal(m["error"], &e); err != nil {
		t.Fatal(err)
	}
	if e.Code != "prefs_invalid" || e.Line < 1 || e.Message == "" {
		t.Errorf("error = %+v", e)
	}
	if string(m["settings"]) != "{}" || string(m["warnings"]) != "[]" || string(m["configured"]) != "true" {
		t.Errorf("body = %v", m)
	}
}

func TestPrefsOversize(t *testing.T) {
	big := "version: 1\n# " + strings.Repeat("x", 33<<10) + "\n"
	s, _ := prefsServer(t, writePrefs(t, big), 0)
	wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_invalid","message":"file is larger than 32 KiB"}`)
}

func TestPrefsValid(t *testing.T) {
	s, logs := prefsServer(t, writePrefs(t, "version: 1\nsettings:\n  theme: dark\n  fontSize: 18\n"), 0)
	wantPrefs(t, s, "true", `{"theme":"dark","fontSize":18}`, "[]", "null")
	if !strings.Contains(logs.String(), "level=INFO") || strings.Contains(logs.String(), "level=WARN") {
		t.Errorf("want only INFO, got %q", logs)
	}
}

func TestPrefsValidWithWarnings(t *testing.T) {
	s, logs := prefsServer(t, writePrefs(t, "settings:\n  theme: dark\n  fontSize: 99\n  bogus: 1\n"), 0)
	_, m := getPrefs(t, s)
	if string(m["settings"]) != `{"theme":"dark"}` || string(m["error"]) != "null" {
		t.Errorf("body = %v", m)
	}
	var ws []struct{ Code, Key string }
	if err := json.Unmarshal(m["warnings"], &ws); err != nil || len(ws) != 2 {
		t.Fatalf("warnings = %s (%v)", m["warnings"], err)
	}
	if !strings.Contains(logs.String(), "level=WARN") || !strings.Contains(logs.String(), "warnings=2") {
		t.Errorf("want WARN with count, got %q", logs)
	}
}

func TestPrefsFIFODoesNotBlock(t *testing.T) {
	p := filepath.Join(t.TempDir(), "preferences.yaml")
	if err := syscall.Mkfifo(p, 0o600); err != nil {
		t.Skip("mkfifo unavailable:", err)
	}
	s, _ := prefsServer(t, p, 0)
	done := make(chan struct{})
	go func() {
		defer close(done)
		wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_unreadable","message":"preferences file could not be read"}`)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("request blocked on a FIFO")
	}
}

func TestPrefsHungReadServesLastResult(t *testing.T) {
	s, _ := prefsServer(t, "/unused/preferences.yaml", 50*time.Millisecond)
	var block atomic.Bool
	var calls atomic.Int32
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	s.prefsStore.read = func(string) ([]byte, error) {
		calls.Add(1)
		if block.Load() {
			<-release
		}
		return []byte("settings:\n  theme: dark\n"), nil
	}
	wantPrefs(t, s, "true", `{"theme":"dark"}`, "[]", "null")
	block.Store(true)

	var wg sync.WaitGroup
	start := time.Now()
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			wantPrefs(t, s, "true", `{"theme":"dark"}`, "[]", "null")
		}()
	}
	wg.Wait()
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("requests took %s", d)
	}
	if n := calls.Load(); n != 2 { // one good read, one hung read
		t.Errorf("read calls = %d, want 2", n)
	}
}

func TestPrefsFreshReadAfterHungReadCompletes(t *testing.T) {
	s, _ := prefsServer(t, "/unused/preferences.yaml", 30*time.Millisecond)
	var calls atomic.Int32
	release := make(chan struct{})
	s.prefsStore.read = func(string) ([]byte, error) {
		if calls.Add(1) == 1 {
			<-release
		}
		return []byte("settings:\n  theme: light\n"), nil
	}
	wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_unreadable","message":"preferences file read timed out"}`)
	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.prefsStore.mu.Lock()
		idle := s.prefsStore.inflight == nil
		s.prefsStore.mu.Unlock()
		if idle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("hung read never finished")
		}
		time.Sleep(5 * time.Millisecond)
	}
	wantPrefs(t, s, "true", `{"theme":"light"}`, "[]", "null")
	if n := calls.Load(); n != 2 {
		t.Errorf("read calls = %d, want 2", n)
	}
}

func TestPrefsNeverCompletedNoPriorResult(t *testing.T) {
	s, logs := prefsServer(t, "/unused/preferences.yaml", 30*time.Millisecond)
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	s.prefsStore.read = func(string) ([]byte, error) { <-release; return nil, nil }
	wantPrefs(t, s, "true", "{}", "[]", `{"code":"prefs_unreadable","message":"preferences file read timed out"}`)
	if !strings.Contains(logs.String(), "state=timeout") {
		t.Errorf("want timeout log, got %q", logs)
	}
}

func TestPrefsRequestContextCancelled(t *testing.T) {
	s, _ := prefsServer(t, "/unused/preferences.yaml", time.Minute)
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	s.prefsStore.read = func(string) ([]byte, error) { <-release; return nil, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	res := s.prefsStore.get(ctx)
	if res.err == nil || res.err.Code != codePrefsUnreadable {
		t.Errorf("res = %+v", res)
	}
}

func TestPrefsReadErrorIsGeneric(t *testing.T) {
	s, _ := prefsServer(t, "/secret/host/path.yaml", 0)
	s.prefsStore.read = func(p string) ([]byte, error) { return nil, errors.New("boom " + p) }
	body, _ := getPrefs(t, s)
	if strings.Contains(body, "secret") || strings.Contains(body, "boom") {
		t.Errorf("leak: %s", body)
	}
}

func TestPrefsLogDedup(t *testing.T) {
	p := writePrefs(t, "settings:\n  theme: dark\n")
	s, logs := prefsServer(t, p, 0)
	getPrefs(t, s)
	getPrefs(t, s)
	if n := strings.Count(logs.String(), "preferences loaded"); n != 1 {
		t.Fatalf("logged %d times for same content: %q", n, logs)
	}
	if err := os.WriteFile(p, []byte("settings:\n  theme: light\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	getPrefs(t, s)
	getPrefs(t, s)
	if n := strings.Count(logs.String(), "preferences loaded"); n != 2 {
		t.Errorf("logged %d times after change: %q", n, logs)
	}
}

func TestPrefsNoHostPathLeaks(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"missing":    filepath.Join(dir, "missing.yaml"),
		"directory":  dir,
		"invalid":    writePrefsIn(t, dir, "bad.yaml", "settings: [\n"),
		"oversize":   writePrefsIn(t, dir, "big.yaml", "# "+strings.Repeat("x", 33<<10)),
		"valid":      writePrefsIn(t, dir, "ok.yaml", "settings:\n  theme: dark\n"),
		"warned":     writePrefsIn(t, dir, "warn.yaml", "settings:\n  nope: 1\n"),
		"not-a-file": filepath.Join(dir, "ok.yaml", "child"),
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			s, logs := prefsServer(t, p, 0)
			body, _ := getPrefs(t, s)
			if strings.Contains(body, dir) || strings.Contains(logs.String(), dir) {
				t.Errorf("host path leaked: body=%s logs=%s", body, logs)
			}
		})
	}
}

func writePrefsIn(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPrefsRoute(t *testing.T) {
	s, _ := prefsServer(t, "", 0)
	h := s.Handler()
	if rec := do(h, http.MethodPost, "/api/prefs"); rec.Code != http.StatusMethodNotAllowed ||
		rec.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("POST: %d allow=%q", rec.Code, rec.Header().Get("Allow"))
	}
	req := httptest.NewRequest(http.MethodGet, "/api/prefs", nil)
	req.Host = "evil.example"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMisdirectedRequest {
		t.Errorf("bad Host: %d, want 421", rec.Code)
	}
}

func TestPrefsSharedParseSem(t *testing.T) {
	s, _ := prefsServer(t, "", 0)
	if s.parseSem == nil {
		t.Fatal("parse semaphore missing")
	}
	// Exhaust the slots: a prefs load must then fail with the busy message.
	var rel []func()
	for range 4 {
		r, err := s.parseSem.Acquire(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		rel = append(rel, r)
	}
	defer func() {
		for _, r := range rel {
			r()
		}
	}()
	st := newPrefsStore("/x", 20*time.Millisecond, s.parseSem, slog.New(slog.DiscardHandler))
	st.read = func(string) ([]byte, error) { return []byte(""), nil }
	res := st.get(context.Background())
	if res.err == nil || (res.err.Message != msgPrefsBusy && res.err.Message != msgPrefsTimeout) {
		t.Errorf("res = %+v", res)
	}
}
