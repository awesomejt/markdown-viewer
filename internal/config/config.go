package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// WatchMode selects how a root is watched for changes.
type WatchMode string

const (
	// WatchPoll polls mtimes at MDV_POLL_INTERVAL (default).
	WatchPoll WatchMode = "poll"
	// WatchFSNotify uses filesystem notifications.
	WatchFSNotify WatchMode = "fsnotify"
)

// Root is a named directory tree served by the viewer.
type Root struct {
	Name  string
	Path  string
	Watch WatchMode
}

// Config holds all runtime settings.
type Config struct {
	Listen         string
	Roots          []Root
	PollInterval   time.Duration
	FSTimeout      time.Duration
	FSMaxInflight  int
	MaxListEntries int
	MaxFileBytes   int64
	D2Timeout      time.Duration
	D2Concurrency  int
	D2CacheEntries int
	LogLevel       slog.Level
	// AllowedHosts lists extra Host header hostnames accepted besides IP
	// literals and localhost (DNS rebinding guard). Normalized to lowercase
	// without a trailing dot. The single entry "*" disables the check.
	AllowedHosts []string
}

// AllowAnyHost is the MDV_ALLOWED_HOSTS value that disables the Host check.
const AllowAnyHost = "*"

var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// hostLabelRE matches one lowercase DNS label (underscores tolerated for
// container hostnames).
var hostLabelRE = regexp.MustCompile(`^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$`)

// FromEnv loads configuration from the process environment.
func FromEnv() (*Config, error) {
	return Load(os.Getenv)
}

// Load parses and validates configuration using getenv. Empty values are
// treated as unset. All validation errors are reported together.
func Load(getenv func(string) string) (*Config, error) {
	c := &Config{
		Listen:         ":8080",
		PollInterval:   3 * time.Second,
		FSTimeout:      5 * time.Second,
		FSMaxInflight:  4,
		MaxListEntries: 20000,
		MaxFileBytes:   5242880,
		D2Timeout:      10 * time.Second,
		D2Concurrency:  2,
		D2CacheEntries: 256,
		LogLevel:       slog.LevelInfo,
	}
	var errs []error
	add := func(err error) {
		if err != nil {
			errs = append(errs, err)
		}
	}
	get := func(k string) string { return strings.TrimSpace(getenv(k)) }

	if v := get("MDV_LISTEN"); v != "" {
		c.Listen = v
	}
	add(parseDuration(get, "MDV_POLL_INTERVAL", &c.PollInterval))
	add(parseDuration(get, "MDV_FS_TIMEOUT", &c.FSTimeout))
	add(parseDuration(get, "MDV_D2_TIMEOUT", &c.D2Timeout))
	add(parseInt(get, "MDV_FS_MAX_INFLIGHT", &c.FSMaxInflight))
	add(parseInt(get, "MDV_MAX_LIST_ENTRIES", &c.MaxListEntries))
	add(parseInt(get, "MDV_D2_CONCURRENCY", &c.D2Concurrency))
	add(parseInt(get, "MDV_D2_CACHE_ENTRIES", &c.D2CacheEntries))

	if v := get("MDV_MAX_FILE_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		switch {
		case err != nil:
			add(fmt.Errorf("MDV_MAX_FILE_BYTES: invalid integer %q", v))
		case n <= 0:
			add(fmt.Errorf("MDV_MAX_FILE_BYTES: must be > 0, got %d", n))
		default:
			c.MaxFileBytes = n
		}
	}

	if v := get("MDV_LOG_LEVEL"); v != "" {
		switch strings.ToLower(v) {
		case "debug":
			c.LogLevel = slog.LevelDebug
		case "info":
			c.LogLevel = slog.LevelInfo
		case "warn":
			c.LogLevel = slog.LevelWarn
		case "error":
			c.LogLevel = slog.LevelError
		default:
			add(fmt.Errorf("MDV_LOG_LEVEL: invalid level %q (want debug, info, warn, error)", v))
		}
	}

	hosts, err := parseAllowedHosts(get("MDV_ALLOWED_HOSTS"))
	add(err)
	c.AllowedHosts = hosts

	roots, err := parseRoots(get("MDV_ROOTS"))
	add(err)
	c.Roots = roots

	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return c, nil
}

