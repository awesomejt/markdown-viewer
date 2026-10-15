package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	d := t.TempDir()
	c, err := Load(env(map[string]string{"MDV_ROOTS": "docs=" + d}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || c.PollInterval != 2*time.Second || c.FSTimeout != 5*time.Second ||
		c.FSMaxInflight != 4 || c.MaxListEntries != 20000 || c.MaxFileBytes != 5242880 ||
		c.D2Timeout != 10*time.Second || c.D2Concurrency != 2 || c.D2CacheEntries != 256 ||
		c.LogLevel != slog.LevelInfo {
		t.Errorf("unexpected defaults: %+v", c)
	}
	if len(c.Roots) != 1 || c.Roots[0] != (Root{"docs", d, WatchPoll}) {
		t.Errorf("roots: %+v", c.Roots)
	}
}

func TestOverrides(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	c, err := Load(env(map[string]string{
		"MDV_LISTEN":           "127.0.0.1:9000",
		"MDV_ROOTS":            " b=" + b + ":fsnotify , a=" + a,
		"MDV_POLL_INTERVAL":    "10s",
		"MDV_FS_TIMEOUT":       "1500ms",
		"MDV_FS_MAX_INFLIGHT":  "9",
		"MDV_MAX_LIST_ENTRIES": "123",
		"MDV_MAX_FILE_BYTES":   "99",
		"MDV_D2_TIMEOUT":       "20s",
		"MDV_D2_CONCURRENCY":   "7",
		"MDV_D2_CACHE_ENTRIES": "11",
		"MDV_LOG_LEVEL":        "DeBuG",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != "127.0.0.1:9000" || c.PollInterval != 10*time.Second || c.FSTimeout != 1500*time.Millisecond ||
		c.FSMaxInflight != 9 || c.MaxListEntries != 123 || c.MaxFileBytes != 99 ||
		c.D2Timeout != 20*time.Second || c.D2Concurrency != 7 || c.D2CacheEntries != 11 ||
		c.LogLevel != slog.LevelDebug {
		t.Errorf("unexpected: %+v", c)
	}
	if len(c.Roots) != 2 || c.Roots[0].Name != "b" || c.Roots[0].Watch != WatchFSNotify ||
		c.Roots[1].Name != "a" || c.Roots[1].Watch != WatchPoll {
		t.Errorf("roots: %+v", c.Roots)
	}
}

func TestLogLevels(t *testing.T) {
	d := t.TempDir()
	for s, want := range map[string]slog.Level{
		"debug": slog.LevelDebug, "info": slog.LevelInfo, "WARN": slog.LevelWarn, "Error": slog.LevelError,
	} {
		c, err := Load(env(map[string]string{"MDV_ROOTS": "x=" + d, "MDV_LOG_LEVEL": s}))
		if err != nil || c.LogLevel != want {
			t.Errorf("%s: %v %v", s, c, err)
		}
	}
}

func TestWatchSuffix(t *testing.T) {
	d := t.TempDir()
	colon := filepath.Join(d, "a:b")
	if err := os.Mkdir(colon, 0o750); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, val, path string
		mode            WatchMode
	}{
		{"poll", "x=" + d + ":poll", d, WatchPoll},
		{"fsnotify", "x=" + d + ":fsnotify", d, WatchFSNotify},
		{"none", "x=" + d, d, WatchPoll},
		{"colon path", "x=" + colon, colon, WatchPoll},
		{"colon path fsnotify", "x=" + colon + ":fsnotify", colon, WatchFSNotify},
		{"clean", "x=" + d + "/./", d, WatchPoll},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := Load(env(map[string]string{"MDV_ROOTS": tt.val}))
			if err != nil {
				t.Fatal(err)
			}
			if c.Roots[0].Path != tt.path || c.Roots[0].Watch != tt.mode {
				t.Errorf("got %+v", c.Roots[0])
			}
		})
	}
}

// A root path is only checked syntactically; whether it exists is fsroot's
// concern, so a root that is down at boot does not fail the configuration.
func TestMissingPathAccepted(t *testing.T) {
	p := filepath.Join(t.TempDir(), "nope")
	c, err := Load(env(map[string]string{"MDV_ROOTS": "x=" + p}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Roots[0].Path != p {
		t.Errorf("got %+v", c.Roots[0])
	}
}

func TestInvalid(t *testing.T) {
	d := t.TempDir()
	ok := "x=" + d
	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"missing roots", map[string]string{}, "MDV_ROOTS: required"},
		{"empty entry", map[string]string{"MDV_ROOTS": ok + ",,"}, "is empty"},
		{"no equals", map[string]string{"MDV_ROOTS": d}, "missing '='"},
		{"uppercase name", map[string]string{"MDV_ROOTS": "Abc=" + d}, "invalid root name"},
		{"leading dash", map[string]string{"MDV_ROOTS": "-a=" + d}, "invalid root name"},
		{"long name", map[string]string{"MDV_ROOTS": strings.Repeat("a", 33) + "=" + d}, "invalid root name"},
		{"empty name", map[string]string{"MDV_ROOTS": "=" + d}, "invalid root name"},
		{"relative", map[string]string{"MDV_ROOTS": "x=rel/path"}, "must be absolute"},
		{"duplicate", map[string]string{"MDV_ROOTS": ok + ",x=" + d}, "duplicate root name"},
		{"bad duration", map[string]string{"MDV_ROOTS": ok, "MDV_FS_TIMEOUT": "abc"}, "MDV_FS_TIMEOUT"},
		{"zero duration", map[string]string{"MDV_ROOTS": ok, "MDV_POLL_INTERVAL": "0s"}, "MDV_POLL_INTERVAL"},
		{"negative duration", map[string]string{"MDV_ROOTS": ok, "MDV_D2_TIMEOUT": "-1s"}, "MDV_D2_TIMEOUT"},
		{"bad int", map[string]string{"MDV_ROOTS": ok, "MDV_FS_MAX_INFLIGHT": "x"}, "MDV_FS_MAX_INFLIGHT"},
		{"zero int", map[string]string{"MDV_ROOTS": ok, "MDV_MAX_LIST_ENTRIES": "0"}, "MDV_MAX_LIST_ENTRIES"},
		{"negative int", map[string]string{"MDV_ROOTS": ok, "MDV_D2_CONCURRENCY": "-2"}, "MDV_D2_CONCURRENCY"},
		{"bad cache", map[string]string{"MDV_ROOTS": ok, "MDV_D2_CACHE_ENTRIES": "1.5"}, "MDV_D2_CACHE_ENTRIES"},
		{"bad bytes", map[string]string{"MDV_ROOTS": ok, "MDV_MAX_FILE_BYTES": "x"}, "MDV_MAX_FILE_BYTES"},
		{"negative bytes", map[string]string{"MDV_ROOTS": ok, "MDV_MAX_FILE_BYTES": "-5"}, "MDV_MAX_FILE_BYTES"},
		{"bad level", map[string]string{"MDV_ROOTS": ok, "MDV_LOG_LEVEL": "trace"}, "MDV_LOG_LEVEL"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := Load(env(tt.env))
			if err == nil || c != nil {
				t.Fatalf("expected error, got %+v", c)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error %q does not contain %q", err, tt.want)
			}
		})
	}
}

