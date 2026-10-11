// Command spike-d2 is a throwaway spike (task P0.5) that renders D2 source to
// light and dark SVG files using github.com/d2lang/d2 in-process. It will be
// deleted when task B5 (internal/d2render) lands.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2dagrelayout"
	"github.com/d2lang/d2/d2layouts/d2elklayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2renderers/d2svg"
	"github.com/d2lang/d2/d2themes/d2themescatalog"
	"github.com/d2lang/d2/lib/log"
	"github.com/d2lang/d2/lib/textmeasure"
	"github.com/d2lang/util-go/go2"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	in := flag.String("in", "", "input .d2 file")
	outDir := flag.String("out-dir", "build/spike-d2", "output directory")
	layout := flag.String("layout", "dagre", "layout engine: dagre or elk")
	timeout := flag.Duration("timeout", 30*time.Second, "compile timeout")
	flag.Parse()
	if *in == "" {
		return fmt.Errorf("-in is required")
	}

	var lay d2graph.LayoutGraph
	switch *layout {
	case "dagre":
		lay = d2dagrelayout.DefaultLayout
	case "elk":
		lay = d2elklayout.DefaultLayout
	default:
		return fmt.Errorf("unknown layout %q", *layout)
	}

	src, err := os.ReadFile(*in) //nolint:gosec // spike reads a caller-chosen path
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*outDir, 0o750); err != nil {
		return err
	}
	name := strings.TrimSuffix(filepath.Base(*in), filepath.Ext(*in))

	ruler, err := textmeasure.NewRuler()
	if err != nil {
		return err
	}
	themes := []struct {
		suffix string
		id     int64
	}{
		{"light", d2themescatalog.NeutralDefault.ID},
		{"dark", d2themescatalog.DarkMauve.ID},
	}
	for _, th := range themes {
		start := time.Now()
		renderOpts := &d2svg.RenderOpts{Pad: go2.Pointer(int64(5)), ThemeID: go2.Pointer(th.id)}
		compileOpts := &d2lib.CompileOptions{
			Ruler:          ruler,
			LayoutResolver: func(string) (d2graph.LayoutGraph, error) { return lay, nil },
		}
		ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), *timeout)
		diagram, _, err := d2lib.Compile(ctx, string(src), compileOpts, renderOpts)
		cancel()
		if err != nil {
			return fmt.Errorf("compile: %w", err)
		}
		svg, err := d2svg.Render(diagram, renderOpts)
		if err != nil {
			return fmt.Errorf("render: %w", err)
		}
		out := filepath.Join(*outDir, fmt.Sprintf("%s-%s.svg", name, th.suffix))
		if err := os.WriteFile(out, svg, 0o600); err != nil {
			return err
		}
		fmt.Printf("%s layout=%s theme=%d: %v, %d bytes -> %s\n", th.suffix, *layout, th.id, time.Since(start), len(svg), out)
	}
	return nil
}
