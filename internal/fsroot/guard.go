package fsroot

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"strings"
	"syscall"
	"unicode/utf8"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// Kind classifies a guard failure so callers can map it to an HTTP status
// without matching strings.
type Kind int

const (
	// KindBadRequest is a malformed or hostile path (HTTP 400).
	KindBadRequest Kind = iota + 1
	// KindForbidden is a path that escapes the root or is not permitted (HTTP 403).
	KindForbidden
	// KindNotFound is a path that does not exist, including dangling symlinks (HTTP 404).
	KindNotFound
	// KindInternal is an unexpected filesystem failure (HTTP 500).
	KindInternal
	// KindTimeout is a filesystem operation that timed out, was refused because
	// the root's in-flight cap is full, or hit a root marked unavailable (HTTP 504).
	KindTimeout
)

// String returns a short stable name for the kind.
func (k Kind) String() string {
	switch k {
	case KindBadRequest:
		return "bad_request"
	case KindForbidden:
		return "forbidden"
	case KindNotFound:
		return "not_found"
	case KindInternal:
		return "internal"
	case KindTimeout:
		return "fs_timeout"
	default:
		return "unknown"
	}
}

// Sentinel errors, usable with errors.Is on any error returned by this package.
var (
	ErrBadRequest = errors.New("bad request")
	ErrForbidden  = errors.New("forbidden")
	ErrNotFound   = errors.New("not found")
	ErrInternal   = errors.New("internal error")
	ErrTimeout    = errors.New("filesystem timeout")
)

// PathError is the typed error returned by the guard. Use errors.As to get
// Kind, or errors.Is against the sentinel errors.
type PathError struct {
	Kind   Kind
	Op     string // operation, e.g. "open" or "resolve"
	Path   string // the client-supplied path
	Reason string // short human-readable reason (bad requests only)
	Err    error  // underlying error, if any
}

// Error implements error.
func (e *PathError) Error() string {
	msg := e.Op + " " + fmt.Sprintf("%q", e.Path) + ": " + e.Kind.String()
	if e.Reason != "" {
		msg += " (" + e.Reason + ")"
	}
	if e.Err != nil {
		msg += ": " + e.Err.Error()
	}
	return msg
}

// PublicMessage returns text built only from Kind, the client path and Reason.
// It never includes Err, which can contain absolute host paths. It is the only
// text safe to send to clients; Error is for logs.
func (e *PathError) PublicMessage() string {
	msg := e.Kind.String() + ": " + fmt.Sprintf("%q", e.Path)
	if e.Reason != "" {
		msg += " (" + e.Reason + ")"
	}
	return msg
}

// Unwrap exposes the underlying error and the kind's sentinel.
func (e *PathError) Unwrap() []error {
	errs := []error{e.sentinel()}
	if e.Err != nil {
		errs = append(errs, e.Err)
	}
	return errs
}

func (e *PathError) sentinel() error {
	switch e.Kind {
	case KindBadRequest:
		return ErrBadRequest
	case KindForbidden:
		return ErrForbidden
	case KindNotFound:
		return ErrNotFound
	case KindTimeout:
		return ErrTimeout
	default:
		return ErrInternal
	}
}

// KindOf returns the Kind of err, or 0 if err is not a *PathError.
func KindOf(err error) Kind {
	var pe *PathError
	if errors.As(err, &pe) {
		return pe.Kind
	}
	return 0
}

func badRequest(rel, reason string) error {
	return &PathError{Kind: KindBadRequest, Op: "resolve", Path: rel, Reason: reason}
}

// maxPathBytes is the longest client path Resolve accepts.
const maxPathBytes = 4096

// isControl reports C0, DEL, C1 and bidi control characters.
func isControl(r rune) bool {
	switch {
	case r < 0x20, r >= 0x7f && r <= 0x9f:
		return true
	case r == 0x200e, r == 0x200f, r >= 0x202a && r <= 0x202e, r >= 0x2066 && r <= 0x2069:
		return true
	}
	return false
}

