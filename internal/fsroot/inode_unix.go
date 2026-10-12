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

// fileIdentity returns the device and inode numbers of fi, or false when
// unavailable.
func fileIdentity(fi fs.FileInfo) (fileID, bool) {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return fileID{dev: uint64(st.Dev), ino: uint64(st.Ino)}, true //nolint:unconvert,gosec // width and sign differ per platform
	}
	return fileID{}, false
}
