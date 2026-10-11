// Package fsroot provides root registry, path guard, listing, and file reads with timeouts.
//
// The path guard (guard.go) is the only place client-supplied paths are turned
// into filesystem access. Every access goes through an [os.Root], so symlinks
// that leave the root are refused by the kernel-assisted os.Root checks, and a
// lexical precheck ([Resolve]) rejects hostile input before any syscall.
//
// On top of the guard, [Handle] (access.go, ops.go) adds context-aware Stat,
// Open and List: each fs call runs in a goroutine under MDV_FS_TIMEOUT with a
// bounded per-root in-flight cap (waiters share the timeout budget), a root that times out is marked
// unavailable and probed with one stat at a time, and a not-found path is
// retried once in its alternate NFC/NFD form. [Registry] holds one Handle per
// configured root. [ClassifyName] maps file names to the kinds used by
// /api/list and the file allowlist.
package fsroot
