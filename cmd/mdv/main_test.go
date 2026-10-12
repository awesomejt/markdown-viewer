package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVersionString(t *testing.T) {
	result := versionString()
	expected := "mdv dev"
	if result != expected {
		t.Errorf("versionString() = %q, want %q", result, expected)
	}
}

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestRunVersion(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(context.Background(), []string{"version"}, env(nil), &out, &errb); code != 0 {
		t.Fatalf("code = %d", code)
	}
	if out.String() != "mdv dev\n" {
		t.Errorf("out = %q", out.String())
	}
}

func TestRunUnknown(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(context.Background(), []string{"bogus"}, env(nil), &out, &errb); code == 0 {
		t.Fatal("want non-zero")
	}
	if !strings.Contains(errb.String(), "bogus") {
		t.Errorf("stderr = %q", errb.String())
	}
}

func TestRunConfigError(t *testing.T) {
	for _, args := range [][]string{nil, {"serve"}} {
		var out, errb bytes.Buffer
		if code := run(context.Background(), args, env(nil), &out, &errb); code != 1 {
			t.Fatalf("code = %d", code)
		}
		if !strings.Contains(errb.String(), "MDV_ROOTS") {
			t.Errorf("stderr = %q", errb.String())
		}
	}
}

func TestHealthURL(t *testing.T) {
	tests := map[string]string{
		"":               "http://127.0.0.1:8080/healthz",
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:9000":   "http://127.0.0.1:9000/healthz",
		"[::]:9000":      "http://127.0.0.1:9000/healthz",
		"127.0.0.1:1234": "http://127.0.0.1:1234/healthz",
		"[::1]:1234":     "http://[::1]:1234/healthz",
		"localhost:80":   "http://localhost:80/healthz",
		"9000":           "http://127.0.0.1:9000/healthz",
	}
	for in, want := range tests {
		if got := healthURL(in); got != want {
			t.Errorf("healthURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHealthcheck(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		wantErr bool
	}{
		{"ok", 200, `{"status":"ok"}`, false},
		{"500", 500, `{"status":"ok"}`, true},
		{"bad json", 200, `nope`, true},
		{"wrong status", 200, `{"status":"bad"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = io.WriteString(w, tt.body)
			}))
			defer ts.Close()
			err := healthcheck(context.Background(), ts.URL+"/healthz")
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestHealthcheckUnreachableAndBadURL(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	if err := healthcheck(context.Background(), "http://"+addr+"/healthz"); err == nil {
		t.Error("want error for unreachable server")
	}
	if err := healthcheck(context.Background(), "http://bad\x7furl"); err == nil {
		t.Error("want error for bad URL")
	}
}

func TestRunHealthcheckExit(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"status":"ok"}`)
	}))
	defer ts.Close()
	var out, errb bytes.Buffer
	listen := strings.TrimPrefix(ts.URL, "http://")
	if code := run(context.Background(), []string{"healthcheck"}, env(map[string]string{"MDV_LISTEN": listen}), &out, &errb); code != 0 {
		t.Fatalf("code = %d, stderr %q", code, errb.String())
	}
	// Unreachable (closed) server: exit 1, no MDV_ROOTS needed.
	ts.Close()
	if code := run(context.Background(), []string{"healthcheck"}, env(map[string]string{"MDV_LISTEN": listen}), &out, &errb); code != 1 {
		t.Fatalf("code = %d", code)
	}
}

func TestServeAndShutdown(t *testing.T) {
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan net.Addr, 1)
	done := make(chan int, 1)
	var errb bytes.Buffer
	go func() {
		done <- serve(ctx, env(map[string]string{
			"MDV_ROOTS":  "t=" + root,
			"MDV_LISTEN": "127.0.0.1:0",
		}), &errb, ready)
	}()
	var addr net.Addr
	select {
	case addr = <-ready:
	case code := <-done:
		t.Fatalf("exited early: %d %s", code, errb.String())
	case <-time.After(5 * time.Second):
		t.Fatal("not ready")
	}
	base := "http://" + addr.String()
	if err := healthcheck(ctx, base+"/healthz"); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(base + "/view/x.md")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 503 {
		t.Errorf("spa status = %d", resp.StatusCode)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"/healthz", nil)
	req.Host = "evil.example"
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusMisdirectedRequest {
		t.Errorf("evil host status = %d", resp.StatusCode)
	}
	// An unused pooled conn stays StateNew, which Shutdown waits 5 s on.
	http.DefaultClient.CloseIdleConnections()
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("code = %d, stderr %s", code, errb.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no shutdown")
	}
}

func TestServeAnyHostWarns(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	var errb bytes.Buffer
	// The busy listen address makes serve exit right after the warning.
	code := serve(context.Background(), env(map[string]string{
		"MDV_ROOTS":         "t=" + t.TempDir(),
		"MDV_LISTEN":        ln.Addr().String(),
		"MDV_ALLOWED_HOSTS": "*",
	}), &errb, nil)
	if code != 1 || !strings.Contains(errb.String(), "MDV_ALLOWED_HOSTS=*") {
		t.Fatalf("code = %d, stderr %s", code, errb.String())
	}
}

func TestServeListenError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	var errb bytes.Buffer
	code := serve(context.Background(), env(map[string]string{
		"MDV_ROOTS":  "t=" + t.TempDir(),
		"MDV_LISTEN": ln.Addr().String(),
	}), &errb, nil)
	if code != 1 {
		t.Fatalf("code = %d", code)
	}
}

// An open SSE stream must not hold shutdown for the drain timeout.
func TestServeShutdownWithOpenEventStream(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan net.Addr, 1)
	done := make(chan int, 1)
	var errb bytes.Buffer
	go func() {
		done <- serve(ctx, env(map[string]string{
			"MDV_ROOTS":  "t=" + root,
			"MDV_LISTEN": "127.0.0.1:0",
		}), &errb, ready)
	}()
	addr := <-ready
	resp, err := http.Get("http://" + addr.String() + "/api/events?sub=t:a.md")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	start := time.Now()
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("code = %d, stderr %s", code, errb.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown blocked by the open stream")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("shutdown took %v", d)
	}
}

func TestHealthcheckSendsLocalhostHost(t *testing.T) {
	var host string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host = r.Host
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()
	if err := healthcheck(context.Background(), ts.URL+"/healthz"); err != nil {
		t.Fatal(err)
	}
	if host != "localhost" {
		t.Errorf("Host = %q", host)
	}
}
