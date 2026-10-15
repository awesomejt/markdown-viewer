//go:build !unix

package api

import "os"

// openNonblock opens path read-only; non-unix platforms have no O_NONBLOCK.
func openNonblock(path string) (*os.File, error) { return os.Open(path) }
