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


import { handleExtendedEndpoint, handleSkillEndpoint, isApiPath } from "../shared/extended-api"
import { loadCopilotModelMultipliers } from "../shared/copilot-model-multipliers"
import { loadAnthropicPricing } from "../shared/anthropic-pricing"
import { loadOpenAIPricing } from "../shared/openai-pricing"
import { resolveProxyAuthHeader } from "../shared/proxy-auth-session"
import nodePath from "path"
// Decompression for proxied responses
let zlib: any
try {
  // Bun/Node compatible require
  // @ts-ignore
  zlib = require("zlib")
} catch (e) {
  zlib = null
}

const BASE_PATH = process.env.NB_PREFIX || process.env.BASE_PATH || "/"
const PORT = parseInt(process.env.PORT || "8080", 10)
const API_PORT = parseInt(process.env.OPENCODE_API_PORT || process.env.API_PORT || "4096", 10)
const API_URL = process.env.API_URL || `http://127.0.0.1:${API_PORT}`
const OPERATION_MODE = process.env.OPERATION_MODE || "solo"
const PROXY_REQUEST_TIMEOUT_MS = parseInt(process.env.PROXY_REQUEST_TIMEOUT_MS || "120000", 10)
const PROXY_SSE_CONNECT_TIMEOUT_MS = parseInt(process.env.PROXY_SSE_CONNECT_TIMEOUT_MS || "10000", 10)

