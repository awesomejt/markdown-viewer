//go:build unix

package api

import (
	"io/fs"
	"syscall"
)

// inode returns the file's inode number, or 0 when unavailable.
func inode(fi fs.FileInfo) uint64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino) //nolint:unconvert // width differs per platform
	}
	return 0
}