func TestMultipleErrors(t *testing.T) {
	_, err := Load(env(map[string]string{
		"MDV_ROOTS":            "BAD=/nonexistent-zzz",
		"MDV_FS_TIMEOUT":       "nope",
		"MDV_D2_CACHE_ENTRIES": "-1",
		"MDV_LOG_LEVEL":        "loud",
	}))
	if err == nil {
		t.Fatal("expected error")
	}
	for _, w := range []string{"MDV_ROOTS", "MDV_FS_TIMEOUT", "MDV_D2_CACHE_ENTRIES", "MDV_LOG_LEVEL"} {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("missing %s in %q", w, err)
		}
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv("MDV_ROOTS", "x="+t.TempDir())
	if _, err := FromEnv(); err != nil {
		t.Fatal(err)
	}
}

func TestAllowedHosts(t *testing.T) {
	d := t.TempDir()
	load := func(v string) (*Config, error) {
		return Load(env(map[string]string{"MDV_ROOTS": "docs=" + d, "MDV_ALLOWED_HOSTS": v}))
	}
	c, err := load(" NAS.lan. , ,mdv , a_b.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.AllowedHosts, "|"); got != "nas.lan|mdv|a_b.example.com" {
		t.Errorf("hosts: %q", got)
	}
	if c, err = load("*"); err != nil || len(c.AllowedHosts) != 1 || c.AllowedHosts[0] != AllowAnyHost {
		t.Errorf("wildcard: %v %+v", err, c)
	}
	if c, err = load(""); err != nil || len(c.AllowedHosts) != 0 {
		t.Errorf("empty: %v %+v", err, c)
	}
	long := strings.Repeat("a.", 130) + "com"
	for _, bad := range []string{
		"http://nas.lan", "nas.lan:8080", "nas.lan/path", "nas lan", "[::1]", "-a.lan",
		"a..b", "10.0.0.1", "[::1]", "nas.lan,*", "a.lan, evil host", long,
	} {
		_, err := load(bad)
		if err == nil || !strings.Contains(err.Error(), "MDV_ALLOWED_HOSTS") {
			t.Errorf("%q: want MDV_ALLOWED_HOSTS error, got %v", bad, err)
		}
	}
}

func TestPrefsConfig(t *testing.T) {
	d := t.TempDir()
	base := map[string]string{"MDV_ROOTS": "docs=" + d}
	with := func(v string) map[string]string {
		m := map[string]string{"MDV_PREFS": v}
		for k, x := range base {
			m[k] = x
		}
		return m
	}
	for _, v := range []string{"", "   "} {
		c, err := Load(env(with(v)))
		if err != nil || c.Prefs != "" {
			t.Errorf("%q: %+v err=%v", v, c, err)
		}
	}
	c, err := Load(env(with(" /config/preferences.yaml ")))
	if err != nil || c.Prefs != "/config/preferences.yaml" {
		t.Errorf("absolute: %+v %v", c, err)
	}
	if _, err := Load(env(with("config/preferences.yaml"))); err == nil || !strings.Contains(err.Error(), "MDV_PREFS") {
		t.Errorf("relative: err=%v", err)
	}
}