func parseDuration(get func(string) string, key string, dst *time.Duration) error {
	v := get(key)
	if v == "" {
		return nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fmt.Errorf("%s: invalid duration %q", key, v)
	}
	if d <= 0 {
		return fmt.Errorf("%s: must be > 0, got %s", key, v)
	}
	*dst = d
	return nil
}

func parseInt(get func(string) string, key string, dst *int) error {
	v := get(key)
	if v == "" {
		return nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fmt.Errorf("%s: invalid integer %q", key, v)
	}
	if n <= 0 {
		return fmt.Errorf("%s: must be > 0, got %d", key, n)
	}
	*dst = n
	return nil
}

func parseAllowedHosts(raw string) ([]string, error) {
	var errs []error
	var hosts []string
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(entry)), ".")
		if entry == "" {
			continue
		}
		if entry == AllowAnyHost {
			hosts = append(hosts, entry)
			continue
		}
		if _, err := netip.ParseAddr(strings.Trim(entry, "[]")); err == nil {
			errs = append(errs, fmt.Errorf("MDV_ALLOWED_HOSTS: IP literals are always allowed; remove %q", entry))
			continue
		}
		if !validHostname(entry) {
			errs = append(errs, fmt.Errorf("MDV_ALLOWED_HOSTS: invalid hostname %q (no scheme, port, path, or whitespace)", entry))
			continue
		}
		hosts = append(hosts, entry)
	}
	if len(hosts) > 1 && slices.Contains(hosts, AllowAnyHost) {
		errs = append(errs, fmt.Errorf("MDV_ALLOWED_HOSTS: %q must be the only entry", AllowAnyHost))
	}
	return hosts, errors.Join(errs...)
}

func validHostname(h string) bool {
	if len(h) > 253 {
		return false
	}
	for _, label := range strings.Split(h, ".") {
		if !hostLabelRE.MatchString(label) {
			return false
		}
	}
	return true
}

func parseRoots(raw string) ([]Root, error) {
	if raw == "" {
		return nil, errors.New("MDV_ROOTS: required")
	}
	var errs []error
	var roots []Root
	seen := map[string]bool{}
	for i, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			errs = append(errs, fmt.Errorf("MDV_ROOTS: entry %d is empty", i+1))
			continue
		}
		name, rest, ok := strings.Cut(entry, "=")
		name = strings.TrimSpace(name)
		rest = strings.TrimSpace(rest)
		if !ok {
			errs = append(errs, fmt.Errorf("MDV_ROOTS: entry %q missing '='", entry))
			continue
		}
		bad := false
		fail := func(format string, a ...any) {
			bad = true
			errs = append(errs, fmt.Errorf("MDV_ROOTS: "+format, a...))
		}
		if !nameRE.MatchString(name) {
			fail("invalid root name %q (must match %s)", name, nameRE)
		} else if seen[name] {
			fail("duplicate root name %q", name)
		}
		seen[name] = true

		path, mode := rest, WatchPoll
		if idx := strings.LastIndex(rest, ":"); idx >= 0 {
			switch m := WatchMode(rest[idx+1:]); m {
			case WatchPoll, WatchFSNotify:
				path, mode = rest[:idx], m
			}
		}
		switch {
		case !filepath.IsAbs(path):
			fail("root %q: path %q must be absolute", name, path)
		default:
			path = filepath.Clean(path)
			if st, err := os.Stat(path); err != nil {
				fail("root %q: %v", name, err)
			} else if !st.IsDir() {
				fail("root %q: path %q is not a directory", name, path)
			}
		}
		if !bad {
			roots = append(roots, Root{Name: name, Path: path, Watch: mode})
		}
	}
	return roots, errors.Join(errs...)
}
