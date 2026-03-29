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

// @ts-nocheck
// Note: This file runs under Bun in a container environment and references
// runtime globals (process, Bun, Buffer, etc.) that may not have TypeScript
// declaration files available in the static analysis environment used by
// the LSP. We intentionally disable TS type checking for this startup file to
// avoid spurious diagnostics while keeping runtime behavior unchanged.


import { handleExtendedEndpoint, isApiPath } from "../shared/extended-api"
import path from "path"

const BASE_PATH = process.env.NB_PREFIX || process.env.BASE_PATH || "/"
const PORT = parseInt(process.env.PORT || "8080", 10)
const API_PORT = parseInt(process.env.OPENCODE_API_PORT || process.env.API_PORT || "4096", 10)
const API_URL = process.env.API_URL || `http://127.0.0.1:${API_PORT}`
const OPERATION_MODE = process.env.OPERATION_MODE || "solo"

function isForbiddenHostPath(p: string): boolean {
  const norm = path.resolve(p.replace(/\\/g, '/'))

  // Allow-list: explicitly permit common container-local paths so the
  // startup checks do not falsely block valid container HOME/XDG_CACHE_HOME.
  // Keep this list minimal and explicit.
  const allowedPatterns = [
    /^\/home\/[^/]+(\/|$)/,
    /^\/tmp\//,
  ]
  for (const pat of allowedPatterns) {
    if (pat.test(norm)) return false
  }

  // Forbidden patterns: explicit host/user/system locations or host mount
  // points. These are strong indicators the env var points to a host path.
  const forbiddenPatterns = [
    /^\/Users\//,
    /^\/root(\/|$)/,
    /^\/mnt\//,
    /^\/media\//,
    /^\/etc\//,
    /^\/var\//,
    /^\/run\//,
    /^\/opt\//,
    /^\/host_mnt\//,
    /^\/workspace\//,
    /^\/docker\//,
    /^\/srv\//,
    /^\/data\//,
    /^\/Volumes\//,
    /^[A-Za-z]:\\/,           // Windows drive paths
  ]

  for (const pat of forbiddenPatterns) {
    if (pat.test(norm)) return true
  }

  const lower = norm.toLowerCase()
  if (lower.includes('documents and settings')) return true

  return false
}

// Auth header for proxy (set in solo mode)
let proxyAuthHeader: string | undefined

