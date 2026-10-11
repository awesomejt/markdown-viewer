package fsroot

import (
	"context"
	"errors"
	"io"
)

// readChunk is the size of each underlying ReadAt. Reads are served from a
// prefetched chunk so one slot acquisition covers many small Reads. The chunk
// buffer is allocated per fetch because an abandoned ReadAt keeps writing into
// it after the caller has moved on.
const readChunk = 64 << 10

// Reader returns an [io.ReadSeeker] over r, a file of the given size obtained
// from [Handle.Open]. Each Read performs a ReadAt under the handle's timeout
// and in-flight cap: a timeout marks the root unavailable, returns a
// [KindTimeout] *PathError, and the slot stays held until the ReadAt actually
// returns. Seek only tracks an offset against size and does no I/O.
//
// The reader never closes r; the caller does, which is safe while a ReadAt is
// still outstanding. The reader is not safe for concurrent use.
func (h *Handle) Reader(ctx context.Context, r io.ReaderAt, size int64) io.ReadSeeker {
	return &timedReader{ctx: ctx, h: h, r: r, size: size}
}

type timedReader struct {
	ctx  context.Context
	h    *Handle
	r    io.ReaderAt
	size int64
	off  int64

	buf    []byte // prefetched data starting at bufOff
	bufOff int64
}

type chunk struct {
	buf []byte
	eof bool
}

func (t *timedReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if t.off >= t.size {
		return 0, io.EOF
	}
	if t.off < t.bufOff || t.off >= t.bufOff+int64(len(t.buf)) {
		if err := t.fetch(); err != nil {
			return 0, err
		}
		if len(t.buf) == 0 {
			return 0, io.EOF
		}
	}
	n := copy(p, t.buf[t.off-t.bufOff:])
	t.off += int64(n)
	return n, nil
}

// fetch loads the chunk at the current offset through the timeout machinery.
func (t *timedReader) fetch() error {
	n := min(int64(readChunk), t.size-t.off)
	off := t.off
	c, err := run(t.ctx, t.h, "read", "", func() (chunk, error) {
		buf := make([]byte, n)
		got, rerr := t.r.ReadAt(buf, off)
		if rerr != nil && !errors.Is(rerr, io.EOF) {
			return chunk{}, &PathError{Kind: KindInternal, Op: "read", Err: rerr}
		}
		return chunk{buf: buf[:got], eof: rerr != nil}, nil
	}, nil)
	if err != nil {
		return err
	}
	t.buf, t.bufOff = c.buf, off
	return nil
}

func (t *timedReader) Seek(offset int64, whence int) (int64, error) {
	var base int64
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = t.off
	case io.SeekEnd:
		base = t.size
	default:
		return 0, errors.New("fsroot: invalid seek whence")
	}
	if base+offset < 0 {
		return 0, errors.New("fsroot: negative seek position")
	}
	t.off = base + offset
	return t.off, nil
}
