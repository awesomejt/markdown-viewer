package fsroot

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

// dirIdentityNoFollow returns the identity of the directory at the absolute,
// clean path p, walking it one component at a time with O_NOFOLLOW so that a
// symlink anywhere in p fails the walk instead of being followed (reported as
// errRootMoved). O_PATH needs only search permission on the parents, like a
// normal lookup. Mount points are crossed normally.
func dirIdentityNoFollow(p string) (fileID, error) {
	const flags = unix.O_PATH | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
	fd, err := unix.Open("/", flags, 0)
	if err != nil {
		return fileID{}, &os.PathError{Op: "open", Path: "/", Err: err}
	}
	for _, part := range strings.Split(strings.TrimPrefix(p, "/"), "/") {
		if part == "" {
			continue
		}
		next, oerr := unix.Openat(fd, part, flags, 0)
		_ = unix.Close(fd)
		if errors.Is(oerr, unix.ELOOP) || errors.Is(oerr, unix.ENOTDIR) {
			return fileID{}, fmt.Errorf("%w: %s", errRootMoved, part)
		}
		if oerr != nil {
			return fileID{}, &os.PathError{Op: "openat", Path: p, Err: oerr}
		}
		fd = next
	}
	defer func() { _ = unix.Close(fd) }()
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return fileID{}, &os.PathError{Op: "fstat", Path: p, Err: err}
	}
	return fileID{dev: uint64(st.Dev), ino: st.Ino}, nil //nolint:unconvert // Dev is uint32 on some arches
}