if (OPERATION_MODE === "solo") {
  const homeDir = process.env.HOME
  const xdgCache = process.env.XDG_CACHE_HOME
  // Root/host path & non-root checks
  if (!homeDir) {
    console.error("[solo] ERROR: HOME environment variable is not set. Cannot proceed without a home directory for container-local cache and config.")
    process.exit(1)
  }

  if (isForbiddenHostPath(homeDir)) {
    console.error(`[solo] ERROR: HOME env points to forbidden host location (${homeDir}); must be a container-local path (e.g. /container-user). Aborting.`)
    process.exit(1)
  }
  if (process.getuid && process.getuid() === 0) {
    console.error("[solo] ERROR: Refusing to run as root. Please use a non-root container user.")
    process.exit(1)
  }
  if (xdgCache && isForbiddenHostPath(xdgCache)) {
    console.error(`[solo] ERROR: XDG_CACHE_HOME points to forbidden host location (${xdgCache}); must be container-local (e.g. /container-user/.cache). Aborting.`)
    process.exit(1)
  }
  const opencodeServerEnv = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || "opencode-local",
  }
  const dirs = [
    `${homeDir}/.cache/opencode`,
    `${homeDir}/.config/opencode`,
  ]

  for (const dir of dirs) {
    try {
      await Bun.spawn(["mkdir", "-p", dir]).exited
      console.log(`[solo] Created container directory (if missing): ${dir}`)
    } catch (e) {
      console.warn(`[solo] WARNING: Could not create ${dir}: ${e}`)
      // Continue — some environments mount /home/opencode from host and
      // may deny directory creation for UID 1000; rely on downstream
      // processes to handle missing dirs when possible.
    }
  }

  console.log(`[solo] Using container directories: ${dirs.join(" and ")} (host-mounted directories left untouched)`)

  console.log(`[solo] Refreshing OpenCode models cache...`)
  const modelsRefresh = Bun.spawn(["opencode", "models", "--refresh"], {
    stdout: "inherit",
    stderr: "inherit",
    env: opencodeServerEnv,
  })

  const modelsRefreshed = await modelsRefresh.exited
  if (modelsRefreshed !== 0) {
    console.error(`[solo] ERROR: Failed to refresh OpenCode models cache (exit ${modelsRefreshed})`)
    process.exit(1)
  }

  console.log(`[solo] Starting OpenCode API server on port ${API_PORT}...`)

  const apiProc = Bun.spawn(["opencode", "serve", "--port", `${API_PORT}`, "--hostname", "127.0.0.1"], {
    stdout: "inherit",
    stderr: "inherit",
    env: opencodeServerEnv,
  })

  const serverPassword = opencodeServerEnv.OPENCODE_SERVER_PASSWORD
  proxyAuthHeader = serverPassword
    ? `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`
    : undefined

  const apiReady = await (async () => {
    const headers: Record<string, string> = {}
    if (proxyAuthHeader) headers["Authorization"] = proxyAuthHeader
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${API_PORT}/health`, { headers })
        if (res.ok) return true
      } catch (_) { void _ }
      await Bun.sleep(1000)
    }
    return false
  })()

  if (!apiReady) {
    console.error("[solo] ERROR: OpenCode API server failed to start within 30 seconds")
    apiProc.kill()
    process.exit(1)
  }

  console.log(`[solo] OpenCode API server is ready`)

  process.on("exit", () => apiProc.kill())
  process.on("SIGINT", () => { apiProc.kill(); process.exit(0) })
  process.on("SIGTERM", () => { apiProc.kill(); process.exit(0) })
} else {
  console.log(`[ui-only] Skipping API server startup; expecting external API at ${API_URL}`)
}
const WS_API_URL = API_URL.replace(/^http/, "ws")
const DIST_DIR = process.env.DIST_DIR || "/opt/opencode-ui/dist"
const BRANDING_NAME = process.env.BRANDING_NAME || ""
const BRANDING_URL = process.env.BRANDING_URL || ""
const BRANDING_ICON = process.env.BRANDING_ICON || ""
const serverStartTime = Date.now()

console.log(`OpenCode UI Server starting...`)
console.log(`  BASE_PATH: ${BASE_PATH}`)
console.log(`  API_URL: ${API_URL}`)
console.log(`  WS_API_URL: ${WS_API_URL}`)
console.log(`  PORT: ${PORT}`)
console.log(`  DIST_DIR: ${DIST_DIR}`)
if (BRANDING_NAME) console.log(`  BRANDING: ${BRANDING_NAME}`)

// Normalize and validate base path (must be a valid path-only prefix)
function validateBasePath(path: string): string {
  // Must start with /, must not contain protocol or double slashes at start
  if (!path.startsWith("/") || path.includes("://") || path.startsWith("//")) {
    console.warn(`[WARN] Invalid BASE_PATH "${path}", falling back to "/"`)
    return "/"
  }
  // Remove HTML-sensitive characters and collapse multiple slashes
  const sanitized = path.replace(/[<>"'&]/g, "").replace(/\/+/g, "/")
  return sanitized || "/"
}
const validatedBasePath = validateBasePath(BASE_PATH)
const basePathWithoutTrailing = validatedBasePath.endsWith("/") ? validatedBasePath.slice(0, -1) : validatedBasePath
const basePathWithTrailing = validatedBasePath.endsWith("/") ? validatedBasePath : validatedBasePath + "/"

// MIME types for static files
const mimeTypes: Record<string, string> = {
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
  map: "application/json",
}

// Check if this is a PTY WebSocket connection request
function isPtyWebSocket(path: string): boolean {
  return /^\/pty\/[^/]+\/connect/.test(path)
}

// Track last non-polling activity for Kubeflow idle culling
let lastActivity = Date.now()

// Track WebSocket connections: client ws -> backend ws
const wsConnections = new Map<object, WebSocket>()

const server = Bun.serve<{ target: string }>({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 0, // Disable timeout for SSE connections

  async fetch(req, server) {
    const url = new URL(req.url)
    let path = url.pathname

    // Strip base path prefix if present
    if (basePathWithoutTrailing && path.startsWith(basePathWithoutTrailing)) {
      path = path.slice(basePathWithoutTrailing.length) || "/"
    }
    if (!path.startsWith("/")) {
      path = "/" + path
    }

    // Kubeflow idle culling: /api/kernels must never update activity timestamp
    if (path === "/api/kernels") {
      if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } })
      }
      const idle = Date.now() - lastActivity >= 60_000
      const kernel = {
        id: "opencode-activity",
        name: "opencode",
        last_activity: new Date(lastActivity).toISOString(),
        execution_state: idle ? "idle" : "busy",
        connections: 0,
      }
      return new Response(JSON.stringify([kernel]), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      })
    }

    // Update activity timestamp for all non-polling requests
    lastActivity = Date.now()

    // Handle WebSocket upgrade for PTY connections
    if (isPtyWebSocket(path)) {
      const upgradeHeader = req.headers.get("Upgrade")
      if (upgradeHeader?.toLowerCase() === "websocket") {
        const target = WS_API_URL + path + url.search
        console.log("[Proxy] WebSocket upgrade for PTY:", target)
        const success = server.upgrade(req, {
          data: { target },
        })
        if (success) {
          return undefined // Bun handles the response
        }
        return new Response("WebSocket upgrade failed", { status: 500 })
      }
    }

    // Extended API endpoints (handled locally, not proxied)
    const extResponse = await handleExtendedEndpoint(path, req.method, url, req)
    if (extResponse) return extResponse

    // Check if this is an API request (after stripping prefix)
    if (isApiPath(path)) {
      const target = new URL(path + url.search, API_URL)
      const headers = new Headers(req.headers)

      // Add auth header for API proxy in solo mode
      if (proxyAuthHeader) {
        headers.set("Authorization", proxyAuthHeader)
      }

      // SSE requests need special handling
      if (path.startsWith("/event")) {
        console.log("[Proxy] SSE request to:", target.toString())
        try {
          const response = await fetch(target.toString(), {
            method: req.method,
            headers,
          })

          if (!response.ok) {
            console.error("[Proxy] SSE error:", response.status, response.statusText)
            return new Response(response.body, { status: response.status })
          }

          return new Response(response.body, {
            status: response.status,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          })
        } catch (e) {
          console.error("[Proxy] SSE connection error:", e)
          return new Response("SSE proxy error", { status: 502 })
        }
      }

      // Regular API requests
      console.log("[Proxy] API:", req.method, path)
      try {
        return await fetch(target.toString(), {
          method: req.method,
          headers,
          body: req.body,
        })
      } catch (e) {
        console.error("[Proxy] API error:", e)
        return new Response("API proxy error", { status: 502 })
      }
    }

    // Frontend routes - path is already stripped above
    // Try to serve static file
    const filePath = `${DIST_DIR}${path}`
    const file = Bun.file(filePath)

    if (await file.exists()) {
      const ext = path.split(".").pop()?.toLowerCase() || ""
      const contentType = mimeTypes[ext] || "application/octet-stream"

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      })
    }

    // Fallback: serve index.html for SPA routing
    if (path === "/" || !path.includes(".")) {
      const indexFile = Bun.file(`${DIST_DIR}/index.html`)
      if (await indexFile.exists()) {
        let html = await indexFile.text()
        const cacheBuster = `?v=${serverStartTime}`
        html = html.replace('src="./entry.js"', `src="./entry.js${cacheBuster}"`)
        html = html.replace('href="./entry.css"', `href="./entry.css${cacheBuster}"`)
        // Inject NB_PREFIX at runtime
        html = html.replace(/__NB_PREFIX__/g, validatedBasePath)
        if (BRANDING_NAME) html = html.replace(/__BRANDING_NAME__/g, BRANDING_NAME)
        if (BRANDING_URL) html = html.replace(/__BRANDING_URL__/g, BRANDING_URL)
        if (BRANDING_ICON) html = html.replace(/__BRANDING_ICON__/g, BRANDING_ICON)
        return new Response(html, {
          headers: {
            "Content-Type": "text/html",
          },
        })
      }
    }

    // Not found
    return new Response("Not Found", { status: 404 })
  },

  websocket: {
    open(ws) {
      const target = ws.data.target
      console.log("[Proxy] WebSocket client connected, connecting to backend:", target)

      const backend = new WebSocket(target)

      backend.addEventListener("open", () => {
        console.log("[Proxy] Backend WebSocket connected")
      })

      backend.addEventListener("message", (event) => {
        if (ws.readyState === 1) {
          ws.send(event.data)
        }
      })

      backend.addEventListener("close", (event) => {
        console.log("[Proxy] Backend WebSocket closed:", event.code)
        wsConnections.delete(ws)
        if (ws.readyState === 1) {
          ws.close(event.code, event.reason)
        }
      })

      backend.addEventListener("error", (e) => {
        console.error("[Proxy] Backend WebSocket error:", e)
      })

      wsConnections.set(ws, backend)
    },
    message(ws, message) {
      const backend = wsConnections.get(ws)
      if (backend?.readyState === WebSocket.OPEN) {
        backend.send(message)
      }
    },
    close(ws, code, reason) {
      console.log("[Proxy] Client WebSocket closed:", code)
      const backend = wsConnections.get(ws)
      if (backend) {
        backend.close(code, reason)
        wsConnections.delete(ws)
      }
    },
  },
})
