package web_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/awesomejt/markdown-viewer/internal/api"
	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/web"
)

func bundle() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><div id=root></div>")},
		"favicon.svg":          {Data: []byte("<svg xmlns='http://www.w3.org/2000/svg'/>")},
		"assets/app-abc123.js": {Data: []byte("console.log(1)")},
		"assets/sub/x.css":     {Data: []byte("a{}")},
	}
}

func do(t *testing.T, h http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestServe(t *testing.T) {
	h := web.NewHandler(bundle())
	tests := []struct {
		name, method, target string
		status               int
		cache, ctype, body   string
	}{
		{"root", "GET", "/", 200, "no-cache", "text/html", "id=root"},
		{"index direct", "GET", "/index.html", 200, "no-cache", "text/html", "id=root"},
		{"view fallback", "GET", "/view/a/b.md", 200, "no-cache", "text/html", "id=root"},
		{"browse fallback", "GET", "/browse/x", 200, "no-cache", "text/html", "id=root"},
		{"asset", "GET", "/assets/app-abc123.js", 200, "public, max-age=31536000, immutable", "javascript", "console.log"},
		{"nested asset", "GET", "/assets/sub/x.css", 200, "public, max-age=31536000, immutable", "text/css", "a{}"},
		{"favicon", "GET", "/favicon.svg", 200, "no-cache", "image/svg+xml", "<svg"},
		{"asset miss", "GET", "/assets/missing.js", 404, "", "", ""},
		{"assets dir", "GET", "/assets/", 404, "", "", ""},
		{"assets dir no slash", "GET", "/assets", 404, "", "", ""},
		{"api miss", "GET", "/api/nope", 404, "", "", ""},
		{"traversal asset", "GET", "/assets/../index.html", 200, "no-cache", "text/html", "id=root"},
		{"dir fallback", "GET", "/view/", 200, "no-cache", "text/html", "id=root"},
		{"head", "HEAD", "/", 200, "no-cache", "text/html", ""},
		{"head asset", "HEAD", "/assets/app-abc123.js", 200, "public, max-age=31536000, immutable", "javascript", ""},
		{"post", "POST", "/", 405, "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, h, tt.method, tt.target)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d", rec.Code, tt.status)
			}
			if tt.cache != "" && rec.Header().Get("Cache-Control") != tt.cache {
				t.Errorf("Cache-Control = %q, want %q", rec.Header().Get("Cache-Control"), tt.cache)
			}
			if !strings.Contains(rec.Header().Get("Content-Type"), tt.ctype) {
				t.Errorf("Content-Type = %q, want %q", rec.Header().Get("Content-Type"), tt.ctype)
			}
			if !strings.Contains(rec.Body.String(), tt.body) || (tt.body == "" && tt.method == "HEAD" && rec.Body.Len() != 0) {
				t.Errorf("body = %q, want contains %q", rec.Body.String(), tt.body)
			}
		})
	}
	if rec := do(t, h, "POST", "/"); rec.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("Allow = %q", rec.Header().Get("Allow"))
	}
}

func TestNoDirectoryListing(t *testing.T) {
	h := web.NewHandler(bundle())
	rec := do(t, h, "GET", "/assets/sub/")
	if rec.Code != 404 || strings.Contains(rec.Body.String(), "x.css") {
		t.Fatalf("assets dir: %d %q", rec.Code, rec.Body.String())
	}
	// A non-reserved directory path falls back to the SPA shell, not a listing.
	rec = do(t, h, "GET", "/favicon.svg/")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "id=root") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestEmptyBundle(t *testing.T) {
	h := web.NewHandler(fstest.MapFS{".gitkeep": {}})
	for _, target := range []string{"/", "/view/a.md", "/index.html"} {
		rec := do(t, h, "GET", target)
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "web UI not built") {
			t.Errorf("%s: %d %q", target, rec.Code, rec.Body.String())
		}
	}
	if rec := do(t, h, "HEAD", "/"); rec.Code != 503 || rec.Body.Len() != 0 {
		t.Errorf("HEAD: %d %q", rec.Code, rec.Body.String())
	}
	if rec := do(t, h, "GET", "/assets/x.js"); rec.Code != 404 {
		t.Errorf("asset: %d", rec.Code)
	}
}

func TestEmbeddedDefault(t *testing.T) {
	// dist holds only .gitkeep unless `make web` ran; either way no panic and
	// a sane status.
	rec := do(t, web.Handler(), "GET", "/")
	if rec.Code != 200 && rec.Code != 503 {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestIntegrationWithAPI(t *testing.T) {
	cfg := &config.Config{AllowedHosts: []string{"example.com"}}
	reg := fsroot.NewRegistryFromHandles()
	srv := api.New(reg, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	srv.Mux().Handle("/", web.NewHandler(bundle()))
	h := srv.Handler()

	rec := do(t, h, "GET", "/api/nope")
	if rec.Code != 404 || !strings.Contains(rec.Header().Get("Content-Type"), "application/json") ||
		!strings.Contains(rec.Body.String(), `"not_found"`) {
		t.Fatalf("/api/nope: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	rec = do(t, h, "GET", "/healthz")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("/healthz: %d %q", rec.Code, rec.Body.String())
	}
	rec = do(t, h, "GET", "/view/a.md")
	if rec.Code != 200 || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("spa: %d nosniff=%q", rec.Code, rec.Header().Get("X-Content-Type-Options"))
	}
	if rec = do(t, h, "GET", "/assets/missing.js"); rec.Code != 404 {
		t.Fatalf("missing asset: %d", rec.Code)
	}
}
