//go:build unix

package api

import (
	"os"
	"syscall"
)

// openNonblock opens path read-only without blocking, so a FIFO or a stalled
// device cannot hang the open.
func openNonblock(path string) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(fd), path), nil
}