// Resolve validates an untrusted client path and returns a cleaned,
// root-relative, slash-separated name suitable for [os.Root] methods ("." is
// the root itself). It is purely lexical and touches no filesystem.
//
// The input is expected to be already URL-decoded by net/http and is never
// decoded again: a literal "%2e%2e" is an ordinary file name (harmless, and
// usually a 404).
//
// Policy, all rejections are KindBadRequest:
//   - more than 4096 bytes ("path too long")
//   - invalid UTF-8, NUL bytes, other control characters (C0, DEL, C1) and
//     bidi controls (U+200E/F, U+202A-E, U+2066-9)
//   - a leading "/" (absolute path) or any backslash
//   - a Windows drive-letter first segment such as "C:" or "c:foo"
//   - any ".." segment in the raw input, even if cleaning would neutralise it
//     (so "a/../b" is rejected, not rewritten)
//
// Accepted and normalised: "" and "." mean the root; a leading "./", repeated
// slashes, "." segments, and a trailing slash are collapsed by path.Clean.
func Resolve(rel string) (string, error) {
	if len(rel) > maxPathBytes {
		return "", badRequest(rel, "path too long")
	}
	if !utf8.ValidString(rel) {
		return "", badRequest(rel, "invalid UTF-8")
	}
	for _, r := range rel {
		if isControl(r) {
			return "", badRequest(rel, "control character")
		}
	}
	if strings.HasPrefix(rel, "/") {
		return "", badRequest(rel, "absolute path")
	}
	if strings.Contains(rel, `\`) {
		return "", badRequest(rel, "backslash")
	}
	segs := strings.Split(rel, "/")
	for _, s := range segs {
		if s == ".." {
			return "", badRequest(rel, "parent segment")
		}
	}
	if first := segs[0]; len(first) >= 2 && first[1] == ':' &&
		(first[0]|0x20 >= 'a' && first[0]|0x20 <= 'z') {
		return "", badRequest(rel, "drive letter")
	}
	return path.Clean(rel), nil
}

// Root is a named directory tree opened through [os.Root].
type Root struct {
	name string
	root *os.Root
}

// OpenRoot opens the configured root directory. It fails if the path is not a
// directory or cannot be opened.
func OpenRoot(cfg config.Root) (*Root, error) {
	r, err := os.OpenRoot(cfg.Path)
	if err != nil {
		// os.Root reports a non-directory with an unmatchable error; recheck so
		// callers can tell "not a directory" (fatal) from an outage.
		if st, serr := os.Stat(cfg.Path); serr == nil && !st.IsDir() {
			err = syscall.ENOTDIR
		}
		return nil, fmt.Errorf("fsroot: open root %q: %w", cfg.Name, err)
	}
	return &Root{name: cfg.Name, root: r}, nil
}

// Name returns the root's configured name.
func (r *Root) Name() string { return r.name }

// Close releases the underlying directory handle.
func (r *Root) Close() error { return r.root.Close() }

// Resolve is the package-level [Resolve]; it is lexical and root-independent.
func (r *Root) Resolve(rel string) (string, error) { return Resolve(rel) }

// Open opens the regular file or directory at the untrusted client path rel.
// The file is opened O_NONBLOCK and checked with fstat, so FIFOs, sockets and
// devices are refused (KindForbidden) without blocking.
//
// The returned file's Name() and the errors from its methods contain absolute
// host paths. They must never reach clients; use [PathError.PublicMessage].
func (r *Root) Open(rel string) (*os.File, error) {
	name, err := Resolve(rel)
	if err != nil {
		return nil, err
	}
	return r.openChecked("open", rel, name)
}

func (r *Root) openChecked(op, rel, name string) (*os.File, error) {
	f, err := r.root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, mapErr(op, rel, err)
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, mapErr(op, rel, err)
	}
	if !fi.Mode().IsRegular() && !fi.IsDir() {
		_ = f.Close()
		return nil, &PathError{Kind: KindForbidden, Op: op, Path: rel, Reason: "not a regular file"}
	}
	return f, nil
}

// Stat returns file info for rel, following symlinks that stay inside the root.
func (r *Root) Stat(rel string) (fs.FileInfo, error) {
	name, err := Resolve(rel)
	if err != nil {
		return nil, err
	}
	fi, err := r.root.Stat(name)
	if err != nil {
		return nil, mapErr("stat", rel, err)
	}
	return fi, nil
}

// Lstat returns file info for rel without following a final symlink. Symlinks
// in intermediate segments are still confined to the root.
func (r *Root) Lstat(rel string) (fs.FileInfo, error) {
	name, err := Resolve(rel)
	if err != nil {
		return nil, err
	}
	fi, err := r.root.Lstat(name)
	if err != nil {
		return nil, mapErr("lstat", rel, err)
	}
	return fi, nil
}

// ReadDir lists the directory at rel, in the order returned by the OS.
func (r *Root) ReadDir(rel string) ([]fs.DirEntry, error) {
	name, err := Resolve(rel)
	if err != nil {
		return nil, err
	}
	d, err := r.openChecked("readdir", rel, name)
	if err != nil {
		return nil, err
	}
	defer func() { _ = d.Close() }()
	ents, err := d.ReadDir(-1)
	if err != nil {
		return nil, mapErr("readdir", rel, err)
	}
	return ents, nil
}

// escapeMessage is the text of the unexported error os.Root returns when a
// path (via a symlink, absolute or relative) leaves the root. Go does not
// export it, so it is matched on the underlying error text; a test pins this
// behaviour so a Go upgrade that changes it fails loudly.
const escapeMessage = "path escapes from parent"

// isEscape reports whether any error in the chain is os.Root's escape error.
func isEscape(err error) bool {
	for ; err != nil; err = errors.Unwrap(err) {
		if err.Error() == escapeMessage {
			return true
		}
	}
	return false
}

// mapErr converts an os.Root error into a *PathError.
//
// Escapes are detected directly from os.Root's own error (see escapeMessage),
// so no Lstat/Readlink probing is needed here. Permission denied maps to 403:
// the entry exists but the viewer may not read it. Symlink loops and ENOTDIR
// (a file used as a directory) map to 404 since no such path exists.
func mapErr(op, rel string, err error) error {
	pe := &PathError{Op: op, Path: rel, Err: err}
	switch {
	case isEscape(err):
		pe.Kind = KindForbidden
	case errors.Is(err, syscall.ENAMETOOLONG):
		pe.Kind = KindBadRequest
		pe.Reason = "path too long"
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, syscall.ENOTDIR), errors.Is(err, syscall.ELOOP):
		pe.Kind = KindNotFound
	case errors.Is(err, fs.ErrPermission):
		pe.Kind = KindForbidden
	default:
		pe.Kind = KindInternal
	}
	return pe
}