function isForbiddenHostPath(p: string): boolean {
  const norm = nodePath.resolve(p.replace(/\\/g, '/'))

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
  const workspaceDir = process.env.OPENCODE_WORKSPACE_ROOT || homeDir
  const xdgCache = process.env.XDG_CACHE_HOME
  // Root/host path & non-root checks
  if (!homeDir) {
    console.error("[solo] ERROR: HOME environment variable is not set. Cannot proceed without a home directory for container-local cache and config.")
    process.exit(1)
  }

  if (!workspaceDir) {
    console.error("[solo] ERROR: Could not determine a workspace directory. Set OPENCODE_WORKSPACE_ROOT or HOME.")
    process.exit(1)
  }

  if (isForbiddenHostPath(homeDir)) {
    console.error(`[solo] ERROR: HOME env points to forbidden host location (${homeDir}); must be a container-local path (e.g. /container-user). Aborting.`)
    process.exit(1)
  }
  if (isForbiddenHostPath(workspaceDir)) {
    console.error(`[solo] ERROR: Workspace root points to forbidden host location (${workspaceDir}); must be a container-local path. Aborting.`)
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
    HOME: homeDir,
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

  const mcpConfigPath = `${homeDir}/.config/opencode/opencode.json`
  const existingConfig = await Bun.file(mcpConfigPath).text().catch(() => "")
  const config = existingConfig ? JSON.parse(existingConfig) : {}
  config.mcp ??= {}
  config.mcp.playwright = {
    ...config.mcp.playwright,
    type: "local",
    command: ["bun", "/opt/opencode-ui/scripts/playwright-mcp-cloakbrowser.mjs"],
    enabled: true,
  }

  await Bun.write(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`[solo] Merged Playwright MCP CloakBrowser config: ${mcpConfigPath}`)

  console.log(`[solo] Refreshing OpenCode models cache...`)
  const modelsRefresh = Bun.spawn(["opencode", "models", "--refresh"], {
    stdout: "inherit",
    stderr: "inherit",
    env: opencodeServerEnv,
    cwd: workspaceDir,
  })

  const modelsRefreshed = await modelsRefresh.exited
  if (modelsRefreshed !== 0) {
    console.error(`[solo] ERROR: Failed to refresh OpenCode models cache (exit ${modelsRefreshed})`)
    process.exit(1)
  }

  console.log(`[solo] Starting OpenCode API server on port ${API_PORT}...`)

  const apiProc = Bun.spawn(["opencode", "serve", "--port", `${API_PORT}`, "--hostname", process.env.API_HOSTNAME || "127.0.0.1"], {
    stdout: "inherit",
    stderr: "inherit",
    env: opencodeServerEnv,
    cwd: workspaceDir,
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
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(`http://127.0.0.1:${API_PORT}/global/health`, { headers, signal: controller.signal })
        clearTimeout(timer)
        if (res.ok) return true
        console.log(`[solo] Health check attempt ${i + 1}: status ${res.status}`)
      } catch (e) {
        console.log(`[solo] Health check attempt ${i + 1}: ${e}`)
      }
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
const [copilotModelMultipliers, openaiPricing, anthropicPricing] = await Promise.all([
  loadCopilotModelMultipliers(),
  loadOpenAIPricing(),
  loadAnthropicPricing(),
])

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

function getTargetOverride(req: Request, url: URL): string | undefined {
  const target = req.headers.get("x-opencode-target") || url.searchParams.get("target")
  if (!target) return undefined
  try {
    const parsed = new URL(target)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function buildUpstreamUrl(path: string, url: URL, req: Request, protocol: "http" | "ws" = "http") {
  const upstream = new URL(getTargetOverride(req, url) || API_URL)
  if (protocol === "ws") {
    upstream.protocol = upstream.protocol === "https:" ? "wss:" : "ws:"
  }
  const search = new URLSearchParams(url.search)
  search.delete("target")
  const query = search.toString()
  const base = upstream.toString().endsWith("/") ? upstream.toString() : `${upstream.toString()}/`
  return new URL(`.${path}${query ? `?${query}` : ""}`, base)
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost"
}

function shouldAttachProxyAuth(target: URL) {
  if (!proxyAuthHeader) return false
  const apiTarget = new URL(API_URL)
  if (target.origin === apiTarget.origin) return true
  return target.port === apiTarget.port && isLoopbackHost(target.hostname) && isLoopbackHost(apiTarget.hostname)
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError"
}

function timeoutMessage(label: string, timeoutMs: number) {
  return `${label} timed out after ${Math.round(timeoutMs / 1000)}s`
}

async function fetchWithTimeout(target: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController()
  const timedOut = { value: false }
  const timer = setTimeout(() => {
    timedOut.value = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(target, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut.value || isAbortError(error)) {
      throw new Error(timeoutMessage(label, timeoutMs))
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readBodyWithTimeout(response: Response, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      response.arrayBuffer(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage(label, timeoutMs))), timeoutMs)
      }),
    ])
  } catch (error) {
    response.body?.cancel().catch(() => {})
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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

const COMPRESSIBLE = new Set([
  "application/javascript",
  "text/css",
  "text/html",
  "application/json",
  "image/svg+xml",
  "text/plain",
])

async function maybeGzip(req: Request, body: Uint8Array | string, contentType: string, extraHeaders: Record<string, string>): Promise<Response> {
  const acceptEncoding = req.headers.get("Accept-Encoding") || ""
  if (zlib && acceptEncoding.includes("gzip") && COMPRESSIBLE.has(contentType.split(";")[0].trim())) {
    const input = typeof body === "string" ? Buffer.from(body, "utf8") : body
    const compressed = zlib.gzipSync(input)
    return new Response(compressed, {
      headers: {
        ...extraHeaders,
        "Content-Encoding": "gzip",
        "Content-Length": String(compressed.byteLength),
        "Vary": "Accept-Encoding",
      },
    })
  }
  return new Response(body, { headers: extraHeaders })
}

// Check if this is a PTY WebSocket connection request
function isPtyWebSocket(path: string): boolean {
  return /^\/pty\/[^/]+\/connect/.test(path)
}

// Track last non-polling activity for Kubeflow idle culling
let lastActivity = Date.now()

// Track WebSocket connections: client ws -> backend ws
const wsConnections = new Map<object, WebSocket>()

const server = Bun.serve<{ target: string; cookie: string }>({
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
        const target = buildUpstreamUrl(path, url, req, "ws").toString()
        console.log("[Proxy] WebSocket upgrade for PTY:", target)
        const success = server.upgrade(req, {
          data: { target, cookie: req.headers.get("cookie") || "" },
        })
        if (success) {
          return undefined // Bun handles the response
        }
        return new Response("WebSocket upgrade failed", { status: 500 })
      }
    }

    // Extended API endpoints (handled locally, not proxied)
    const extResponse = await handleExtendedEndpoint(path, req.method, url, req, {
      resolveUpstreamAuthHeader: (target) => {
        const syncedAuth = resolveProxyAuthHeader(req, target)
        if (syncedAuth) return syncedAuth
        if (!shouldAttachProxyAuth(new URL(target))) return undefined
        return proxyAuthHeader
      },
    })
    if (extResponse) return extResponse

    const skillResponse = await handleSkillEndpoint(path, req.method, url, {
      fetchUpstreamSkills: () => fetch(buildUpstreamUrl(path, url, req).toString()),
    })
    if (skillResponse) return skillResponse

    // Check if this is an API request (after stripping prefix)
    if (isApiPath(path)) {
      const targetOverride = getTargetOverride(req, url)
      const target = buildUpstreamUrl(path, url, req)
      const headers = new Headers(req.headers)
      const syncedAuth = resolveProxyAuthHeader(req, target.toString())
      if (syncedAuth) {
        headers.set("Authorization", syncedAuth)
      }

      // Add auth header for API proxy in solo mode
      if (!syncedAuth && shouldAttachProxyAuth(target)) {
        headers.set("Authorization", proxyAuthHeader)
      }

      headers.delete("x-opencode-target")
      headers.delete("Accept-Encoding")

      // Forward the original Host header and proxy metadata so the backend
      // can construct correct public URLs (for OAuth callbacks/redirects)
      // and validate CORS origins when accessed from remote machines.
      headers.set("Host", url.host)
      headers.set("X-Forwarded-Host", url.host)
      headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""))
      headers.set("X-Forwarded-For", req.headers.get("X-Forwarded-For") || url.hostname)

      // SSE requests need special handling
      if (path.startsWith("/event")) {
        console.log("[Proxy] SSE request to:", target.toString())
        try {
          const response = await fetchWithTimeout(target.toString(), {
            method: req.method,
            headers,
          }, PROXY_SSE_CONNECT_TIMEOUT_MS, `SSE upstream ${path}`)

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
          const message = e instanceof Error ? e.message : String(e)
          return new Response(message, { status: message.includes("timed out") ? 504 : 502 })
        }
      }

      // Regular API requests
      console.log("[Proxy] API:", req.method, path)
      try {
        // Disable HTTP keep-alive for upstream connections to prevent
        // Bun's connection pool from accumulating idle connections and
        // deadlocking when the pool grows large (256+ connections).
        headers.set("Connection", "close")
        const response = await fetchWithTimeout(target.toString(), {
          method: req.method,
          headers,
          body: req.body,
        }, PROXY_REQUEST_TIMEOUT_MS, `API upstream ${path}`)

        // Always materialize upstream response bytes for non-SSE API requests.
        // This prevents Bun from re-compressing streamed responses and allows
        // us to explicitly set Content-Length after optional decompression.
        const raw = Buffer.from(await readBodyWithTimeout(response, PROXY_REQUEST_TIMEOUT_MS, `API response body ${path}`))
        let bodyToReturn: Buffer | Uint8Array = raw

        const encoding = (response.headers.get("content-encoding") || "").toLowerCase()
        let responseEncoding = ""

        try {
          if (encoding) {
            if (encoding.includes("gzip") || encoding.includes("x-gzip")) {
              if (!zlib) throw new Error("zlib not available for gzip decompression")
              if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
                bodyToReturn = zlib.gunzipSync(raw)
                console.log(`[Proxy] decompressed response for: ${path} (${encoding})`)
              } else {
                console.warn('[Proxy] claimed gzip but body lacks gzip magic, skipping gunzip for:', path)
                bodyToReturn = raw
              }
            } else if (encoding.includes("deflate")) {
              if (!zlib) throw new Error("zlib not available for deflate decompression")
              try {
                bodyToReturn = zlib.inflateSync(raw)
                console.log(`[Proxy] decompressed response for: ${path} (${encoding})`)
              } catch (inflateErr) {
                console.warn('[Proxy] deflate decompression failed, returning raw bytes for:', path)
                bodyToReturn = raw
                responseEncoding = encoding
              }
            } else if (encoding.includes("br")) {
              if (zlib && typeof zlib.brotliDecompressSync === "function") {
                try {
                  bodyToReturn = zlib.brotliDecompressSync(raw)
                  console.log(`[Proxy] decompressed response for: ${path} (br)`)
                } catch (brErr) {
                  console.warn('[Proxy] Brotli decompression failed, returning raw bytes for:', path)
                  bodyToReturn = raw
                  responseEncoding = encoding
                }
              } else {
                console.warn(`[Proxy] Brotli (br) encoded response received but Brotli decompression is unavailable. Returning original compressed body for: ${path}`)
                bodyToReturn = raw
                responseEncoding = encoding
              }
            } else {
              bodyToReturn = raw
            }
          }
        } catch (decompErr) {
          console.warn('[Proxy] decompression error, returning raw bytes for:', path)
          bodyToReturn = raw
        }

        const responseHeaders = new Headers(response.headers)
        responseHeaders.delete("content-encoding")
        responseHeaders.delete("transfer-encoding")
        responseHeaders.delete("content-length")
        if (responseEncoding) {
          responseHeaders.set("content-encoding", responseEncoding)
        }

        try {
          const length = (bodyToReturn && (bodyToReturn.byteLength ?? bodyToReturn.length)) || 0
          responseHeaders.set("Content-Length", String(length))
        } catch (e) {
          console.warn("[Proxy] could not determine response byte length:", e)
        }

        return new Response(bodyToReturn, {
          status: response.status,
          headers: responseHeaders,
        })
      } catch (e) {
        console.error("[Proxy] API error:", e)
        const message = e instanceof Error ? e.message : String(e)
        return new Response(message, { status: message.includes("timed out") ? 504 : 502 })
      }
    }

    // Frontend routes - path is already stripped above
    // Try to serve static file — guard against path traversal
    const filePath = nodePath.resolve(DIST_DIR, "." + path)
    if (!filePath.startsWith(DIST_DIR + "/") && filePath !== DIST_DIR) {
      return new Response("Forbidden", { status: 403 })
    }
    const file = Bun.file(filePath)

    if (await file.exists()) {
      const ext = path.split(".").pop()?.toLowerCase() || ""
      const contentType = mimeTypes[ext] || "application/octet-stream"

      // esbuild generates content-hashed chunk filenames (e.g. chunk-ABC123.js, abap-JFJQJ6PR.js).
      // These are safe to cache indefinitely. Entry points are cache-busted via ?v=
      // query param by the server, so they get no-cache.
      const isHashedAsset = /-[a-zA-Z0-9]{6,}\.(js|css|woff2?|ttf|eot)$/.test(path)
      const cacheControl = isHashedAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache"

      if (COMPRESSIBLE.has(contentType.split(";")[0].trim())) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        return maybeGzip(req, bytes, contentType, {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        })
      }

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
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
        // Inject branding config as a JSON object to avoid HTML/JS injection
        const brandingConfig = {
          name: BRANDING_NAME || "",
          url: BRANDING_URL || "",
          icon: BRANDING_ICON || "",
        }
        const opencodeConfig = {
          basePath: validatedBasePath,
          branding: brandingConfig,
          copilotModelMultipliers: copilotModelMultipliers.models,
          openaiPricing: openaiPricing.models,
          anthropicPricing: anthropicPricing.models,
        }
        html = html.replace("window.__OPENCODE__ = window.__OPENCODE__ || {}", `window.__OPENCODE__ = ${JSON.stringify(opencodeConfig)}`)
        html = html.replace(/__BRANDING_CONFIG__/g, JSON.stringify(brandingConfig))
        html = html.replace(/__DEFAULT_SERVER_URL__/g, API_URL.replace(/"/g, ""))
        return maybeGzip(req, html, "text/html", {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
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

      const authTarget = target.replace(/^ws:/, "http:").replace(/^wss:/, "https:")
      const authReq = new Request("http://localhost/", {
        headers: ws.data.cookie ? { cookie: ws.data.cookie } : {},
      })
      const syncedAuth = resolveProxyAuthHeader(authReq, authTarget)
      const shouldSendAuth = shouldAttachProxyAuth(new URL(authTarget))
      const fallbackAuth = shouldSendAuth ? proxyAuthHeader : undefined
      const auth = syncedAuth || fallbackAuth
      const backend = new WebSocket(target, auth ? { headers: { Authorization: auth } } : undefined)

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
