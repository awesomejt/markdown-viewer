//go:build unix

package fsroot

import (
	"io/fs"
	"syscall"
)

// Inode returns the file's inode number, or 0 when unavailable.
func Inode(fi fs.FileInfo) uint64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino) //nolint:unconvert // width differs per platform
	}
	return 0
}
