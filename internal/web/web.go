package web

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

// The bundle is produced by `make web` (Vite). During `make check` it holds
// only .gitkeep, so the handler must work with an empty bundle.
//
//go:embed all:dist
var distFS embed.FS

const (
	cacheNoCache   = "no-cache"
	cacheImmutable = "public, max-age=31536000, immutable"
	indexName      = "index.html"
)

// Handler serves the embedded SPA bundle.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil { // unreachable: "dist" is embedded at compile time
		panic(err)
	}
	return NewHandler(sub)
}

// NewHandler serves the SPA from bundle with history-routing fallback.
//
// Existing files are served as-is. Files under /assets/ (Vite's content-hashed
// output) are immutable for a year; index.html and every other static file
// (favicon and similar, whose names are not hashed) are "no-cache" so they
// are always revalidated. Misses under /assets/ and /api/ are 404; any other
// unknown path gets index.html with 200. Directories are never listed. If the
// bundle has no index.html the response is a plain-text 503.
func NewHandler(bundle fs.FS) http.Handler {
	return &spa{fsys: bundle}
}

type spa struct{ fsys fs.FS }

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	reserved := clean == "/api" || strings.HasPrefix(clean, "/api/") ||
		clean == "/assets" || strings.HasPrefix(clean, "/assets/")
	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		name = indexName
	}
	// A trailing slash never names a file, so such paths take the fallback.
	if fs.ValidPath(name) && (clean == "/" || !strings.HasSuffix(r.URL.Path, "/")) {
		if data, ok := s.readFile(name); ok {
			s.serve(w, r, name, data)
			return
		}
	}
	if reserved {
		http.NotFound(w, r)
		return
	}
	data, ok := s.readFile(indexName)
	if !ok {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", cacheNoCache)
		w.WriteHeader(http.StatusServiceUnavailable)
		if r.Method != http.MethodHead {
			_, _ = w.Write([]byte("web UI not built\n"))
		}
		return
	}
	s.serve(w, r, indexName, data)
}

// readFile returns the contents of a regular file; directories and errors
// report false.
func (s *spa) readFile(name string) ([]byte, bool) {
	st, err := fs.Stat(s.fsys, name)
	if err != nil || !st.Mode().IsRegular() {
		return nil, false
	}
	data, err := fs.ReadFile(s.fsys, name)
	if err != nil {
		return nil, false
	}
	return data, true
}

func (s *spa) serve(w http.ResponseWriter, r *http.Request, name string, data []byte) {
	cc := cacheNoCache
	if strings.HasPrefix(name, "assets/") {
		cc = cacheImmutable
	}
	w.Header().Set("Cache-Control", cc)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
