package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/settings"
)

// Error codes and fixed messages of GET /api/prefs. The messages never carry
// OS error text, which holds the host path.
const (
	codePrefsUnreadable = "prefs_unreadable"
	codePrefsInvalid    = "prefs_invalid"

	msgPrefsUnreadable = "preferences file could not be read"
	msgPrefsTimeout    = "preferences file read timed out"
	msgPrefsBusy       = "preferences file could not be parsed in time"
	msgPrefsTooLarge   = "file is larger than 32 KiB"
)

// errPrefsTooLarge marks a file over [settings.MaxFileSize].
var errPrefsTooLarge = errors.New("preferences file too large")

// prefsResult is one completed load, ready to serve.
type prefsResult struct {
	settings settings.Settings
	warnings []settings.Warning
	err      *errorDetail
	state    string // "missing", "unreadable", "timeout", "invalid", "valid"
	content  []byte // hashed for log de-duplication only; never logged
}

// prefsRead is one outstanding read; done closes after res is set.
type prefsRead struct {
	done chan struct{}
	res  prefsResult
}

// prefsStore owns the global preferences file: it re-reads and re-parses on
// every request, but keeps at most one read outstanding. Requests that find a
// read pending wait up to timeout and then get the last completed result.
type prefsStore struct {
	path    string
	timeout time.Duration
	sem     *settings.Sem
	logger  *slog.Logger

	// read returns the file bytes. Tests replace it. It returns
	// fs.ErrNotExist for a missing file and errPrefsTooLarge for an oversize
	// one; any other error means unreadable.
	read func(path string) ([]byte, error)

	mu       sync.Mutex
	inflight *prefsRead
	last     *prefsResult
	logged   bool
	lastHash [sha256.Size]byte
}

func newPrefsStore(path string, timeout time.Duration, sem *settings.Sem, logger *slog.Logger) *prefsStore {
	return &prefsStore{path: path, timeout: timeout, sem: sem, logger: logger, read: readPrefsFile}
}

// readPrefsFile opens path without blocking, requires a regular file within
// the size cap, and reads it.
func readPrefsFile(path string) ([]byte, error) {
	f, err := openNonblock(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !fi.Mode().IsRegular() {
		return nil, errors.New("not a regular file")
	}
	if fi.Size() > settings.MaxFileSize {
		return nil, errPrefsTooLarge
	}
	b, err := io.ReadAll(io.LimitReader(f, settings.MaxFileSize+1))
	if err != nil {
		return nil, err
	}
	if len(b) > settings.MaxFileSize {
		return nil, errPrefsTooLarge
	}
	return b, nil
}

// get returns the current result, starting or joining the single read.
func (p *prefsStore) get(ctx context.Context) prefsResult {
	p.mu.Lock()
	rd := p.inflight
	if rd == nil {
		rd = &prefsRead{done: make(chan struct{})}
		p.inflight = rd
		go p.run(rd)
	}
	last := p.last
	p.mu.Unlock()

	t := time.NewTimer(p.timeout)
	defer t.Stop()
	select {
	case <-rd.done:
		return rd.res
	case <-t.C:
	case <-ctx.Done():
	}
	if last != nil {
		return *last
	}
	res := prefsResult{state: "timeout", err: &errorDetail{Code: codePrefsUnreadable, Message: msgPrefsTimeout}}
	p.record(res)
	return res
}

// run performs the read and parse, publishes the result, and frees the slot.
func (p *prefsStore) run(rd *prefsRead) {
	res := p.load()
	p.record(res)
	p.mu.Lock()
	p.last = &res
	p.inflight = nil
	p.mu.Unlock()
	rd.res = res
	close(rd.done)
}

func (p *prefsStore) load() prefsResult {
	b, err := p.read(p.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return prefsResult{state: "missing"}
	case errors.Is(err, errPrefsTooLarge):
		return prefsResult{state: "invalid", err: &errorDetail{Code: codePrefsInvalid, Message: msgPrefsTooLarge}}
	case err != nil:
		return prefsResult{state: "unreadable", err: &errorDetail{Code: codePrefsUnreadable, Message: msgPrefsUnreadable}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), p.timeout)
	defer cancel()
	release, err := p.sem.Acquire(ctx)
	if err != nil {
		return prefsResult{state: "unreadable", err: &errorDetail{Code: codePrefsUnreadable, Message: msgPrefsBusy}}
	}
	defer release()
	prefs, warns, err := settings.ParsePrefs(b)
	var pe *settings.ParseError
	if errors.As(err, &pe) {
		return prefsResult{state: "invalid", content: b,
			err: &errorDetail{Code: codePrefsInvalid, Message: pe.Msg, Line: pe.Line}}
	}
	if err != nil { // ParsePrefs only returns *ParseError; stay safe
		return prefsResult{state: "invalid", content: b, err: &errorDetail{Code: codePrefsInvalid, Message: "file is not valid"}}
	}
	return prefsResult{state: "valid", content: b, settings: prefs.Settings, warnings: warns}
}

// record logs res once per distinct (state, content). Neither contents nor
// the host path are logged.
func (p *prefsStore) record(res prefsResult) {
	h := sha256.New()
	h.Write([]byte(res.state))
	h.Write([]byte{0})
	h.Write(res.content)
	var sum [sha256.Size]byte
	h.Sum(sum[:0])

	p.mu.Lock()
	dup := p.logged && bytes.Equal(sum[:], p.lastHash[:])
	p.logged, p.lastHash = true, sum
	p.mu.Unlock()
	if dup {
		return
	}
	attrs := []any{"state", res.state, "warnings", len(res.warnings)}
	if res.err != nil {
		attrs = append(attrs, "code", res.err.Code)
		if res.err.Line > 0 {
			attrs = append(attrs, "line", res.err.Line)
		}
	}
	ctx := context.Background()
	if res.state == "valid" && len(res.warnings) == 0 {
		p.logger.InfoContext(ctx, "preferences loaded", attrs...)
		return
	}
	p.logger.WarnContext(ctx, "preferences", attrs...)
}

type prefsBody struct {
	Configured bool               `json:"configured"`
	Settings   settings.Settings  `json:"settings"`
	Warnings   []settings.Warning `json:"warnings"`
	Error      *errorDetail       `json:"error"`
}

// prefs serves GET /api/prefs. It always answers 200.
func (s *Server) prefs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	body := prefsBody{Warnings: []settings.Warning{}}
	if s.prefsStore != nil {
		res := s.prefsStore.get(r.Context())
		body.Configured = true
		body.Settings = res.settings
		body.Error = res.err
		if res.warnings != nil {
			body.Warnings = res.warnings
		}
	}
	writeJSON(w, http.StatusOK, body)
}
