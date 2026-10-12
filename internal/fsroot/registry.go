package fsroot

import (
	"errors"
	"sync"

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
	startup []RootError
}

// NewRegistry opens every configured root, concurrently so that several dead
// roots cost one MDV_FS_TIMEOUT rather than one each. A root that is
// unreachable at startup does not fail it: its handle starts unavailable and
// is listed by [Registry.StartupErrors]. A fatal error (a path that is not a
// directory) closes the roots already opened and is returned.
func NewRegistry(cfg *config.Config) (*Registry, error) {
	handles := make([]*Handle, len(cfg.Roots))
	errs := make([]error, len(cfg.Roots))
	var wg sync.WaitGroup
	for i, rc := range cfg.Roots {
		wg.Add(1)
		go func() {
			defer wg.Done()
			handles[i], errs[i] = OpenHandle(rc, cfg)
		}()
	}
	wg.Wait()
	reg := &Registry{byName: make(map[string]*Handle, len(cfg.Roots))}
	var fatal []error
	for i, h := range handles {
		if errs[i] != nil {
			fatal = append(fatal, errs[i])
			continue
		}
		reg.handles = append(reg.handles, h)
		reg.byName[h.name] = h
		if se := h.StartupErr(); se != nil {
			reg.startup = append(reg.startup, RootError{Name: h.name, Err: se})
		}
	}
	if len(fatal) > 0 {
		_ = reg.Close()
		return nil, errors.Join(fatal...)
	}
	return reg, nil
}

// RootError ties an error to the root it concerns.
type RootError struct {
	Name string
	Err  error
}

// StartupErrors lists, in config order, the roots that were unavailable when
// the registry was built and why. They are probed and may have recovered since.
func (r *Registry) StartupErrors() []RootError { return r.startup }

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
