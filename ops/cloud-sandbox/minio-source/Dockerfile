# CI fixture only: preserve the previously tested releases without depending on
# withdrawn precompiled MinIO images. Upstream sources and base images are pinned.
FROM golang:1.24.2-bookworm@sha256:79390b5e5af9ee6e7b1173ee3eac7fadf6751a545297672916b59bfa0ecf6f71 AS builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=readonly
WORKDIR /src/minio
RUN git init . \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
    && git tag RELEASE.2025-04-22T22-12-26Z \
    && go mod download \
    && go mod verify \
    && go build -tags kqueue -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio . \
    && mkdir -p /out/licenses/minio \
    && cp LICENSE NOTICE /out/licenses/minio/
WORKDIR /src/mc
RUN git init . \
    && git remote add origin https://github.com/minio/mc.git \
    && git fetch --depth=1 origin b00526b153a31b36767991a4f5ce2cced435ee8e \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = b00526b153a31b36767991a4f5ce2cced435ee8e \
    && git tag RELEASE.2025-04-16T18-13-26Z \
    && go mod download \
    && go mod verify \
    && go build -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/mc . \
    && mkdir -p /out/licenses/mc \
    && cp LICENSE /out/licenses/mc/

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /out/minio /out/mc /usr/local/bin/
COPY --from=builder /out/licenses /usr/share/licenses/minio-sandbox/
LABEL org.opencontainers.image.title="AilaoDa isolated MinIO test fixture" \
    org.opencontainers.image.source="https://github.com/minio/minio" \
    org.opencontainers.image.revision="0d7408fc9969caf07de6a8c3a84f9fbb10a6739e" \
    io.ailaoda.mc.revision="b00526b153a31b36767991a4f5ce2cced435ee8e" \
    io.ailaoda.scope="isolated-ci-only"
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
