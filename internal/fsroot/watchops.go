package fsroot

import (
	"context"
	"io/fs"
	"path/filepath"
	"sort"
	"time"
)

// DirState is the cheap change-detection view of a directory: its own
// modification time and the sorted names of its direct children. Reading it
// costs one Stat and one ReadDir, never a per-child stat.
type DirState struct {
	Names   []string
	ModTime time.Time
}

// ReadNames returns the [DirState] of the directory at rel under the timeout
// machinery. Naming a path that exists but is not a directory is a
// KindBadRequest.
func (h *Handle) ReadNames(ctx context.Context, rel string) (*DirState, error) {
	return withRetry(rel, func(name string) (*DirState, error) {
		return run(ctx, h, "readnames", rel, func() (*DirState, error) { return h.readNames(rel, name) }, nil)
	})
}

func (h *Handle) readNames(rel, name string) (*DirState, error) {
	fi, err := h.fs.Stat(name)
	if err != nil {
		return nil, err
	}
	if !fi.IsDir() {
		return nil, &PathError{Kind: KindBadRequest, Op: "readnames", Path: rel, Reason: "not a directory"}
	}
	des, err := h.fs.ReadDir(name)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(des))
	for i, de := range des {
		names[i] = de.Name()
	}
	sort.Strings(names)
	return &DirState{Names: names, ModTime: fi.ModTime()}, nil
}

// HostPath validates rel through the guard (a Stat via [os.Root], so
// traversal and symlink escapes are rejected) and returns the matching host
// path together with the file info. It exists for the fsnotify watcher, which
// must hand a real path to the kernel; the result must never reach a client.
//
// The path is resolved lexically against the root's directory after the
// check, so a component swapped for an escaping symlink in between could
// redirect the watch. That leaks only the fact that something changed, never
// content. Handles built without a host directory (tests) fail with
// KindInternal.
func (h *Handle) HostPath(ctx context.Context, rel string) (string, fs.FileInfo, error) {
	fi, err := h.Stat(ctx, rel)
	if err != nil {
		return "", nil, err
	}
	if h.hostDir == "" {
		return "", nil, &PathError{Kind: KindInternal, Op: "hostpath", Path: rel, Reason: "root has no host directory"}
	}
	name, err := Resolve(rel)
	if err != nil {
		return "", nil, err
	}
	return filepath.Join(h.hostDir, filepath.FromSlash(name)), fi, nil
}
