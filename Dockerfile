# syntax=docker/dockerfile:1

# Stage 1: build the SPA bundle (Vite writes to ../internal/web/dist).
FROM node:24.21-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

# Stage 2: build a static Go binary with the SPA embedded.
FROM golang:1.27.2-bookworm AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=web /src/internal/web/dist/ internal/web/dist/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/mdv ./cmd/mdv

# Stage 3: minimal non-root runtime.
FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="mdv" \
      org.opencontainers.image.description="Read-only Markdown viewer"
COPY --from=build /out/mdv /mdv
USER 65532:65532
ENV MDV_LISTEN=:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/mdv", "healthcheck"]
ENTRYPOINT ["/mdv"]
CMD ["serve"]
