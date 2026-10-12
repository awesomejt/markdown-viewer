package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/d2render"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/watch"
)

// Error codes used in the JSON error model.
const (
	codeBadRequest  = "bad_request"
	codeForbidden   = "forbidden"
	codeNotFound    = "not_found"
	codeTooLarge    = "too_large"
	codeFSTimeout   = "fs_timeout"
	codeInternal    = "internal"
	codeMethod      = "method_not_allowed"
	codeRender      = "render_error"
	codeBusy        = "busy"
	codeRenderTO    = "render_timeout"
	codeUnsupported = "unsupported_media_type"
)

// Server holds the API dependencies and the route table. Later tasks mount the
// SPA and further routes on [Server.Mux] before calling [Server.Handler].
type Server struct {
	reg    *fsroot.Registry
	cfg    *config.Config
	logger *slog.Logger
	mux    *http.ServeMux
	d2     d2Renderer
	hub    *watch.Hub

	pingInterval time.Duration // SSE keep-alive; tests shorten it
	writeTimeout time.Duration // per-write SSE deadline; tests shorten it
}

// New builds a Server with the core routes registered. A nil logger discards
// logs.
func New(reg *fsroot.Registry, cfg *config.Config, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	s := &Server{reg: reg, cfg: cfg, logger: logger, mux: http.NewServeMux(), pingInterval: pingInterval, writeTimeout: writeTimeout}
	s.hub = watch.New(reg, watch.Options{PollInterval: cfg.PollInterval, Logger: logger})
	s.d2 = d2render.New(d2render.Options{
		Timeout: cfg.D2Timeout, Concurrency: cfg.D2Concurrency, CacheEntries: cfg.D2CacheEntries,
	})
	s.mux.HandleFunc("/healthz", s.get(s.healthz))
	s.mux.HandleFunc("/api/roots", s.get(s.roots))
	s.mux.HandleFunc("/api/list", s.get(s.list))
	s.mux.HandleFunc("/api/file", fileHeaders(s.get(s.file)))
	s.mux.Handle("/api/render/d2", crossOriginGuard(s.post(s.renderD2)))
	s.mux.HandleFunc("/api/events", s.events) // GET only; events answers other methods itself
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, codeNotFound, "unknown API endpoint")
	})
	return s
}

// Mux returns the route table so other packages can add routes (for example
// the SPA on "/") before the handler is served.
func (s *Server) Mux() *http.ServeMux { return s.mux }

// Handler returns the mux wrapped in the recover and logging middleware.
func (s *Server) Handler() http.Handler {
	return s.middleware(s.mux)
}

// get restricts a handler to GET and HEAD with a JSON 405 otherwise.
func (s *Server) get(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeError(w, http.StatusMethodNotAllowed, codeMethod, "method not allowed")
			return
		}
		h(w, r)
	}
}

// post restricts a handler to POST with a JSON 405 otherwise.
func (s *Server) post(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeError(w, http.StatusMethodNotAllowed, codeMethod, "method not allowed")
			return
		}
		h(w, r)
	}
}

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: msg}})
}

// fsError maps a filesystem error to the error model. Only the PathError
// public message reaches the client; everything else is logged.
func (s *Server) fsError(w http.ResponseWriter, r *http.Request, err error) {
	var pe *fsroot.PathError
	if !errors.As(err, &pe) {
		s.logger.ErrorContext(r.Context(), "unexpected error", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
		return
	}
	switch pe.Kind {
	case fsroot.KindBadRequest:
		writeError(w, http.StatusBadRequest, codeBadRequest, pe.PublicMessage())
	case fsroot.KindForbidden:
		writeError(w, http.StatusForbidden, codeForbidden, pe.PublicMessage())
	case fsroot.KindNotFound:
		writeError(w, http.StatusNotFound, codeNotFound, pe.PublicMessage())
	case fsroot.KindTimeout:
		s.logger.WarnContext(r.Context(), "filesystem timeout", "err", err)
		writeError(w, http.StatusGatewayTimeout, codeFSTimeout, pe.PublicMessage())
	default:
		s.logger.ErrorContext(r.Context(), "filesystem error", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
	}
}

// statusWriter records the status and byte count for logging and recovery.
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if code < 200 { // informational: not the final status
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if !w.wrote {
		w.status, w.wrote = code, true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status, w.wrote = http.StatusOK, true
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		start := time.Now()
		w := &statusWriter{ResponseWriter: rw, status: http.StatusOK}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		defer func() {
			abort := false
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler { //nolint:errorlint // sentinel panic value, compared by identity
					abort = true
				} else {
					s.logger.ErrorContext(r.Context(), "panic in handler", "panic", rec, "stack", string(debug.Stack()))
					if w.wrote {
						abort = true // body already started: abort rather than send a clean truncation
					} else {
						writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
					}
				}
			}
			defer func() {
				if abort {
					panic(http.ErrAbortHandler)
				}
			}()
			s.logger.InfoContext(r.Context(), "request",
				"method", r.Method, "path", r.URL.Path, "query", r.URL.RawQuery,
				"status", w.status, "bytes", w.bytes, "duration", time.Since(start))
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type rootJSON struct {
	Name      string `json:"name"`
	Watch     string `json:"watch"`
	Available bool   `json:"available"`
}

func (s *Server) roots(w http.ResponseWriter, _ *http.Request) {
	infos := s.reg.Roots()
	out := make([]rootJSON, 0, len(infos))
	for _, ri := range infos {
		out = append(out, rootJSON{Name: ri.Name, Watch: string(ri.Watch), Available: ri.Available})
	}
	writeJSON(w, http.StatusOK, map[string]any{"roots": out})
}

type entryJSON struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Kind  string `json:"kind"`
	Size  int64  `json:"size"`
	MTime string `json:"mtime"`
}

type listJSON struct {
	Root      string      `json:"root"`
	Path      string      `json:"path"`
	Truncated bool        `json:"truncated"`
	Entries   []entryJSON `json:"entries"`
}

// handleFor resolves the root query parameter.
func (s *Server) handleFor(w http.ResponseWriter, r *http.Request) (*fsroot.Handle, string, bool) {
	name := r.URL.Query().Get("root")
	if name == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "missing root parameter")
		return nil, "", false
	}
	h, err := s.reg.Get(name)
	if err != nil {
		s.fsError(w, r, err)
		return nil, "", false
	}
	return h, name, true
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	h, name, ok := s.handleFor(w, r)
	if !ok {
		return
	}
	l, err := h.List(r.Context(), r.URL.Query().Get("path"))
	if err != nil {
		s.fsError(w, r, err)
		return
	}
	p := l.Path
	if p == "." {
		p = ""
	}
	out := listJSON{Root: name, Path: p, Truncated: l.Truncated, Entries: make([]entryJSON, 0, len(l.Entries))}
	for _, e := range l.Entries {
		out.Entries = append(out.Entries, entryJSON{
			Name: e.Name, Type: e.Type, Kind: string(e.Kind), Size: e.Size,
			MTime: e.ModTime.UTC().Format(time.RFC3339Nano),
		})
	}
	writeJSON(w, http.StatusOK, out)
}
