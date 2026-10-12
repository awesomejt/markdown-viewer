//go:build !linux

package fsroot

import (
	"os"
)

// dirIdentityNoFollow returns the identity of the directory at p. Off Linux it
// only refuses a symlink in the last component (lstat); the server targets
// Linux, where every component is checked.
func dirIdentityNoFollow(p string) (fileID, error) {
	fi, err := os.Lstat(p)
	if err != nil {
		return fileID{}, err
	}
	id, ok := fileIdentity(fi)
	if !fi.IsDir() || !ok {
		return fileID{}, errRootMoved
	}
	return id, nil
}
