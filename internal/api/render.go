package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/awesomejt/markdown-viewer/internal/d2render"
)

// maxD2Body is the request body limit for POST /api/render/d2.
const maxD2Body = 256 << 10

// d2Renderer is satisfied by *d2render.Renderer; tests substitute fakes.
type d2Renderer interface {
	Render(ctx context.Context, source, theme, layout string) ([]byte, error)
}

type renderRequest struct {
	Source string `json:"source"`
	Theme  string `json:"theme"`  // "light" (default when empty) or "dark"
	Layout string `json:"layout"` // "dagre" (default when empty) or "elk"
}

func (s *Server) renderD2(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxD2Body)
	var req renderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, "D2 source exceeds 256 KiB")
			return
		}
		writeError(w, http.StatusBadRequest, codeBadRequest, "malformed JSON body")
		return
	}
	if req.Source == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "missing source")
		return
	}
	svg, err := s.d2.Render(r.Context(), req.Source, req.Theme, req.Layout)
	if err != nil {
		s.renderError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(svg)
}

func (s *Server) renderError(w http.ResponseWriter, r *http.Request, err error) {
	var ce *d2render.CompileError
	var br *d2render.BadRequestError
	switch {
	case errors.As(err, &br):
		writeError(w, http.StatusBadRequest, codeBadRequest, br.Msg)
	case errors.As(err, &ce):
		writeError(w, http.StatusUnprocessableEntity, codeRender, ce.Msg)
	case errors.Is(err, d2render.ErrBusy):
		writeError(w, http.StatusServiceUnavailable, codeBusy, "no D2 render slot available, retry shortly")
	case errors.Is(err, d2render.ErrTimeout):
		writeError(w, http.StatusGatewayTimeout, codeRenderTO, "D2 render timed out")
	case r.Context().Err() != nil:
		// Client went away; nothing useful to send.
		s.logger.DebugContext(r.Context(), "render cancelled", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
	default:
		s.logger.ErrorContext(r.Context(), "render failed", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
	}
}
