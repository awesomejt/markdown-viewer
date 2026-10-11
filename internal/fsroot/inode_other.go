//go:build !unix

package fsroot

import "io/fs"

// Inode returns 0 on platforms without inode numbers.
func Inode(fs.FileInfo) uint64 { return 0 }
