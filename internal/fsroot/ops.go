package fsroot

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path"
	"sort"
	"strings"
	"syscall"
	"time"

	"golang.org/x/text/unicode/norm"
)

// Entry is one directory listing item.
type Entry struct {
	Name    string
	Type    string // "dir" or "file"
	Kind    FileKind
	Size    int64 // 0 for directories
	ModTime time.Time
}

// Listing is the result of [Handle.List].
type Listing struct {
	Path      string // resolved root-relative path; "." is the root itself
	Entries   []Entry
	Truncated bool
}

// altForm returns the other Unicode normalization form of name (NFC if name is
// not NFC, else NFD), or "" if both forms equal name.
func altForm(name string) string {
	if c := norm.NFC.String(name); c != name {
		return c
	}
	if d := norm.NFD.String(name); d != name {
		return d
	}
	return ""
}

// withRetry resolves rel, runs fn, and on KindNotFound retries once with the
// alternate NFC/NFD form of the path (macOS and some network shares store
// names decomposed). fn receives the resolved name.
func withRetry[T any](rel string, fn func(name string) (T, error)) (T, error) {
	var zero T
	name, err := Resolve(rel)
	if err != nil {
		return zero, err
	}
	v, err := fn(name)
	if err == nil || KindOf(err) != KindNotFound {
		return v, err
	}
	alt := altForm(name)
	if alt == "" {
		return zero, err
	}
	v2, err2 := fn(alt)
	if err2 == nil {
		return v2, nil
	}
	if KindOf(err2) == KindTimeout {
		return zero, err2
	}
	return zero, err
}

// Stat returns file info for rel under the timeout machinery. See [Root.Stat].
func (h *Handle) Stat(ctx context.Context, rel string) (fs.FileInfo, error) {
	return withRetry(rel, func(name string) (fs.FileInfo, error) {
		return run(ctx, h, "stat", rel, func() (fs.FileInfo, error) { return h.fs.Stat(name) }, nil)
	})
}

// Open opens rel under the timeout machinery. See [Root.Open]. The caller owns
// and must close the file. If the call times out and the file is opened later,
// it is closed here. Reads on the returned file are not covered by the timeout;
// wrap it with [Handle.Reader] for that.
func (h *Handle) Open(ctx context.Context, rel string) (*os.File, error) {
	return withRetry(rel, func(name string) (*os.File, error) {
		return run(ctx, h, "open", rel, func() (*os.File, error) { return h.fs.Open(name) },
			func(f *os.File) {
				if f != nil {
					_ = f.Close()
				}
			})
	})
}

// FileStat stats an open file under the timeout machinery, so a mount that
// died after Open cannot hang the caller. The size and mode come from the file
// actually opened, not from a separate path lookup.
func (h *Handle) FileStat(ctx context.Context, f *os.File) (fs.FileInfo, error) {
	return run(ctx, h, "fstat", "", f.Stat, nil)
}

// List lists the directory at rel. The whole listing, including the stats that
// resolve symlinks, runs as one operation under the timeout and slot.
//
// Entries are sorted directories first, then by case-insensitive name (raw
// name breaks ties) and capped at the handle's max entries; Truncated reports
// more existed. Dot-files are included. Symlinks are reported as their target
// type; those that escape the root, dangle, or loop are omitted, as are
// non-regular, non-directory entries (FIFO, socket, device).
//
// Listing a path that exists but is not a directory is a KindBadRequest.
func (h *Handle) List(ctx context.Context, rel string) (*Listing, error) {
	var resolved string
	l, err := withRetry(rel, func(name string) (*Listing, error) {
		if resolved == "" {
			resolved = name
		}
		return run(ctx, h, "list", rel, func() (*Listing, error) { return h.list(rel, name) }, nil)
	})
	if err != nil {
		return nil, err
	}
	l.Path = resolved
	return l, nil
}

func (h *Handle) list(rel, name string) (*Listing, error) {
	des, err := h.fs.ReadDir(name)
	if err != nil {
		if KindOf(err) == KindNotFound && errors.Is(err, syscall.ENOTDIR) {
			if fi, serr := h.fs.Stat(name); serr == nil && !fi.IsDir() {
				return nil, &PathError{Kind: KindBadRequest, Op: "list", Path: rel, Reason: "not a directory"}
			}
		}
		return nil, err
	}
	entries := make([]Entry, 0, len(des))
	for _, de := range des {
		e, ok := h.entry(name, de)
		if ok {
			entries = append(entries, e)
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if (a.Type == "dir") != (b.Type == "dir") {
			return a.Type == "dir"
		}
		la, lb := strings.ToLower(a.Name), strings.ToLower(b.Name)
		if la != lb {
			return la < lb
		}
		return a.Name < b.Name
	})
	l := &Listing{Path: name, Entries: entries}
	if h.maxEntries > 0 && len(entries) > h.maxEntries {
		l.Entries = entries[:h.maxEntries]
		l.Truncated = true
	}
	return l, nil
}

// entry converts a directory entry, resolving symlinks through the root.
func (h *Handle) entry(dir string, de fs.DirEntry) (Entry, bool) {
	var fi fs.FileInfo
	var err error
	if de.Type()&fs.ModeSymlink != 0 {
		fi, err = h.fs.Stat(path.Join(dir, de.Name()))
	} else {
		fi, err = de.Info()
	}
	if err != nil {
		return Entry{}, false
	}
	e := Entry{Name: de.Name(), ModTime: fi.ModTime()}
	switch {
	case fi.IsDir():
		e.Type = "dir"
		e.Kind = FileKindOther
	case fi.Mode().IsRegular():
		e.Type = "file"
		e.Kind = ClassifyName(e.Name)
		e.Size = fi.Size()
	default:
		return Entry{}, false
	}
	return e, true
}
