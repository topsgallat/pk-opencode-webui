# Install and run OpenCode UI (pk-opencode-webui)

This repository contains the prefix-aware OpenCode UI frontend. The project uses Bun for local development scripts and esbuild for production builds. You can run the UI either locally (dev mode) or inside the provided Docker image.

Prerequisites
-------------
- Git
- Bun (recommended) — used by the frontend scripts in `app-prefixable`
- Docker & Docker Compose (for containerized runs)

Install Bun
-----------
Follow the official instructions: https://bun.sh/

On macOS / Linux (one-liner):

```bash
curl -fsSL https://bun.sh/install | bash
```

After install, ensure `bun` is on your PATH:

```bash
bun -v
```

If you prefer Node.js/npm/yarn, you can install equivalent tools but the provided scripts use Bun by default.

Local development
-----------------
1. Install dependencies (from repo root):

```bash
cd app-prefixable
bun install
```

2. Start the dev server (port 3000 by default):

```bash
bun run dev
```

3. Open your browser at http://localhost:3000

Production build (local)
------------------------
From `app-prefixable`:

```bash
bun run build
```

The build output will be written according to the `build.ts` script configuration.

Run with Docker Compose (UI-only)
---------------------------------
The repo includes a Docker Compose file for running only the UI. Build and start the container with:

```bash
docker compose -f docker-compose.ui-only.yaml up -d --build
```

The container `opencode-ui-only` exposes the UI on port 8080 by default (see compose file).

Environment & Base Path
-----------------------
The frontend supports a `BASE_PATH` prefix. To run behind a prefix, set the `BASE_PATH` environment variable before building or starting the container. Example:

```bash
BASE_PATH=/notebook/ns/name bun run dev
```

Troubleshooting
---------------
- If Bun is not available, you can try running the scripts with Node.js, but you might need to adapt the scripts and install Node-compatible packages.
- If the UI fails to load in Docker, check container logs:

```bash
docker compose -f docker-compose.ui-only.yaml logs -f
```

- If TypeScript reports errors, run typecheck:

```bash
bun run typecheck
```

Contributing
------------
Follow the repository conventions for commits and branches. Do not push directly to `main`.
