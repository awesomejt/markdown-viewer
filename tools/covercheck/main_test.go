package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseProfile(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []CoverageBlock
		wantErr string
	}{
		{
			name:  "simple profile",
			input: "mode: set\nm/a/x.go:1.1,2.2 3 1\nm/a/x.go:3.1,4.2 1 0\n\n",
			want: []CoverageBlock{
				{File: "m/a/x.go", Range: "1.1,2.2", NumStmt: 3, Count: 1},
				{File: "m/a/x.go", Range: "3.1,4.2", NumStmt: 1, Count: 0},
			},
		},
		{name: "empty profile", input: "mode: set\n"},
		{name: "wrong field count", input: "mode: set\nbogus line", wantErr: "expected 3 fields"},
		{name: "no colon", input: "x.go 1 1", wantErr: "bad file:range"},
		{name: "empty range", input: "x.go: 1 1", wantErr: "bad file:range"},
		{name: "bad stmt", input: "x.go:1.1,2.2 a 1", wantErr: "bad statement count"},
		{name: "bad count", input: "x.go:1.1,2.2 1 b", wantErr: "bad hit count"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseProfile(strings.NewReader(tt.input))
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("boom") }

func TestReaderErrors(t *testing.T) {
	if _, err := parseProfile(errReader{}); err == nil {
		t.Error("parseProfile: expected read error")
	}
	if _, err := loadConfig(errReader{}); err == nil {
		t.Error("loadConfig: expected read error")
	}
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    *CoverageConfig
		wantErr string
	}{
		{
			name: "full config",
			input: `# comment
default: 85
packages:
  m/internal/fsroot: 90
  m/internal/x: 87.5
exclude:
  - m/cmd/
  - m/other
`,
			want: &CoverageConfig{
				Default:  85,
				Packages: map[string]float64{"m/internal/fsroot": 90, "m/internal/x": 87.5},
				Exclude:  []string{"m/cmd/", "m/other"},
			},
		},
		{
			name:  "defaults",
			input: "",
			want:  &CoverageConfig{Default: 80, Packages: map[string]float64{}},
		},
		{name: "list-form packages rejected", input: "packages:\n  - m/a: 90\n", wantErr: "must be a mapping"},
		{name: "bad default", input: "default: lots\n", wantErr: "invalid default"},
		{name: "unknown key", input: "foo: 1\n", wantErr: "unknown key"},
		{name: "top-level no colon", input: "foo\n", wantErr: "expected key: value"},
		{name: "inline packages", input: "packages: x\n", wantErr: "must be a block"},
		{name: "package no colon", input: "packages:\n  m/a\n", wantErr: "import/path: percent"},
		{name: "package bad percent", input: "packages:\n  m/a: x\n", wantErr: "invalid percent"},
		{name: "exclude not list", input: "exclude:\n  m/a\n", wantErr: "list items"},
		{name: "stray indent", input: "default: 80\n  m/a: 1\n", wantErr: "unexpected indented"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := loadConfig(strings.NewReader(tt.input))
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestEvaluate(t *testing.T) {
	cfg := func(def float64, pk map[string]float64, ex ...string) *CoverageConfig {
		if pk == nil {
			pk = map[string]float64{}
		}
		return &CoverageConfig{Default: def, Packages: pk, Exclude: ex}
	}
	tests := []struct {
		name   string
		blocks []CoverageBlock
		cfg    *CoverageConfig
		want   []CoverageResult
	}{
		{
			name:   "pass at threshold",
			blocks: []CoverageBlock{{"pkg/a.go", "1.1,2.2", 8, 1}, {"pkg/a.go", "3.1,4.2", 2, 0}},
			cfg:    cfg(80, nil),
			want:   []CoverageResult{{"pkg", 80, 80, true}},
		},
		{
			name:   "fail below threshold",
			blocks: []CoverageBlock{{"pkg/a.go", "1.1,2.2", 7, 1}, {"pkg/a.go", "3.1,4.2", 3, 0}},
			cfg:    cfg(80, nil),
			want:   []CoverageResult{{"pkg", 70, 80, false}},
		},
		{
			name:   "zero-statement package skipped",
			blocks: []CoverageBlock{{"pkg/a.go", "1.1,2.2", 0, 0}},
			cfg:    cfg(80, nil),
		},
		{
			name:   "prefix exclude",
			blocks: []CoverageBlock{{"m/cmd/x/main.go", "1.1,2.2", 5, 0}, {"m/internal/a/a.go", "1.1,2.2", 5, 1}},
			cfg:    cfg(80, nil, "m/cmd/"),
			want:   []CoverageResult{{"m/internal/a", 100, 80, true}},
		},
		{
			name:   "per-package override",
			blocks: []CoverageBlock{{"pkg/a.go", "1.1,2.2", 9, 1}, {"pkg/a.go", "3.1,4.2", 1, 0}},
			cfg:    cfg(80, map[string]float64{"pkg": 95}),
			want:   []CoverageResult{{"pkg", 90, 95, false}},
		},
		{
			name: "duplicate blocks counted once, covered if any count > 0",
			blocks: []CoverageBlock{
				{"pkg/a.go", "1.1,2.2", 5, 0}, {"pkg/a.go", "1.1,2.2", 5, 3},
				{"pkg/a.go", "3.1,4.2", 5, 0}, {"pkg/a.go", "3.1,4.2", 5, 0},
			},
			cfg:  cfg(50, nil),
			want: []CoverageResult{{"pkg", 50, 50, true}},
		},
		{
			name:   "multiple packages sorted",
			blocks: []CoverageBlock{{"z/b.go", "1.1,2.2", 10, 1}, {"a/a.go", "1.1,2.2", 10, 0}},
			cfg:    cfg(80, nil),
			want:   []CoverageResult{{"a", 0, 80, false}, {"z", 100, 80, true}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluate(tt.blocks, tt.cfg)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRun(t *testing.T) {
	profile := "mode: set\nm/a/a.go:1.1,2.2 8 1\nm/a/a.go:3.1,4.2 2 0\nm/b/b.go:1.1,2.2 10 1\n"
	goodCfg := "default: 80\n"
	strictCfg := "default: 100\n"

	tests := []struct {
		name       string
		profile    string // empty => missing file
		config     string // empty => missing file
		extraArgs  []string
		wantCode   int
		wantOut    []string
		wantErrSub string
	}{
		{
			name: "pass", profile: profile, config: goodCfg, wantCode: 0,
			wantOut: []string{"PASS m/a 80.0% (min 80%)\n", "PASS m/b 100.0% (min 80%)\n"},
		},
		{
			name: "fail", profile: profile, config: strictCfg, wantCode: 1,
			wantOut: []string{"FAIL m/a 80.0% (min 100%)\n", "PASS m/b 100.0% (min 100%)\n"},
		},
		{name: "missing profile", config: goodCfg, wantCode: 1, wantErrSub: "Error opening profile"},
		{name: "bad profile", profile: "garbage", config: goodCfg, wantCode: 1, wantErrSub: "Error parsing profile"},
		{name: "missing config", profile: profile, wantCode: 1, wantErrSub: "Error opening config"},
		{name: "bad config", profile: profile, config: "packages:\n  - m/a: 90\n", wantCode: 1, wantErrSub: "Error parsing config"},
		{name: "bad flag", profile: profile, config: goodCfg, extraArgs: []string{"-nope"}, wantCode: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pp := filepath.Join(t.TempDir(), "missing.out")
			if tt.profile != "" {
				pp = writeFile(t, "go.out", tt.profile)
			}
			cp := filepath.Join(t.TempDir(), "missing.yaml")
			if tt.config != "" {
				cp = writeFile(t, "cov.yaml", tt.config)
			}
			args := append([]string{"-profile", pp, "-config", cp}, tt.extraArgs...)
			var out, errb bytes.Buffer
			if code := run(args, &out, &errb); code != tt.wantCode {
				t.Fatalf("exit = %d, want %d (stderr %q)", code, tt.wantCode, errb.String())
			}
			if want := strings.Join(tt.wantOut, ""); want != "" && out.String() != want {
				t.Errorf("stdout = %q, want %q", out.String(), want)
			}
			if !strings.Contains(errb.String(), tt.wantErrSub) {
				t.Errorf("stderr = %q, want containing %q", errb.String(), tt.wantErrSub)
			}
		})
	}
}

func TestRunFlagDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	if err := os.MkdirAll(filepath.Join(dir, "build", "coverage"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "build", "coverage", "go.out"), []byte("mode: set\nm/a/a.go:1.1,2.2 1 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".coverage.yaml"), []byte("default: 80\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errb bytes.Buffer
	if code := run(nil, &out, &errb); code != 0 {
		t.Fatalf("exit = %d, stderr %q", code, errb.String())
	}
	if want := "PASS m/a 100.0% (min 80%)\n"; out.String() != want {
		t.Errorf("stdout = %q, want %q", out.String(), want)
	}
}
