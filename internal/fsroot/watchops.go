package fsroot

import (
	"context"
	"io/fs"
	"path"
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
//
// The host path uses the form the stat succeeded with: for a name stored in
// the other NFC/NFD form than requested, that is the on-disk name, which the
// kernel watch and its event names need.
func (h *Handle) HostPath(ctx context.Context, rel string) (string, fs.FileInfo, error) {
	type found struct {
		name string
		fi   fs.FileInfo
	}
	f, err := withRetry(rel, func(name string) (found, error) {
		fi, err := run(ctx, h, "stat", rel, func() (fs.FileInfo, error) { return h.fs.Stat(name) }, nil)
		return found{name, fi}, err
	})
	if err != nil {
		return "", nil, err
	}
	if h.hostDir == "" {
		return "", nil, &PathError{Kind: KindInternal, Op: "hostpath", Path: rel, Reason: "root has no host directory"}
	}
	return filepath.Join(h.hostDir, filepath.FromSlash(f.name)), f.fi, nil
}

// HostPathMissing is [Handle.HostPath] for a path that does not exist yet. It
// validates the parent through the guard (it must exist and be a directory,
// else KindNotFound) and returns the host path the child would have. The same
// restriction applies: the result must never reach a client. The root itself
// always exists, so rel "" is a KindBadRequest.
func (h *Handle) HostPathMissing(ctx context.Context, rel string) (string, error) {
	name, err := Resolve(rel)
	if err != nil {
		return "", err
	}
	if name == "." {
		return "", &PathError{Kind: KindBadRequest, Op: "hostpath", Path: rel, Reason: "the root always exists"}
	}
	parent := path.Dir(name)
	if parent == "." {
		parent = ""
	}
	host, fi, err := h.HostPath(ctx, parent)
	if err != nil {
		return "", err
	}
	if !fi.IsDir() {
		return "", &PathError{Kind: KindNotFound, Op: "hostpath", Path: rel}
	}
	return filepath.Join(host, path.Base(name)), nil
}
