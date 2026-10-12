package api

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
)

// fileCSP is sent on every /api/file response.
const fileCSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"

const mimeOctet = "application/octet-stream"

// rasterMIME lists the raster image types served inline.
var rasterMIME = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
}

// neverInline lists extensions that can execute in a browser and so are only
// ever served as attachments, whatever fsroot classifies them as.
var neverInline = map[string]bool{
	".html": true, ".htm": true, ".xhtml": true, ".xml": true, ".xsl": true, ".shtml": true,
}

// serving describes how one file is served.
type serving struct {
	contentType string
	attachment  bool
	text        bool // subject to the MaxFileBytes limit
}

// classify applies the explicit, extension-based, case-insensitive allowlist.
func classify(name string) serving {
	ext := strings.ToLower(path.Ext(name))
	if neverInline[ext] {
		return serving{contentType: mimeOctet, attachment: true}
	}
	if mt, ok := rasterMIME[ext]; ok {
		return serving{contentType: mt}
	}
	if ext == ".svg" {
		return serving{contentType: "image/svg+xml"}
	}
	switch fsroot.KindForExt(ext) {
	case fsroot.FileKindMarkdown, fsroot.FileKindDiagram, fsroot.FileKindText:
		return serving{contentType: "text/plain; charset=utf-8", text: true}
	}
	return serving{contentType: mimeOctet, attachment: true}
}

// contentDisposition builds an attachment header with an ASCII fallback and an
// RFC 5987 UTF-8 name.
func contentDisposition(name string) string {
	var fb, enc strings.Builder
	for i := range len(name) {
		c := name[i]
		switch {
		case c >= 0x20 && c < 0x7f && c != '"' && c != '\\' && c != '%' && c != ';':
			fb.WriteByte(c)
		default:
			fb.WriteByte('_')
		}
		if c < 0x80 && (c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' ||
			strings.IndexByte("!#$&+-.^_`|~", c) >= 0) {
			enc.WriteByte(c)
		} else {
			fmt.Fprintf(&enc, "%%%02X", c)
		}
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fb.String(), enc.String())
}

// errRecorder remembers the first read error so it can be logged after
// http.ServeContent, which cannot report one once headers are sent.
type errRecorder struct {
	io.ReadSeeker
	err error
}

func (e *errRecorder) Read(p []byte) (int, error) {
	n, err := e.ReadSeeker.Read(p)
	if err != nil && !errors.Is(err, io.EOF) && e.err == nil {
		e.err = err
	}
	return n, err
}

// chunkWriter gives every body write its own write deadline, so a client
// that stops reading fails the copy instead of holding the handler and its
// file descriptor forever. It deliberately hides io.ReaderFrom: the
// underlying response's ReadFrom would write around the deadline.
type chunkWriter struct {
	http.ResponseWriter
	rc      *http.ResponseController
	timeout time.Duration
}

// arm sets the next deadline. A writer without deadline support (tests)
// streams without one.
func (d *chunkWriter) arm() error {
	err := d.rc.SetWriteDeadline(time.Now().Add(d.timeout))
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}

func (d *chunkWriter) Write(p []byte) (int, error) {
	if err := d.arm(); err != nil {
		return 0, err
	}
	return d.ResponseWriter.Write(p)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (d *chunkWriter) Unwrap() http.ResponseWriter { return d.ResponseWriter }

// fileHeaders sets the headers every /api/file response carries, including
// method-not-allowed and error responses.
func fileHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hdr := w.Header()
		hdr.Set("Content-Security-Policy", fileCSP)
		hdr.Set("X-Content-Type-Options", "nosniff")
		next(w, r)
	}
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	hdr := w.Header()
	h, _, ok := s.handleFor(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	rel := q.Get("path")
	ctx := r.Context()
	f, err := h.Open(ctx, rel)
	if err != nil {
		s.fsError(w, r, err)
		return
	}
	defer func() { _ = f.Close() }()
	// Metadata comes from the file actually opened, through the timeout machinery.
	fi, err := h.FileStat(ctx, f)
	if err != nil {
		s.fsError(w, r, err)
		return
	}
	if fi.IsDir() {
		writeError(w, http.StatusBadRequest, codeBadRequest, "path is a directory")
		return
	}
	base := path.Base(strings.ReplaceAll(rel, "\\", "/"))
	sv := classify(base)
	if sv.text && fi.Size() > s.cfg.MaxFileBytes && q.Get("force") != "1" {
		writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge,
			fmt.Sprintf("file is larger than %d bytes; use force=1 to load it anyway", s.cfg.MaxFileBytes))
		return
	}

	hdr.Set("Content-Type", sv.contentType)
	if sv.attachment {
		hdr.Set("Content-Disposition", contentDisposition(base))
	}
	hdr.Set("Cache-Control", "no-cache")
	mt := fi.ModTime()
	hdr.Set("ETag", fmt.Sprintf(`"%d-%d-%d"`, mt.UnixNano(), fi.Size(), inode(fi)))

	// There is no server-wide WriteTimeout (SSE), so the body is copied under
	// a per-chunk deadline. The server flushes the buffered tail under the
	// last one and clears it before reusing the connection.
	dw := &chunkWriter{ResponseWriter: w, rc: http.NewResponseController(w), timeout: s.writeTimeout}
	rec := &errRecorder{ReadSeeker: h.Reader(ctx, f, fi.Size())}
	http.ServeContent(dw, r, "", mt, rec)
	if rec.err != nil {
		level := slog.LevelWarn
		if ctx.Err() != nil {
			level = slog.LevelDebug // client went away
		}
		s.logger.Log(ctx, level, "file read aborted", "root", q.Get("root"), "path", rel, "err", rec.err)
	}
}
