// Command mdv serves the markdown viewer web application.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/awesomejt/markdown-viewer/internal/api"
	"github.com/awesomejt/markdown-viewer/internal/config"
	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/web"
)

var version = "dev"

const (
	healthTimeout   = 3 * time.Second
	shutdownTimeout = 10 * time.Second
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func versionString() string {
	return "mdv " + version
}

// run dispatches the subcommand and returns the process exit code.
func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	cmd := "serve"
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "serve":
		return serve(ctx, getenv, stderr, nil)
	case "version":
		_, _ = fmt.Fprintln(stdout, versionString())
		return 0
	case "healthcheck":
		url := healthURL(getenv("MDV_LISTEN"))
		if err := healthcheck(ctx, url); err != nil {
			_, _ = fmt.Fprintln(stderr, "healthcheck failed:", err)
			return 1
		}
		return 0
	default:
		_, _ = fmt.Fprintf(stderr, "unknown command %q (want serve, version, healthcheck)\n", cmd)
		return 2
	}
}

// healthURL builds the loopback /healthz URL from MDV_LISTEN. It reads only
// the listen address, never MDV_ROOTS, so it works in a bare container.
func healthURL(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil || port == "" {
		host, port = "", "8080"
		if _, p, err2 := net.SplitHostPort(":" + listen); err2 == nil && listen != "" {
			port = p // bare port such as "9000"
		}
	}
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/healthz"
}

// healthcheck succeeds only on a 200 response with {"status":"ok"}.
func healthcheck(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, healthTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body); err != nil {
		return fmt.Errorf("bad response body: %w", err)
	}
	if body.Status != "ok" {
		return fmt.Errorf("unexpected status %q", body.Status)
	}
	return nil
}

// serve runs the server until ctx is cancelled. If ready is non-nil it
// receives the bound address once the listener is up.
func serve(ctx context.Context, getenv func(string) string, stderr io.Writer, ready chan<- net.Addr) int {
	cfg, err := config.Load(getenv)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "configuration error:", err)
		return 1
	}
	logger := slog.New(slog.NewJSONHandler(stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))

	reg, err := fsroot.NewRegistry(cfg)
	if err != nil {
		logger.Error("open roots", "err", err)
		return 1
	}
	defer func() { _ = reg.Close() }()

	apiSrv := api.New(reg, cfg, logger)
	defer apiSrv.Close()
	apiSrv.Mux().Handle("/", web.Handler())

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		logger.Error("listen", "addr", cfg.Listen, "err", err)
		return 1
	}
	// No global WriteTimeout: SSE streams (/api/events) are long-lived and
	// large files stream slowly. Per-stream deadlines are managed by handlers
	// via http.ResponseController.
	srv := &http.Server{
		Handler:           apiSrv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// Open SSE streams would otherwise hold Shutdown until the drain timeout.
	srv.RegisterOnShutdown(apiSrv.Close)
	logger.Info("listening", "addr", ln.Addr().String(), "version", version)
	if ready != nil {
		ready <- ln.Addr()
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	select {
	case err := <-errCh:
		logger.Error("server failed", "err", err)
		return 1
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		logger.Error("shutdown", "err", err)
		_ = srv.Close()
		return 1
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server", "err", err)
		return 1
	}
	return 0
}
