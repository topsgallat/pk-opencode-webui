# =============================================================================
# OpenCode Web - Generic Docker Image
# =============================================================================
# A prefix-aware Web UI for OpenCode that works behind reverse proxies.
# Supports dynamic URL prefixes via BASE_PATH environment variable.
#
# Operation Modes (OPERATION_MODE env var):
#   solo     (default): Starts OpenCode API on port 4096 + UI together
#   ui-only: Only the UI server; expects external API at API_URL
#
# For Kubeflow-specific deployments, see docker/kubeflow/Dockerfile
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the UI
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy source
COPY app-prefixable ./app-prefixable
COPY shared ./shared

# Install dependencies and build
WORKDIR /app/app-prefixable
RUN bun install
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM ubuntu:24.04

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    curl \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
ARG BUN_VERSION=1.1.42
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
    mv /root/.bun/bin/bun /usr/local/bin/bun && \
    rm -rf /root/.bun

# Install OpenCode CLI
# Pin version to ensure reproducible builds. Update by changing OPENCODE_VERSION.
# Check releases at: https://github.com/anomalyco/opencode/releases
ARG OPENCODE_VERSION=1.2.6
ENV SHELL=/bin/bash
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION}" && \
    mv /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    rm -rf /root/.opencode

# Install s6-overlay for process supervision
ARG S6_OVERLAY_VERSION=3.1.6.2
RUN case $(uname -m) in \
        x86_64) ARCH=x86_64 ;; \
        aarch64) ARCH=aarch64 ;; \
        *) echo "Unsupported architecture" && exit 1 ;; \
    esac && \
    curl -L "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" | tar -xJvf - -C / && \
    curl -L "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${ARCH}.tar.xz" | tar -xJvf - -C /

# Create non-root user and app directory
RUN groupadd -r opencode && useradd -r -g opencode -u 1000 -d /home/opencode -s /bin/bash opencode && \
    mkdir -p /opt/opencode-ui /run /home/opencode && \
    chown -R opencode:opencode /opt/opencode-ui /run /home/opencode

# Copy built UI from builder stage
COPY --from=builder /app/app-prefixable/dist /opt/opencode-ui/dist

# Copy server script
COPY docker/serve-ui.ts /opt/opencode-ui/serve-ui.ts

# Copy shared modules (for serve-ui.ts imports)
COPY shared /opt/shared

# Copy s6 configuration
COPY docker/s6/ /etc/

# Set permissions
RUN chmod -R 755 /etc/services.d/opencode



# Environment variables
ENV PORT=8080 \
    API_URL=http://127.0.0.1:4096 \
    BASE_PATH=/ \
    OPERATION_MODE=solo \
    HOME=/home/opencode

USER opencode

WORKDIR /opt/opencode-ui

EXPOSE 8080

ENTRYPOINT ["/init"]
