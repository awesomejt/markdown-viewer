package main

import (
	"strings"
	"testing"
)

func TestParseProfile(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		wantLen int
	}{
		{
			name: "simple profile",
			input: `mode: set
github.com/awesomejt/markdown-viewer/internal/foo/bar.go:1.1,1.10 1 1
github.com/awesomejt/markdown-viewer/internal/foo/bar.go:2.1,2.10 1 0`,
			wantErr: false,
			wantLen: 2,
		},
		{
			name:    "empty profile",
			input:   "mode: set\n",
			wantErr: false,
			wantLen: 0,
		},
		{
			name: "malformed line",
			input: `mode: set
invalid line with wrong format`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			blocks, err := parseProfile(strings.NewReader(tt.input))
			if (err != nil) != tt.wantErr {
				t.Errorf("parseProfile() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(blocks) != tt.wantLen {
				t.Errorf("parseProfile() got %d blocks, want %d", len(blocks), tt.wantLen)
			}
		})
	}
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantDefault float64
		wantPackage map[string]float64
		wantExclude []string
	}{
		{
			name: "full config",
			input: `default: 80
packages:
  - github.com/awesomejt/markdown-viewer/internal/fsroot: 90
exclude:
  - github.com/awesomejt/markdown-viewer/cmd/spike-d2
  - github.com/awesomejt/markdown-viewer/tools/covercheck`,
			wantDefault: 80,
			wantPackage: map[string]float64{
				"github.com/awesomejt/markdown-viewer/internal/fsroot": 90,
			},
			wantExclude: []string{
				"github.com/awesomejt/markdown-viewer/cmd/spike-d2",
				"github.com/awesomejt/markdown-viewer/tools/covercheck",
			},
		},
		{
			name: "minimal config",
			input: `default: 80`,
			wantDefault: 80,
			wantPackage: map[string]float64{},
			wantExclude: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadConfig(strings.NewReader(tt.input))
			if err != nil {
				t.Errorf("loadConfig() error = %v", err)
				return
			}
			if cfg.Default != tt.wantDefault {
				t.Errorf("loadConfig() Default = %v, want %v", cfg.Default, tt.wantDefault)
			}
			if len(cfg.Packages) != len(tt.wantPackage) {
				t.Errorf("loadConfig() Packages len = %d, want %d", len(cfg.Packages), len(tt.wantPackage))
			}
			for pkg, val := range tt.wantPackage {
				if cfg.Packages[pkg] != val {
					t.Errorf("loadConfig() Packages[%s] = %v, want %v", pkg, cfg.Packages[pkg], val)
				}
			}
			if len(cfg.Exclude) != len(tt.wantExclude) {
				t.Errorf("loadConfig() Exclude len = %d, want %d", len(cfg.Exclude), len(tt.wantExclude))
			}
		})
	}
}

func TestEvaluate(t *testing.T) {
	tests := []struct {
		name      string
		blocks    []CoverageBlock
		config    *CoverageConfig
		wantPass  map[string]bool
		wantCount int
	}{
		{
			name: "single package pass",
			blocks: []CoverageBlock{
				{File: "pkg/foo.go", NumStmt: 10, Count: 8},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{},
			},
			wantPass:  map[string]bool{"pkg": true},
			wantCount: 1,
		},
		{
			name: "single package fail",
			blocks: []CoverageBlock{
				{File: "pkg/foo.go", NumStmt: 10, Count: 7},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{},
			},
			wantPass:  map[string]bool{"pkg": false},
			wantCount: 1,
		},
		{
			name: "zero statement package skipped",
			blocks: []CoverageBlock{
				{File: "pkg/foo.go", NumStmt: 0, Count: 0},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{},
			},
			wantPass:  map[string]bool{},
			wantCount: 0,
		},
		{
			name: "excluded package skipped",
			blocks: []CoverageBlock{
				{File: "excluded/foo.go", NumStmt: 10, Count: 5},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{"excluded"},
			},
			wantPass:  map[string]bool{},
			wantCount: 0,
		},
		{
			name: "per-package threshold",
			blocks: []CoverageBlock{
				{File: "pkg/foo.go", NumStmt: 10, Count: 9},
			},
			config: &CoverageConfig{
				Default: 80,
				Packages: map[string]float64{
					"pkg": 90,
				},
				Exclude: []string{},
			},
			wantPass:  map[string]bool{"pkg": true},
			wantCount: 1,
		},
		{
			name: "duplicate blocks count once",
			blocks: []CoverageBlock{
				{File: "pkg/foo.go", NumStmt: 10, Count: 5},
				{File: "pkg/foo.go", NumStmt: 10, Count: 5},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{},
			},
			wantPass:  map[string]bool{"pkg": false},
			wantCount: 1,
		},
		{
			name: "multiple packages",
			blocks: []CoverageBlock{
				{File: "pkg1/foo.go", NumStmt: 10, Count: 9},
				{File: "pkg2/bar.go", NumStmt: 10, Count: 7},
			},
			config: &CoverageConfig{
				Default:  80,
				Packages: map[string]float64{},
				Exclude:  []string{},
			},
			wantPass:  map[string]bool{"pkg1": true, "pkg2": false},
			wantCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results := evaluate(tt.blocks, tt.config)
			if len(results) != tt.wantCount {
				t.Errorf("evaluate() got %d results, want %d", len(results), tt.wantCount)
			}
			for _, result := range results {
				wantPass, ok := tt.wantPass[result.Package]
				if !ok {
					t.Errorf("evaluate() unexpected package %s", result.Package)
					continue
				}
				if result.Pass != wantPass {
					t.Errorf("evaluate() %s Pass = %v, want %v", result.Package, result.Pass, wantPass)
				}
			}
		})
	}
}
