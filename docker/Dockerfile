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
RUN bun add @playwright/mcp@latest cloakbrowser@0.3.26
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM ubuntu:24.04


RUN sed -i 's|http://archive.ubuntu.com/ubuntu|http://mirror.kku.ac.th/ubuntu|g' /etc/apt/sources.list && \
    sed -i 's|http://security.ubuntu.com/ubuntu|http://mirror.kku.ac.th/ubuntu|g' /etc/apt/sources.list

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    gnupg \
    git \
    openssh-client \
    python3 \
    sqlite3 \
    sudo \
    unzip \
    xz-utils \
    golang-go \
    ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

RUN case $(uname -m) in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        *) echo "Unsupported architecture" && exit 1 ;; \
    esac && \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && \
    echo "deb [arch=${ARCH} signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

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

ARG NODE_VERSION=20.19.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && \
    rm -f /tmp/node.tar.xz && \
    node --version && \
    npm --version

# Install popular LSPs globally
# Node.js-based LSPs
RUN npm install -g typescript typescript-language-server pyright bash-language-server && \
    ln -sf $(which typescript-language-server) /usr/local/bin/tsserver && \
    npm cache clean --force

# Go LSP (gopls) - disabled, go removed to speed up build
# ENV GOPATH=/go
# ENV PATH=$GOPATH/bin:$PATH
# RUN mkdir -p /go/bin && \
#    go install golang.org/x/tools/gopls@latest && \
#    ls -la /go/bin/gopls && \
#    cp /go/bin/gopls /usr/local/bin/gopls && \
#    chmod 755 /usr/local/bin/gopls && \
#    /usr/local/bin/gopls version

# Rust LSP (rust-analyzer)
RUN curl -fsSL https://github.com/rust-analyzer/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz -o /tmp/rust-analyzer.gz && \
    gunzip /tmp/rust-analyzer.gz && \
    install -m 755 /tmp/rust-analyzer /usr/local/bin/rust-analyzer && \
    rm -f /tmp/rust-analyzer

# Verify installations
RUN echo "=== Verifying LSP installations ===" && \
    which typescript-language-server pyright bash-language-server rust-analyzer && \
    typescript-language-server --version && \
    pyright --version && \
    rust-analyzer --version && \
    echo "=== All LSPs installed successfully ==="

# Install Playwright with Chromium (Chrome not needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g playwright && npx playwright install chromium

ENV HOME=/home/opencode
ENV XDG_CACHE_HOME=/home/opencode/.cache
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/lib/playwright
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu --headless"
RUN ln -sf $(which chromium || which chromium-browser) /usr/bin/google-chrome 2>/dev/null || true

# Verify Playwright can find the browser
RUN npx playwright install chromium && \
    npx playwright --version && \
    echo "Chromium path: $(which chromium || which chromium-browser)"

# Install Bun (latest stable version)
# Use BUN_INSTALL to install directly to /usr/local/bin, avoiding path issues
RUN for i in 1 2 3 4 5; do \
      curl -fsSL --retry 5 --retry-delay 10 https://bun.sh/install && break; \
      echo "Attempt $i failed, retrying..."; sleep 15; \
    done | BUN_INSTALL=/usr/local bash

# Install OpenCode CLI
# -----------------------------------------------------------------------------
# PINNED TO 1.14.28 - DO NOT UPGRADE without testing plugin loading first!
#
# Root cause: opencode 1.14.32 has a regression where plugin loading is
# completely broken — no agents from oh-my-openagent (or any plugin) appear
# in the agent selector, and there are zero plugin-related log entries on
# startup. Downgrading to 1.14.28 restores plugin functionality.
#
# Before upgrading, verify that oh-my-openagent agents appear in /agent API:
#   curl http://localhost:8080/agent | python3 -m json.tool
# Expected: agents beyond the 7 built-ins (build, compaction, explore, etc.)
# -----------------------------------------------------------------------------
ENV SHELL=/bin/bash
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version 1.14.28 && \
    mv ${HOME}/.opencode/bin/opencode /usr/local/bin/opencode && \
    rm -rf ${HOME}/.opencode

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
    rm -rf /home/opencode 2>/dev/null || true && \
    usermod -d /home/opencode -m opencode && \
    mkdir -p /opt/opencode-ui /run /home/opencode && \
    chown -R opencode:opencode /opt/opencode-ui /run /home/opencode && \
    if [ "${ENABLE_SUDO}" = "1" ]; then \
        echo "ALL ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers; \
        sed -i 's/^Defaults.*requiretty/#Defaults requiretty/' /etc/sudoers 2>/dev/null || true; \
        usermod -aG sudo opencode 2>/dev/null || true; \
    fi


RUN chown -R opencode:opencode /usr/local/lib/playwright/
# Copy built UI from builder stage
COPY --from=builder /app/app-prefixable/dist /opt/opencode-ui/dist
COPY --from=builder /app/app-prefixable/node_modules /opt/opencode-ui/node_modules
COPY --from=builder /app/app-prefixable/package.json /opt/opencode-ui/package.json
RUN cd /opt/opencode-ui && npm install playwright --legacy-peer-deps

# Copy server script (from builder stage where git clone was done)
COPY --from=builder /app/docker/serve-ui.ts /opt/opencode-ui/serve-ui.ts

# Copy Playwright MCP wrapper used by solo-mode startup config
COPY scripts/playwright-mcp-cloakbrowser.mjs /opt/opencode-ui/scripts/playwright-mcp-cloakbrowser.mjs

# Copy shared modules (from builder stage where git clone was done)
COPY --from=builder /app/shared /opt/shared

# Copy s6 configuration (from builder stage where git clone was done)
COPY --from=builder /app/docker/s6/ /etc/

# Set permissions
RUN chmod -R 755 /etc/services.d/opencode

RUN mkdir -p /home/opencode/.config /home/opencode/.local/state /home/opencode/AppData && \
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
