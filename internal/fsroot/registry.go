package fsroot

import (
	"errors"

	"github.com/awesomejt/markdown-viewer/internal/config"
)

// RootInfo describes a root for /api/roots.
type RootInfo struct {
	Name      string
	Watch     config.WatchMode
	Available bool
}

// Registry holds one [Handle] per configured root, in config order.
type Registry struct {
	handles []*Handle
	byName  map[string]*Handle
}

// NewRegistry opens every configured root. On any failure the roots already
// opened are closed.
func NewRegistry(cfg *config.Config) (*Registry, error) {
	reg := &Registry{byName: make(map[string]*Handle, len(cfg.Roots))}
	for _, rc := range cfg.Roots {
		h, err := OpenHandle(rc, cfg)
		if err != nil {
			_ = reg.Close()
			return nil, err
		}
		reg.handles = append(reg.handles, h)
		reg.byName[rc.Name] = h
	}
	return reg, nil
}

// Get returns the handle for name, or a KindNotFound *PathError.
func (r *Registry) Get(name string) (*Handle, error) {
	if h, ok := r.byName[name]; ok {
		return h, nil
	}
	return nil, &PathError{Kind: KindNotFound, Op: "root", Path: name, Reason: "unknown root"}
}

// Roots lists the roots in config order. It may trigger recovery probes.
func (r *Registry) Roots() []RootInfo {
	out := make([]RootInfo, 0, len(r.handles))
	for _, h := range r.handles {
		out = append(out, RootInfo{Name: h.name, Watch: h.watch, Available: h.Available()})
	}
	return out
}

// Close closes every root and returns the joined errors.
func (r *Registry) Close() error {
	var errs []error
	for _, h := range r.handles {
		errs = append(errs, h.Close())
	}
	return errors.Join(errs...)
}

// NewRegistryFromHandles builds a Registry over existing handles, in the order
// given. It is for callers (and tests) that construct handles themselves.
func NewRegistryFromHandles(handles ...*Handle) *Registry {
	reg := &Registry{handles: handles, byName: make(map[string]*Handle, len(handles))}
	for _, h := range handles {
		reg.byName[h.name] = h
	}
	return reg
}
