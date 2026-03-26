/**
 * Production UI Server for OpenCode Prefixable
 *
 * This server:
 * 1. Serves static files from /opt/opencode-ui/dist
 * 2. Proxies API requests to the OpenCode API server (localhost:4096)
 * 3. Proxies WebSocket connections for PTY terminal sessions
 * 4. Injects NB_PREFIX into index.html at runtime
 * 5. Provides extended API endpoints (/api/ext/*)
 *
 * Operation Modes (OPERATION_MODE env var):
 *   solo     (default): Starts OpenCode API server on port 4096, then starts UI
 *   ui-only: Only starts the UI server; expects external API at API_URL
 */

import { handleExtendedEndpoint, isApiPath } from "../shared/extended-api"

const BASE_PATH = process.env.NB_PREFIX || process.env.BASE_PATH || "/"
const PORT = parseInt(process.env.PORT || "8080", 10)
const API_URL = process.env.API_URL || "http://127.0.0.1:4096"
const OPERATION_MODE = process.env.OPERATION_MODE || "solo"

if (OPERATION_MODE === "solo") {
  const homeDir = process.env.HOME || "/root"

  if (homeDir !== "/root") {
    await Bun.spawn(["mkdir", "-p", "/root/.cache", "/root/.config"]).exited

    const dirs = [
      { mounted: `${homeDir}/.cache/opencode`, container: "/root/.cache/opencode" },
      { mounted: `${homeDir}/.config/opencode`, container: "/root/.config/opencode" },
    ]

    for (const dir of dirs) {
      await Bun.spawn(["mkdir", "-p", dir.container]).exited
      console.log(`[solo] Created container directory (if missing): ${dir.container}`)
    }

    console.log(`[solo] Using container directories: /root/.cache/opencode and /root/.config/opencode (host-mounted directories left untouched)`)
const serverStartTime = Date.now()
          ...(ext !== "html" && {
            "Cache-Control": "public, max-age=0, must-revalidate",
    const cacheBuster = `?v=${serverStartTime}`
    let injected = indexHtml
      .replace('<base href="/" />', `<base href="${escapedBasePath}" />`)
      .replace("window.__OPENCODE__ = window.__OPENCODE__ || {}", `window.__OPENCODE__ = ${config}`)
    injected = injected
      .replace('src="./entry.js"', `src="./entry.js${cacheBuster}"`)
      .replace('href="./entry.css"', `href="./entry.css${cacheBuster}"`)
