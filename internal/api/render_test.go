package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/awesomejt/markdown-viewer/internal/d2render"
)

type fakeD2 struct {
	svg []byte
	err error
}

func (f fakeD2) Render(context.Context, string, string, string) ([]byte, error) {
	return f.svg, f.err
}

func postD2(h http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/render/d2", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func errCodeMsg(t *testing.T, rec *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	var eb errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &eb); err != nil {
		t.Fatalf("bad error body %q: %v", rec.Body.String(), err)
	}
	return eb.Error.Code, eb.Error.Message
}

func TestRenderD2Success(t *testing.T) {
	s, _ := newServer(t)
	h := s.Handler()
	for _, body := range []string{
		`{"source":"a -> b"}`,
		`{"source":"a -> b","theme":"dark","layout":"elk"}`,
	} {
		rec := postD2(h, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", body, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "image/svg+xml" {
			t.Fatalf("content-type %q", ct)
		}
		if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing nosniff")
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "" {
			t.Fatalf("unexpected Cache-Control %q", cc)
		}
		if !strings.Contains(rec.Body.String(), "<svg") {
			t.Fatal("not svg")
		}
	}
}

func TestRenderD2CompileErrorAndImports(t *testing.T) {
	s, _ := newServer(t)
	h := s.Handler()
	for _, src := range []string{"a ->", "x: @../../etc/passwd", "...@/etc/passwd"} {
		b, _ := json.Marshal(renderRequest{Source: src})
		rec := postD2(h, string(b))
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%q: %d %s", src, rec.Code, rec.Body.String())
		}
		code, msg := errCodeMsg(t, rec)
		if code != "render_error" || !strings.Contains(msg, "1:") {
			t.Fatalf("%q: %s %q", src, code, msg)
		}
	}
}

func TestRenderD2BadRequests(t *testing.T) {
	s, _ := newServer(t)
	h := s.Handler()
	for _, body := range []string{
		``, `{`, `[]`, `{"source":""}`, `{}`,
		`{"source":"a","theme":"neon"}`, `{"source":"a","layout":"tala"}`,
	} {
		rec := postD2(h, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%q: %d", body, rec.Code)
			continue
		}
		if code, _ := errCodeMsg(t, rec); code != "bad_request" {
			t.Errorf("%q: code %s", body, code)
		}
	}
}

func TestRenderD2TooLarge(t *testing.T) {
	s, _ := newServer(t)
	body := `{"source":"` + strings.Repeat("a", maxD2Body) + `"}`
	rec := postD2(s.Handler(), body)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("%d", rec.Code)
	}
	if code, _ := errCodeMsg(t, rec); code != "too_large" {
		t.Fatal(code)
	}
}

func TestRenderD2Method(t *testing.T) {
	s, _ := newServer(t)
	rec := do(s.Handler(), http.MethodGet, "/api/render/d2")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("%d", rec.Code)
	}
	if code, _ := errCodeMsg(t, rec); code != "method_not_allowed" {
		t.Fatal(code)
	}
	if rec.Header().Get("Allow") != "POST" {
		t.Fatal("missing Allow")
	}
}

func TestRenderD2ErrorMapping(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{d2render.ErrBusy, http.StatusServiceUnavailable, "busy"},
		{d2render.ErrTimeout, http.StatusGatewayTimeout, "render_timeout"},
		{&d2render.CompileError{Msg: "2:3: oops"}, http.StatusUnprocessableEntity, "render_error"},
		{&d2render.BadRequestError{Msg: "x"}, http.StatusBadRequest, "bad_request"},
		{errors.New("secret detail"), http.StatusInternalServerError, "internal"},
	}
	for _, tc := range cases {
		s, logs := newServer(t)
		s.d2 = fakeD2{err: tc.err}
		rec := postD2(s.Handler(), `{"source":"a"}`)
		if rec.Code != tc.status {
			t.Fatalf("%v: %d", tc.err, rec.Code)
		}
		code, msg := errCodeMsg(t, rec)
		if code != tc.code {
			t.Fatalf("%v: code %s", tc.err, code)
		}
		if tc.code == "internal" {
			if strings.Contains(msg, "secret") {
				t.Fatal("internal detail leaked")
			}
			if !strings.Contains(logs.String(), "secret detail") {
				t.Fatal("detail not logged")
			}
		}
	}
}

func TestRenderD2CancelledContext(t *testing.T) {
	s, _ := newServer(t)
	s.d2 = fakeD2{err: context.Canceled}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodPost, "/api/render/d2", strings.NewReader(`{"source":"a"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req) // must not panic
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("%d", rec.Code)
	}
}
