package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/watch"
)

const (
	// maxSubs is the most sub parameters one event stream may carry.
	maxSubs = 32
	// maxStreams and maxStreamsPerIP cap concurrent event streams, so open
	// streams cannot exhaust the hub's watches or the server's goroutines.
	maxStreams      = 64
	maxStreamsPerIP = 16
	// pingInterval keeps idle streams alive through proxies.
	pingInterval = 25 * time.Second
	// writeTimeout bounds each write to a stream, so a client that stops
	// reading cannot hold the handler (and its watchers) forever.
	writeTimeout = 10 * time.Second
)

// events serves GET /api/events: a Server-Sent Events stream of change events
// for the requested root:path subscriptions.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, codeMethod, "method not allowed")
		return
	}
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
	ip := remoteIP(r)
	if !s.acquireStream(ip) {
		writeError(w, http.StatusServiceUnavailable, codeBusy, "too many open event streams, retry later")
		return
	}
	defer s.releaseStream(ip)
	sub, err := s.hub.Subscribe(r.Context(), subs)
	if err != nil {
		if errors.Is(err, watch.ErrClosed) {
			writeError(w, http.StatusServiceUnavailable, codeBusy, "server is shutting down")
			return
		}
		if errors.Is(err, watch.ErrTooManyWatches) {
			writeError(w, http.StatusServiceUnavailable, codeBusy, "too many paths are being watched, retry later")
			return
		}
		s.fsError(w, r, err)
		return
	}
	defer sub.Close()

	// The stream outlives any server write timeout, so each write gets its
	// own deadline instead.
	rc := http.NewResponseController(w)
	deadline := func() bool {
		err := rc.SetWriteDeadline(time.Now().Add(s.writeTimeout))
		if err != nil && !errors.Is(err, http.ErrNotSupported) {
			s.logger.WarnContext(r.Context(), "set write deadline", "err", err)
			return false
		}
		return true
	}
	if !deadline() {
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// A first body byte makes every browser (and buffering proxy) fire the
	// EventSource "open" event now; the client's refetch on open covers any
	// change made before Subscribe took its baseline.
	if _, err := w.Write([]byte(": open\n\n")); err != nil || rc.Flush() != nil {
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
			if !deadline() {
				return
			}
			if _, err := w.Write([]byte(": ping\n\n")); err != nil || rc.Flush() != nil {
				return
			}
		case <-sub.Notify():
			if !deadline() {
				return
			}
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

// remoteIP is the host part of the TCP peer address. X-Forwarded-For is
// ignored, because any client can forge it.
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// acquireStream reserves a stream slot for ip, or reports that a cap is hit.
func (s *Server) acquireStream(ip string) bool {
	s.streamsMu.Lock()
	defer s.streamsMu.Unlock()
	if s.streams >= s.maxStreams || s.streamsByIP[ip] >= s.maxStreamsPerIP {
		return false
	}
	s.streams++
	s.streamsByIP[ip]++
	return true
}

func (s *Server) releaseStream(ip string) {
	s.streamsMu.Lock()
	defer s.streamsMu.Unlock()
	s.streams--
	if s.streamsByIP[ip]--; s.streamsByIP[ip] <= 0 {
		delete(s.streamsByIP, ip)
	}
}

// Close ends every event stream and stops all watchers. Register it with
// http.Server.RegisterOnShutdown so Shutdown does not wait on open streams.
func (s *Server) Close() { s.hub.Close() }
