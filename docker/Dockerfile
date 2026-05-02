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

RUN apt-get update && apt-get install -y git sqlite3 cron nano vim

ARG REPO_URL=https://github.com/topsgallat/pk-opencode-webui.git
ARG BRANCH=dev
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} .

# Install dependencies and build
WORKDIR /app/app-prefixable
RUN bun install && \
    bun add typescript typescript-language-server && \
    ln -sf ./node_modules/.bin/typescript-language-server /usr/local/bin/typescript-language-server
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM ubuntu:24.04

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssh-client \
    sqlite3 \
    sudo \
    unzip \
    xz-utils \
    openjdk-17-jdk \
    golang-go \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

# Install GitHub CLI
RUN case $(uname -m) in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        *) echo "Unsupported architecture" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_${ARCH}.tar.gz" -o /tmp/gh.tar.gz && \
    tar -xzf /tmp/gh.tar.gz -C /tmp && \
    mv /tmp/gh_*/bin/gh /usr/local/bin/gh && \
    chmod +x /usr/local/bin/gh && \
    rm -rf /tmp/gh*

# Install Node.js 20 LTS (via NodeSource)
ARG NODE_VERSION=20
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install popular LSPs globally
# Node.js-based LSPs
RUN npm install -g typescript typescript-language-server pyright bash-language-server && \
    ln -sf $(which typescript-language-server) /usr/local/bin/tsserver && \
    npm cache clean --force

# Go LSP (gopls)
RUN go install golang.org/x/tools/gopls@latest && \
    ln -sf $(go env GOPATH)/bin/gopls /usr/local/bin/gopls

# Rust LSP (rust-analyzer)
RUN curl -fsSL https://github.com/rust-analyzer/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz -o /tmp/rust-analyzer.gz && \
    gunzip /tmp/rust-analyzer.gz && \
    install -m 755 /tmp/rust-analyzer /usr/local/bin/rust-analyzer && \
    rm -f /tmp/rust-analyzer

# Java LSP (jdtls)
RUN mkdir -p /opt/jdtls && \
    curl -fsSL https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz | tar -xzf - -C /opt/jdtls && \
    ln -sf /opt/jdtls/bin/jdtls /usr/local/bin/jdtls

# Verify installations
RUN echo "=== Verifying LSP installations ===" && \
    which typescript-language-server pyright bash-language-server gopls rust-analyzer jdtls && \
    typescript-language-server --version && \
    pyright --version && \
    gopls version && \
    rust-analyzer --version && \
    echo "=== All LSPs installed successfully ==="

RUN npm install -g playwright && npx playwright install chromium

# Install Bun
ARG BUN_VERSION=1.1.42
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
    mv /root/.bun/bin/bun /usr/local/bin/bun && \
    rm -rf /root/.bun

# Install OpenCode CLI
# Uses latest version by default - ensures compatibility with plugins
# Check releases at: https://github.com/anomalyco/opencode/releases
ENV SHELL=/bin/bash
RUN curl -fsSL https://opencode.ai/install | bash && \
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
ARG HOST_UID=1000
ARG HOST_GID=1000
ARG ENABLE_SUDO=0
RUN usermod -l opencode ubuntu && \
    groupmod -n opencode ubuntu && \
    usermod -d /home/opencode -m opencode && \
    mkdir -p /opt/opencode-ui /run /home/opencode && \
    chown -R opencode:opencode /opt/opencode-ui /run /home/opencode && \
    if [ "${ENABLE_SUDO}" = "1" ]; then \
        echo "ALL ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers; \
        sed -i 's/^Defaults.*requiretty/#Defaults requiretty/' /etc/sudoers 2>/dev/null || true; \
        usermod -aG sudo opencode 2>/dev/null || true; \
    fi

# Copy built UI from builder stage
COPY --from=builder /app/app-prefixable/dist /opt/opencode-ui/dist
COPY --from=builder /app/app-prefixable/node_modules /opt/opencode-ui/node_modules

# Copy server script (from builder stage where git clone was done)
COPY --from=builder /app/docker/serve-ui.ts /opt/opencode-ui/serve-ui.ts

# Copy shared modules (from builder stage where git clone was done)
COPY --from=builder /app/shared /opt/shared

# Copy s6 configuration (from builder stage where git clone was done)
COPY --from=builder /app/docker/s6/ /etc/

# Set permissions
RUN chmod -R 755 /etc/services.d/opencode

RUN mkdir -p /home/opencode/.cache /home/opencode/.config /home/opencode/.local/state /home/opencode/AppData && \
    chown -R opencode:opencode /home/opencode



# Environment variables
ENV PORT=8080 \
    API_URL=http://127.0.0.1:4096 \
    BASE_PATH=/ \
    OPERATION_MODE=solo

USER opencode

WORKDIR /opt/opencode-ui

EXPOSE 8080

ENTRYPOINT ["/init"]