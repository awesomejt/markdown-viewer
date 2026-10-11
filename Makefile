.PHONY: help deps deps-e2e web build fixtures test-go test-web test cover-check lint lint-go lint-web lint-e2e lint-yaml lint-md lint-docker lint-shell check run e2e docker clean
.SHELLFLAGS := -eu -o pipefail -c
SHELL := /bin/bash

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

# Pinned lint tool images (run as the host user; caches live under the ignored build/.cache/).
GOLANGCI_IMAGE := golangci/golangci-lint:v2.14.0
HADOLINT_IMAGE := hadolint/hadolint:v2.15.1
SHELLCHECK_IMAGE := koalaman/shellcheck:v0.11.0
# Must match the @playwright/test version pinned in e2e/package.json.
PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v1.64.0-noble
DOCKER_RUN := docker run --rm -u $$(id -u):$$(id -g) -v $(CURDIR):/src -w /src
# Dockerfiles and shell scripts, excluding vendored/generated trees.
FIND_EXCLUDES := -not -path './web/node_modules/*' -not -path './e2e/node_modules/*' -not -path './build/*' -not -path './.git/*' -not -path './internal/web/dist/*'

## help: show this help message
help:
	@sed -n 's/^## //p' Makefile

## deps: install npm dependencies
deps: deps-e2e
	npm --prefix web ci

## deps-e2e: install e2e npm dependencies
deps-e2e: build/.stamp-e2e-deps

build/.stamp-e2e-deps: e2e/package.json e2e/package-lock.json
	npm --prefix e2e ci
	mkdir -p build
	touch $@

## web: build the web frontend
web:
	npm --prefix web run build

## build: build the entire application (web + Go binary)
build: web
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o build/mdv ./cmd/mdv

## fixtures: generate untracked test fixtures (symlinks, large file) and verify them
fixtures:
	testdata/mkfixtures.sh
	testdata/mkfixtures.sh --verify

## test-go: run Go tests with race detection and coverage
test-go: fixtures
	mkdir -p build/coverage
	go test -race -coverprofile=build/coverage/go.out ./...

## test-web: run web tests with coverage
test-web:
	npm --prefix web run coverage

## test: run all tests (Go + web)
test: test-go test-web

## cover-check: verify coverage meets thresholds (runs Go tests first)
# Real dependency on test-go keeps this correct under parallel make (-j).
cover-check: test-go
	go run ./tools/covercheck -profile build/coverage/go.out -config .coverage.yaml

## lint: run all linters
lint: lint-go lint-web lint-e2e lint-yaml lint-md lint-docker lint-shell

## lint-go: go vet + golangci-lint (Docker)
lint-go:
	mkdir -p build/.cache/go-build build/.cache/go-mod build/.cache/golangci-lint
	go vet ./...
	$(DOCKER_RUN) -e GOCACHE=/src/build/.cache/go-build -e GOMODCACHE=/src/build/.cache/go-mod \
		-e GOLANGCI_LINT_CACHE=/src/build/.cache/golangci-lint $(GOLANGCI_IMAGE) golangci-lint run ./...

## lint-web: ESLint, typecheck, and Prettier check
lint-web:
	npm --prefix web run lint
	npm --prefix web run typecheck
	npm --prefix web run format:check

## lint-e2e: ESLint, typecheck, and Prettier check for e2e/
lint-e2e: build/.stamp-e2e-deps
	npm --prefix e2e run lint
	npm --prefix e2e run typecheck
	npm --prefix e2e run format:check

## lint-yaml: yamllint (local binary)
lint-yaml:
	yamllint -c .yamllint.yaml .

## lint-md: markdownlint-cli2
lint-md:
	npm --prefix web exec -- markdownlint-cli2

## lint-docker: hadolint on Dockerfiles (Docker; no-op if none)
lint-docker:
	@files=$$(find . -name 'Dockerfile*' -type f $(FIND_EXCLUDES) | sort); \
	if [ -z "$$files" ]; then echo "lint-docker: no Dockerfiles found, skipping"; exit 0; fi; \
	$(DOCKER_RUN) $(HADOLINT_IMAGE) hadolint --config .hadolint.yaml $$files

## lint-shell: shellcheck on *.sh (Docker; no-op if none)
lint-shell:
	@files=$$(find . -name '*.sh' -type f $(FIND_EXCLUDES) | sort); \
	if [ -z "$$files" ]; then echo "lint-shell: no shell scripts found, skipping"; exit 0; fi; \
	$(DOCKER_RUN) $(SHELLCHECK_IMAGE) $$files

## check: run all checks (lint + test + coverage verification)
check: lint test cover-check

## run: build and run the application
run: build
	MDV_ROOTS=$${MDV_ROOTS:-examples=$(CURDIR)/examples} ./build/mdv

## e2e: run end-to-end tests
# Runs inside the pinned Playwright image (no host browsers); reports go to build/e2e/ (HTML: build/e2e/report).
e2e: build fixtures build/.stamp-e2e-deps
	mkdir -p build/e2e build/.cache/home
	$(DOCKER_RUN) --ipc=host -e HOME=/src/build/.cache/home -e CI=1 -w /src/e2e $(PLAYWRIGHT_IMAGE) npx playwright test

## docker: build Docker image
docker:
	@echo "docker not configured yet (D1)"

## clean: remove build artifacts
clean:
	@# The Go module cache under build/.cache is read-only; make it writable first.
	@if [ -d build ]; then chmod -R u+w build; fi
	rm -rf build
	find internal/web/dist -mindepth 1 ! -name .gitkeep -delete
