package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/watch"
)

const (
	// maxSubs is the most sub parameters one event stream may carry.
	maxSubs = 32
	// pingInterval keeps idle streams alive through proxies.
	pingInterval = 25 * time.Second
)

// events serves GET /api/events: a Server-Sent Events stream of change events
// for the requested root:path subscriptions.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query()["sub"]
	if len(raw) == 0 || len(raw) > maxSubs {
		writeError(w, http.StatusBadRequest, codeBadRequest, fmt.Sprintf("want 1 to %d sub parameters", maxSubs))
		return
	}
	subs := make([]watch.Sub, len(raw))
	for i, v := range raw {
		root, p, ok := strings.Cut(v, ":")
		if !ok || root == "" {
			writeError(w, http.StatusBadRequest, codeBadRequest, "sub must be <root>:<path>")
			return
		}
		subs[i] = watch.Sub{Root: root, Path: p}
	}
	sub, err := s.hub.Subscribe(r.Context(), subs)
	if err != nil {
		if errors.Is(err, watch.ErrClosed) {
			writeError(w, http.StatusServiceUnavailable, codeBusy, "server is shutting down")
			return
		}
		s.fsError(w, r, err)
		return
	}
	defer sub.Close()

	// The stream outlives any server write timeout.
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		s.logger.WarnContext(r.Context(), "clear write deadline", "err", err)
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if err := rc.Flush(); err != nil {
		return
	}

	ping := time.NewTicker(s.pingInterval)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-sub.Done():
			return
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil || rc.Flush() != nil {
				return
			}
		case <-sub.Notify():
			for _, ev := range sub.Drain() {
				data, err := json.Marshal(ev)
				if err != nil {
					continue
				}
				if _, err := fmt.Fprintf(w, "event: change\ndata: %s\n\n", data); err != nil {
					return
				}
			}
			if rc.Flush() != nil {
				return
			}
		}
	}
}

// Close ends every event stream and stops all watchers. Register it with
// http.Server.RegisterOnShutdown so Shutdown does not wait on open streams.
func (s *Server) Close() { s.hub.Close() }
