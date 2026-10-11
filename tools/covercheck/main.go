package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	profilePath := flag.String("profile", "build/coverage/go.out", "path to Go coverage profile")
	configPath := flag.String("config", ".coverage.yaml", "path to coverage config file")
	flag.Parse()

	// Read and parse the coverage profile
	profileFile, err := os.Open(*profilePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening profile: %v\n", err)
		os.Exit(1)
	}
	defer profileFile.Close()

	profile, err := parseProfile(profileFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing profile: %v\n", err)
		os.Exit(1)
	}

	// Read and parse the config
	configFile, err := os.Open(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening config: %v\n", err)
		os.Exit(1)
	}
	defer configFile.Close()

	config, err := loadConfig(configFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing config: %v\n", err)
		os.Exit(1)
	}

	// Evaluate coverage
	results := evaluate(profile, config)

	// Print results and determine exit code
	hasFailure := false
	for _, result := range results {
		status := "PASS"
		if !result.Pass {
			status = "FAIL"
			hasFailure = true
		}
		fmt.Printf("%s %s %.1f%% (min %.1f%%)\n", status, result.Package, result.Coverage, result.MinCoverage)
	}

	if hasFailure {
		os.Exit(1)
	}
}

// CoverageBlock represents a single block in the coverage profile
type CoverageBlock struct {
	File      string
	StartLine int
	StartCol  int
	EndLine   int
	EndCol    int
	NumStmt   int
	Count     int
}

// parseProfile reads and parses a Go coverage profile
func parseProfile(r io.Reader) ([]CoverageBlock, error) {
	var blocks []CoverageBlock
	scanner := &strings.Builder{}

	data := make([]byte, 4096)
	for {
		n, err := r.Read(data)
		if n > 0 {
			scanner.Write(data[:n])
		}
		if err != nil {
			if err != io.EOF {
				return nil, err
			}
			break
		}
	}

	lines := strings.Split(scanner.String(), "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "mode:") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) != 3 {
			if len(parts) > 0 {
				return nil, fmt.Errorf("invalid line %d: expected 3 fields, got %d", i+1, len(parts))
			}
			continue
		}

		// Parse range: file:startLine.startCol,endLine.endCol
		fileParts := strings.Split(parts[0], ":")
		if len(fileParts) != 2 {
			return nil, fmt.Errorf("invalid line %d: bad file:range format", i+1)
		}

		rangeParts := strings.Split(fileParts[1], ",")
		if len(rangeParts) != 2 {
			return nil, fmt.Errorf("invalid line %d: bad range format", i+1)
		}

		startParts := strings.Split(rangeParts[0], ".")
		endParts := strings.Split(rangeParts[1], ".")

		if len(startParts) != 2 || len(endParts) != 2 {
			return nil, fmt.Errorf("invalid line %d: bad position format", i+1)
		}

		var startLine, startCol, endLine, endCol, numStmt, count int
		if _, err := fmt.Sscanf(startParts[0], "%d", &startLine); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}
		if _, err := fmt.Sscanf(startParts[1], "%d", &startCol); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}
		if _, err := fmt.Sscanf(endParts[0], "%d", &endLine); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}
		if _, err := fmt.Sscanf(endParts[1], "%d", &endCol); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}
		if _, err := fmt.Sscanf(parts[1], "%d", &numStmt); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}
		if _, err := fmt.Sscanf(parts[2], "%d", &count); err != nil {
			return nil, fmt.Errorf("invalid line %d: %v", i+1, err)
		}

		blocks = append(blocks, CoverageBlock{
			File:      fileParts[0],
			StartLine: startLine,
			StartCol:  startCol,
			EndLine:   endLine,
			EndCol:    endCol,
			NumStmt:   numStmt,
			Count:     count,
		})
	}

	return blocks, nil
}

// CoverageConfig represents the coverage configuration
type CoverageConfig struct {
	Default  float64
	Packages map[string]float64
	Exclude  []string
}

// loadConfig reads and parses the coverage config
func loadConfig(r io.Reader) (*CoverageConfig, error) {
	data := make([]byte, 4096)
	var content strings.Builder
	for {
		n, err := r.Read(data)
		if n > 0 {
			content.Write(data[:n])
		}
		if err != nil {
			if err != io.EOF {
				return nil, err
			}
			break
		}
	}

	cfg := &CoverageConfig{
		Default:  80.0,
		Packages: make(map[string]float64),
		Exclude:  []string{},
	}

	lines := strings.Split(content.String(), "\n")
	inPackages := false
	inExclude := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if line == "packages:" {
			inPackages = true
			inExclude = false
			continue
		}
		if line == "exclude:" {
			inExclude = true
			inPackages = false
			continue
		}

		if strings.HasPrefix(line, "default:") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				var val float64
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &val)
				cfg.Default = val
			}
		} else if inPackages && strings.HasPrefix(line, "- ") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				pkg := strings.TrimSpace(strings.TrimPrefix(parts[0], "- "))
				var val float64
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &val)
				cfg.Packages[pkg] = val
			}
		} else if inExclude && strings.HasPrefix(line, "- ") {
			pkg := strings.TrimSpace(strings.TrimPrefix(line, "- "))
			cfg.Exclude = append(cfg.Exclude, pkg)
		}
	}

	return cfg, nil
}

// CoverageResult represents the result for a package
type CoverageResult struct {
	Package    string
	Coverage   float64
	MinCoverage float64
	Pass       bool
}

// evaluate computes coverage per package and checks thresholds
func evaluate(blocks []CoverageBlock, config *CoverageConfig) []CoverageResult {
	packageStats := make(map[string]struct {
		totalStmt   float64
		coveredStmt float64
	})

	// Group blocks by package and compute coverage
	for _, block := range blocks {
		// Extract package from file path
		// File format: path/to/file.go, package = directory = import path relative to root
		dir := filepath.Dir(block.File)
		// Remove the module name prefix if present
		pkgParts := strings.Split(dir, "/")
		var pkg string
		if len(pkgParts) > 0 {
			pkg = strings.Join(pkgParts, "/")
		}

		stats := packageStats[pkg]
		stats.totalStmt += float64(block.NumStmt)
		stats.coveredStmt += float64(block.Count)
		packageStats[pkg] = stats
	}

	// Build results
	var results []CoverageResult
	for pkg, stats := range packageStats {
		// Skip packages with zero statements
		if stats.totalStmt == 0 {
			continue
		}

		// Check if package is excluded
		excluded := false
		for _, pattern := range config.Exclude {
			if strings.HasPrefix(pkg, pattern) {
				excluded = true
				break
			}
		}
		if excluded {
			continue
		}

		// Calculate coverage percentage: covered statements / total statements * 100
		coverage := (stats.coveredStmt / stats.totalStmt) * 100

		// Get minimum threshold
		minCoverage := config.Default
		if pkgThreshold, ok := config.Packages[pkg]; ok {
			minCoverage = pkgThreshold
		}

		// Check pass/fail
		pass := coverage >= minCoverage

		results = append(results, CoverageResult{
			Package:    pkg,
			Coverage:   coverage,
			MinCoverage: minCoverage,
			Pass:       pass,
		})
	}

	// Sort results by package name for consistent output
	sort.Slice(results, func(i, j int) bool {
		return results[i].Package < results[j].Package
	})

	return results
}
