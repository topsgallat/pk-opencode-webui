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
RUN bun install
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
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

# Install Node.js 20 LTS (via NodeSource)
ARG NODE_VERSION=20
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g playwright && npx playwright install chromium chrome

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
# HOST_UID and HOST_GID are passed from docker-compose to match the host user's ID.
# This ensures the container can read/write the mounted volume correctly.
# ENABLE_SUDO=1 to allow sudo for opencode user
ARG HOST_UID=1000
ARG HOST_GID=1000
ARG ENABLE_SUDO=0
RUN groupadd -r opencode 2>/dev/null || true && \
    (getent passwd opencode 2>/dev/null && echo "opencode user exists" || \
     (useradd -r -g opencode -u ${HOST_UID} -d /home/opencode -s /bin/bash opencode 2>/dev/null && echo "created with uid ${HOST_UID}" || \
      useradd -r -g opencode -u 1000 -d /home/opencode -s /bin/bash opencode 2>/dev/null && echo "created with uid 1000 (fallback)" || \
      echo "opencode user creation failed, will run as root")) && \
    mkdir -p /opt/opencode-ui /run && \
    (chown -R opencode:opencode /opt/opencode-ui /run 2>/dev/null || true) && \
    if [ "${ENABLE_SUDO}" = "1" ]; then \
        echo "ALL ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers; \
        sed -i 's/^Defaults.*requiretty/#Defaults requiretty/' /etc/sudoers 2>/dev/null || true; \
        usermod -aG sudo opencode 2>/dev/null || true; \
    fi

# Copy built UI from builder stage
COPY --from=builder /app/app-prefixable/dist /opt/opencode-ui/dist

# Copy server script (from builder stage where git clone was done)
COPY --from=builder /app/docker/serve-ui.ts /opt/opencode-ui/serve-ui.ts

# Copy shared modules (from builder stage where git clone was done)
COPY --from=builder /app/shared /opt/shared

# Copy s6 configuration (from builder stage where git clone was done)
COPY --from=builder /app/docker/s6/ /etc/

# Set permissions
RUN chmod -R 755 /etc/services.d/opencode

RUN mkdir -p /home/opencode/.cache /home/opencode/.config /home/opencode/.local/state /home/opencode/AppData



# Environment variables
ENV PORT=8080 \
    API_URL=http://127.0.0.1:4096 \
    BASE_PATH=/ \
    OPERATION_MODE=solo

USER opencode

WORKDIR /opt/opencode-ui

EXPOSE 8080

ENTRYPOINT ["/init"]
