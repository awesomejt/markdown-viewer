// Command covercheck enforces per-package statement coverage thresholds
// against a Go coverage profile.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executes covercheck and returns the process exit code.
func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("covercheck", flag.ContinueOnError)
	fs.SetOutput(stderr)
	profilePath := fs.String("profile", "build/coverage/go.out", "path to Go coverage profile")
	configPath := fs.String("config", ".coverage.yaml", "path to coverage config file")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	profileFile, err := os.Open(*profilePath)
	if err != nil {
		fmt.Fprintf(stderr, "Error opening profile: %v\n", err)
		return 1
	}
	defer profileFile.Close()

	blocks, err := parseProfile(profileFile)
	if err != nil {
		fmt.Fprintf(stderr, "Error parsing profile: %v\n", err)
		return 1
	}

	configFile, err := os.Open(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "Error opening config: %v\n", err)
		return 1
	}
	defer configFile.Close()

	cfg, err := loadConfig(configFile)
	if err != nil {
		fmt.Fprintf(stderr, "Error parsing config: %v\n", err)
		return 1
	}

	failed := false
	for _, r := range evaluate(blocks, cfg) {
		status := "PASS"
		if !r.Pass {
			status = "FAIL"
			failed = true
		}
		fmt.Fprintf(stdout, "%s %s %.1f%% (min %g%%)\n", status, r.Package, r.Coverage, r.MinCoverage)
	}
	if failed {
		return 1
	}
	return 0
}

// CoverageBlock is a single block in a Go coverage profile.
type CoverageBlock struct {
	File    string
	Range   string // "startLine.startCol,endLine.endCol"
	NumStmt int
	Count   int
}

// parseProfile parses a Go coverage profile.
func parseProfile(r io.Reader) ([]CoverageBlock, error) {
	var blocks []CoverageBlock
	sc := bufio.NewScanner(r)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "mode:") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 3 {
			return nil, fmt.Errorf("invalid line %d: expected 3 fields, got %d", lineNo, len(parts))
		}
		idx := strings.LastIndex(parts[0], ":")
		if idx <= 0 || idx == len(parts[0])-1 {
			return nil, fmt.Errorf("invalid line %d: bad file:range format", lineNo)
		}
		numStmt, err := strconv.Atoi(parts[1])
		if err != nil {
			return nil, fmt.Errorf("invalid line %d: bad statement count: %v", lineNo, err)
		}
		count, err := strconv.Atoi(parts[2])
		if err != nil {
			return nil, fmt.Errorf("invalid line %d: bad hit count: %v", lineNo, err)
		}
		blocks = append(blocks, CoverageBlock{
			File:    parts[0][:idx],
			Range:   parts[0][idx+1:],
			NumStmt: numStmt,
			Count:   count,
		})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return blocks, nil
}

// CoverageConfig is the parsed coverage configuration.
type CoverageConfig struct {
	Default  float64
	Packages map[string]float64
	Exclude  []string // import-path prefixes
}

// loadConfig parses the .coverage.yaml schema: a top-level `default`, a
// `packages` mapping of import path to minimum, and an `exclude` list of
// import-path prefixes.
func loadConfig(r io.Reader) (*CoverageConfig, error) {
	cfg := &CoverageConfig{Default: 80, Packages: map[string]float64{}}
	section := ""
	sc := bufio.NewScanner(r)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		raw := sc.Text()
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		indented := raw[0] == ' ' || raw[0] == '\t'
		if !indented {
			key, val, ok := strings.Cut(line, ":")
			if !ok {
				return nil, fmt.Errorf("line %d: expected key: value", lineNo)
			}
			val = strings.TrimSpace(val)
			switch key {
			case "default":
				f, err := strconv.ParseFloat(val, 64)
				if err != nil {
					return nil, fmt.Errorf("line %d: invalid default %q", lineNo, val)
				}
				cfg.Default = f
				section = ""
			case "packages", "exclude":
				if val != "" {
					return nil, fmt.Errorf("line %d: %s must be a block", lineNo, key)
				}
				section = key
			default:
				return nil, fmt.Errorf("line %d: unknown key %q", lineNo, key)
			}
			continue
		}
		switch section {
		case "packages":
			if strings.HasPrefix(line, "- ") {
				return nil, fmt.Errorf("line %d: packages must be a mapping of import path to percent, not a list", lineNo)
			}
			pkg, val, ok := strings.Cut(line, ":")
			if !ok {
				return nil, fmt.Errorf("line %d: expected `import/path: percent`", lineNo)
			}
			f, err := strconv.ParseFloat(strings.TrimSpace(val), 64)
			if err != nil {
				return nil, fmt.Errorf("line %d: invalid percent %q", lineNo, strings.TrimSpace(val))
			}
			cfg.Packages[strings.TrimSpace(pkg)] = f
		case "exclude":
			item, ok := strings.CutPrefix(line, "- ")
			if !ok {
				return nil, fmt.Errorf("line %d: exclude entries must be list items", lineNo)
			}
			cfg.Exclude = append(cfg.Exclude, strings.TrimSpace(item))
		default:
			return nil, fmt.Errorf("line %d: unexpected indented line", lineNo)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// CoverageResult is the evaluated coverage of one package.
type CoverageResult struct {
	Package     string
	Coverage    float64
	MinCoverage float64
	Pass        bool
}

// evaluate computes statement coverage per package and compares it with the
// configured thresholds. Blocks with identical file and range (as emitted when
// several test binaries are merged) are counted once, covered if any count > 0.
func evaluate(blocks []CoverageBlock, cfg *CoverageConfig) []CoverageResult {
	type key struct{ file, rng string }
	type stat struct {
		stmts   int
		covered bool
	}
	uniq := map[key]stat{}
	for _, b := range blocks {
		k := key{b.File, b.Range}
		s := uniq[k]
		s.stmts = b.NumStmt
		s.covered = s.covered || b.Count > 0
		uniq[k] = s
	}

	type pkgStat struct{ total, covered int }
	pkgs := map[string]*pkgStat{}
	for k, s := range uniq {
		p := path.Dir(k.file)
		ps := pkgs[p]
		if ps == nil {
			ps = &pkgStat{}
			pkgs[p] = ps
		}
		ps.total += s.stmts
		if s.covered {
			ps.covered += s.stmts
		}
	}

	var results []CoverageResult
	for pkg, ps := range pkgs {
		if ps.total == 0 || excluded(pkg, cfg.Exclude) {
			continue
		}
		min := cfg.Default
		if v, ok := cfg.Packages[pkg]; ok {
			min = v
		}
		cov := float64(ps.covered) / float64(ps.total) * 100
		results = append(results, CoverageResult{pkg, cov, min, cov >= min})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Package < results[j].Package })
	return results
}

func excluded(pkg string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(pkg, p) {
			return true
		}
	}
	return false
}
