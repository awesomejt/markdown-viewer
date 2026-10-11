// Package fsroot provides root registry, path guard, listing, and file reads with timeouts.
//
// The path guard (guard.go) is the only place client-supplied paths are turned
// into filesystem access. Every access goes through an [os.Root], so symlinks
// that leave the root are refused by the kernel-assisted os.Root checks, and a
// lexical precheck ([Resolve]) rejects hostile input before any syscall.
package fsroot
