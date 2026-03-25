# Docker Images

This directory contains Docker configurations for running OpenCode Web.

## Generic Image (`Dockerfile`)

An image that runs the UI server with an optional built-in OpenCode API. Suitable for:
- Standalone deployments (solo mode — API + UI in one container)
- Docker Compose setups with a separate API container
- General reverse proxy deployments (nginx, traefik)
- Kubernetes deployments (without Kubeflow)

### Build

```bash
# From repo root
docker build -f docker/Dockerfile -t opencode-web .
```

### Operation Modes

The image supports two modes via the `OPERATION_MODE` environment variable:

#### Solo mode (default)

Starts the OpenCode API server on port 4096, waits for it to be ready, then starts
the UI server. Both processes run in the same container supervised by s6-overlay.

```bash
docker run -p 8080:8080 opencode-web
# Access at http://localhost:8080
```

With a custom base path:
```bash
docker run -p 8080:8080 \
  -e BASE_PATH=/apps/opencode/ \
  opencode-web
```

#### UI-only mode

Only the UI server starts. Expects the OpenCode API to be available at `API_URL`.

```bash
docker run -p 8080:8080 \
  -e OPERATION_MODE=ui-only \
  -e API_URL=http://host.docker.internal:4096 \
  opencode-web
```

Docker Compose example with a separate API container:
```yaml
version: '3.8'
services:
  api:
    image: your-opencode-api-image

  ui:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "8080:8080"
    environment:
      - OPERATION_MODE=ui-only
      - API_URL=http://api:4096
      - BASE_PATH=/
```

### Volume Mounts

**Option 1: Just for running projects (no config sync)**

Mount only the directory where your projects are:

```bash
docker run -p 8080:8080 \
  -e OPERATION_MODE=solo \
  -e HOME=/projects \
  -v /path/to/projects:/projects \
  opencode-web
```

```yaml
services:
  opencode:
    build: .
    ports:
      - "8080:8080"
    environment:
      - OPERATION_MODE=solo
      - HOME=/projects
    volumes:
      - /path/to/projects:/projects
```

**Option 2: With home directory (full config)**

```bash
docker run -p 8080:8080 \
  -e OPERATION_MODE=solo \
  -e HOME=/home/username \
  -v /home/username:/home/username \
  opencode-web
```

```yaml
services:
  opencode:
    build: .
    ports:
      - "8080:8080"
    environment:
      - OPERATION_MODE=solo
      - HOME=/home/username
    volumes:
      - /home/username:/home/username
```

**How it works:**
- `HOME` tells OpenCode where to look for config and where projects are stored
- OpenCode cache and config are automatically symlinked to container's directories to avoid conflicts
- Container uses its own internal configs (`.config/opencode`, `.cache/opencode`)

**Note on non-home volumes:** If you mount a non-home directory, ensure `.config` and `.cache` directories exist:

```bash
mkdir -p /path/to/projects/.config /path/to/projects/.cache
```

### Syncing Config from Host to Container

If you want to use your existing OpenCode configs (MCP servers, skills, agents) in the container:

```bash
# 1. Copy configs from host to container
docker cp ~/.config/opencode/. <container-name>:/home/<USER>/.config/opencode/
docker cp ~/.cache/opencode/. <container-name>:/home/<USER>/.cache/opencode/

# 2. Restart the container to load the new configs
docker restart <container-name>
```

**Example with docker-compose:**
```bash
# Copy configs (replace USER with your username and container name with yours)
docker cp ~/.config/opencode/. opencode:/home/USER/.config/opencode/

# Restart
docker restart opencode
```

**What gets synced:**

| Directory | Contents | Notes |
|----------|----------|-------|
| `oh-my-opencode.json` | Agent models, categories | ✅ Portable |
| `skills/` | Custom AI skills | ✅ Portable |
| `mcp-servers/` | MCP server configs | ⚠️ May need reinstallation |
| `agent/` | Agent configurations | ✅ Portable |
| `workflow/` | Workflow configs | ✅ Portable |
| `node_modules/` | Dependencies | ⚠️ Will be reinstalled |

**Note:** Configs stored in the container layer will persist after container recreation, but will be lost if the image is rebuilt. For permanent storage, consider using a Docker volume instead of bind mounts.

### Environment Variables

| Variable         | Default                 | Description                                          |
|------------------|-------------------------|------------------------------------------------------|
| `OPERATION_MODE` | `solo`                  | `solo`: API + UI together; `ui-only`: UI server only |
| `HOME`           | `/root`                 | Home directory (set to mounted path for projects)      |
| `PORT`           | `8080`                  | Port the UI server listens on                        |
| `API_URL`        | `http://127.0.0.1:4096` | OpenCode API server URL (used in `ui-only` mode)     |
| `BASE_PATH`      | `/`                     | URL prefix for reverse proxy support                 |
| `BRANDING_NAME`  | (empty)                 | Optional branding name shown in UI                   |
| `BRANDING_URL`   | (empty)                 | Optional URL for branding link                       |

## Kubeflow Image (`kubeflow/Dockerfile`)

A full-featured image for Kubeflow Notebooks that includes:
- OpenCode CLI pre-installed
- s6-overlay process supervisor
- Kubeflow-compatible user (jovyan, UID 1000)
- Automatic home directory setup for PVCs

See [kubeflow/README.md](kubeflow/README.md) for details.

### Build

```bash
# From repo root
docker build -f docker/kubeflow/Dockerfile -t opencode-web-kubeflow .
```
