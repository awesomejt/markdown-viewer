//go:build !unix

package api

import "io/fs"

// inode returns 0 on platforms without inode numbers.
func inode(fs.FileInfo) uint64 { return 0 }
