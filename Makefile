.PHONY: help deps web build test-go test-web test cover-check lint check run e2e docker clean
.SHELLFLAGS := -eu -o pipefail -c
SHELL := /bin/bash

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

## help: show this help message
help:
	@sed -n 's/^## //p' Makefile

## deps: install npm dependencies
deps:
	npm --prefix web ci

## web: build the web frontend
web:
	npm --prefix web run build

## build: build the entire application (web + Go binary)
build: web
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o build/mdv ./cmd/mdv

## test-go: run Go tests with race detection and coverage
test-go:
	mkdir -p build/coverage
	go test -race -coverprofile=build/coverage/go.out ./...

## test-web: run web tests with coverage
test-web:
	npm --prefix web run coverage

## test: run all tests (Go + web)
test: test-go test-web

## cover-check: verify coverage meets thresholds
cover-check:
	go run ./tools/covercheck -profile build/coverage/go.out -config .coverage.yaml

## lint: run all linters (P0.3 will extend this target)
lint:
	go vet ./...
	npm --prefix web run lint
	npm --prefix web run typecheck

## check: run all checks (lint + test + coverage verification)
check: lint test cover-check

## run: build and run the application
run: build
	MDV_ROOTS=$${MDV_ROOTS:-examples=$(CURDIR)/examples} ./build/mdv

## e2e: run end-to-end tests
e2e:
	@echo "e2e not configured yet (T1)"
	@exit 0

## docker: build Docker image
docker:
	@echo "docker not configured yet (D1)"

## clean: remove build artifacts
clean:
	rm -rf build
	find internal/web/dist -mindepth 1 ! -name .gitkeep -delete
