package fsroot

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

// fakeReaderAt blocks until release is closed (when block is non-nil).
type fakeReaderAt struct {
	data  []byte
	block chan struct{}
	err   error
}

func (f *fakeReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if f.block != nil {
		<-f.block
	}
	if f.err != nil {
		return 0, f.err
	}
	if off >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func TestReaderReadsAndSeeks(t *testing.T) {
	data := bytes.Repeat([]byte("0123456789"), 20000) // > maxReadChunk
	h := newFakeHandle(&fakeFS{}, time.Second, 2)
	rs := h.Reader(context.Background(), &fakeReaderAt{data: data}, int64(len(data)))
	got, err := io.ReadAll(rs)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("readall: %d bytes, err %v", len(got), err)
	}
	if n, err := rs.Seek(-5, io.SeekEnd); err != nil || n != int64(len(data))-5 {
		t.Fatalf("seek end: %d %v", n, err)
	}
	if n, err := rs.Seek(2, io.SeekStart); err != nil || n != 2 {
		t.Fatalf("seek start: %d %v", n, err)
	}
	if n, err := rs.Seek(3, io.SeekCurrent); err != nil || n != 5 {
		t.Fatalf("seek cur: %d %v", n, err)
	}
	buf := make([]byte, 3)
	if _, err := io.ReadFull(rs, buf); err != nil || string(buf) != "567" {
		t.Fatalf("read after seek: %q %v", buf, err)
	}
	if _, err := rs.Seek(-1, io.SeekStart); err == nil {
		t.Fatal("negative seek accepted")
	}
	if _, err := rs.Seek(0, 99); err == nil {
		t.Fatal("bad whence accepted")
	}
	if n, err := rs.Read(nil); n != 0 || err != nil {
		t.Fatalf("empty read: %d %v", n, err)
	}
}

func TestReaderShortFileGivesEOF(t *testing.T) {
	h := newFakeHandle(&fakeFS{}, time.Second, 2)
	// Claimed size is larger than the real data (file shrank after stat).
	rs := h.Reader(context.Background(), &fakeReaderAt{data: []byte("abc")}, 10)
	got, err := io.ReadAll(rs)
	if err != nil || string(got) != "abc" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestReaderErrorIsInternal(t *testing.T) {
	h := newFakeHandle(&fakeFS{}, time.Second, 2)
	rs := h.Reader(context.Background(), &fakeReaderAt{err: errors.New("/host/secret boom")}, 10)
	_, err := rs.Read(make([]byte, 4))
	if KindOf(err) != KindInternal {
		t.Fatalf("kind %v err %v", KindOf(err), err)
	}
	var pe *PathError
	if !errors.As(err, &pe) || strings.Contains(pe.PublicMessage(), "secret") {
		t.Fatalf("public message leaks: %v", err)
	}
}

func TestReaderTimeoutMarksUnavailableAndHoldsSlot(t *testing.T) {
	f := &fakeReaderAt{data: []byte("hello"), block: make(chan struct{})}
	fs := &fakeFS{}
	h := newFakeHandle(fs, 30*time.Millisecond, 1)
	rs := h.Reader(context.Background(), f, 5)
	_, err := rs.Read(make([]byte, 5))
	wantTimeout(t, err)
	if h.unavailable.Load() == false {
		t.Fatal("root not marked unavailable")
	}
	// Slot is held while the ReadAt is still stuck: a probe cannot start.
	if h.tryAcquire() {
		t.Fatal("slot was released before ReadAt returned")
	}
	close(f.block)
	eventually(t, "slot released and root recovered", func() bool { return h.Available() })
}

func TestReaderCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h := newFakeHandle(&fakeFS{}, time.Second, 1)
	_, err := h.Reader(ctx, &fakeReaderAt{data: []byte("x")}, 1).Read(make([]byte, 1))
	wantTimeout(t, err)
	if h.unavailable.Load() {
		t.Fatal("cancel marked root unavailable")
	}
}

func TestNewRegistryFromHandles(t *testing.T) {
	h := newFakeHandle(&fakeFS{}, time.Second, 1)
	reg := NewRegistryFromHandles(h)
	if got, err := reg.Get("fake"); err != nil || got != h {
		t.Fatalf("get: %v %v", got, err)
	}
	if infos := reg.Roots(); len(infos) != 1 || infos[0].Name != "fake" {
		t.Fatalf("roots %+v", infos)
	}
}
