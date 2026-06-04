/**
 * Extended API endpoints
 *
 * These endpoints are handled directly by the UI server (dev.ts / serve-ui.ts),
 * NOT proxied to the OpenCode backend. This allows us to add features without
 * modifying upstream code.
 */

import * as fs from "node:fs"
import * as nodePath from "node:path"
import * as os from "node:os"
import { clearProxyAuthSession, syncProxyAuthSession } from "./proxy-auth-session"
import { clearProviderAuthSession, getProviderIDCandidates, resolveProviderAuthAccountId, resolveProviderAuthHeader, syncProviderAuthSession } from "./provider-auth-session"
import { readLocalSkills } from "./skill-discovery"
import { skillSourcePathFromLocation } from "../app-prefixable/src/utils/skill-discovery"

const OPENCODE_RESTART_COMMAND = ["/package/admin/s6/command/s6-svc", "-r", "/run/service/opencode/"]

type ExtendedEndpointOptions = {
  resolveUpstreamAuthHeader?: (target: string) => string | undefined
  getUpstreamBaseUrl?: () => string | undefined
}

type SkillEndpointOptions = {
  fetchUpstreamSkills: () => Promise<Response>
}

function isLocalSkillLocation(location: string): boolean {
  const value = location.trim()
  if (!value || value === "<built-in>") return false
  if (value.startsWith("http://") || value.startsWith("https://")) return false
  if (value.startsWith("file://")) return true
  return true
}

function uniqueSkillList(items: { location: string; name: string; description: string }[]): { location: string; name: string; description: string }[] {
  const seen = new Set<string>()
  const next: { location: string; name: string; description: string }[] = []

  for (const item of items) {
    const key = item.location.trim() || `${item.name}:${item.description}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }

  return next
}

export async function handleSkillEndpoint(
  path: string,
  method: string,
  url: URL,
  options: SkillEndpointOptions,
): Promise<Response | undefined> {
  if (path !== "/skill" || method !== "GET") return undefined

  const upstream = await options.fetchUpstreamSkills().catch(() => null)
  const upstreamSkills = upstream?.ok ? await upstream.json().catch(() => []) : []
  const localSkills = await readLocalSkills(url.searchParams.get("directory") || undefined)

  const remoteSkills = Array.isArray(upstreamSkills)
    ? upstreamSkills.filter((skill): skill is { name: string; description: string; location: string; content: string } => {
      if (!skill || typeof skill !== "object") return false
      const item = skill as Record<string, unknown>
      const location = typeof item.location === "string" ? item.location : ""
      return !isLocalSkillLocation(location)
    })
    : []

  return Response.json(uniqueSkillList([...remoteSkills, ...localSkills]))
}

function getAuthFileCandidates(): string[] {
  const home = process.env.HOME || os.homedir()
  const dataHome = process.env.XDG_DATA_HOME
  const candidates = [
    dataHome ? nodePath.join(dataHome, "opencode", "auth.json") : "",
    nodePath.join(home, ".local", "share", "opencode", "auth.json"),
    nodePath.join(home, ".config", "opencode", "auth.json"),
    nodePath.join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
  return candidates.filter(Boolean)
}

async function readAuthFile(): Promise<Record<string, unknown> | undefined> {
  for (const file of getAuthFileCandidates()) {
    try {
      const text = await fs.promises.readFile(file, "utf-8")
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return undefined
}

function getAuthEntry(data: Record<string, unknown>, providerID: string): unknown {
  for (const id of getProviderIDCandidates(providerID)) {
    if (id in data) {
      return data[id]
    }

    const nested = data.providers
    if (nested && typeof nested === "object" && id in nested) {
      return (nested as Record<string, unknown>)[id]
    }
  }

  return undefined
}

function toAuthHeader(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined
  const raw = entry as Record<string, unknown>
  const nested = raw.auth && typeof raw.auth === "object" ? raw.auth as Record<string, unknown> : undefined

  const read = (obj?: Record<string, unknown>) => {
    if (!obj) return ""
    const header = typeof obj.authHeader === "string" ? obj.authHeader.trim() : ""
    if (header) return header

    const access = typeof obj.access === "string" ? obj.access.trim() : ""
    if (access) return `Bearer ${access}`

    const token = typeof obj.accessToken === "string" ? obj.accessToken.trim() : ""
    if (token) return `Bearer ${token}`

    const key = typeof obj.key === "string" ? obj.key.trim() : ""
    if (key) return `Bearer ${key}`

    const bearer = typeof obj.token === "string" ? obj.token.trim() : ""
    if (bearer) return `Bearer ${bearer}`

    return ""
  }

  const header = read(raw) || read(nested)
  if (header) return header

  return undefined
}

function toAccountId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined
  const raw = entry as Record<string, unknown>
  const nested = raw.auth && typeof raw.auth === "object" ? raw.auth as Record<string, unknown> : undefined

  const read = (obj?: Record<string, unknown>) => {
    if (!obj) return ""
    return typeof obj.accountId === "string" ? obj.accountId.trim() : ""
  }

  const accountId = read(raw) || read(nested)
  return accountId || undefined
}

async function syncProviderAuthFromBackend(req: Request, target: string, providerID: string): Promise<Response> {
  const auth = await readAuthFile()
  if (!auth) {
    return Response.json({ ok: false, error: "backend auth file not found" }, { status: 404 })
  }

  const entry = getAuthEntry(auth, providerID)
  const authHeader = toAuthHeader(entry)
  if (!authHeader) {
    return Response.json({ ok: false, error: "provider auth not found" }, { status: 404 })
  }
  const accountId = toAccountId(entry)

  return syncProviderAuthSession(req, target, { providerID, authHeader, accountId })
}

const OAUTH_CALLBACK_PORT = 1455

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal"
}

function mergeFragmentParams(url: URL): void {
  if (!url.hash) return

  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  if (!fragment) {
    url.hash = ""
    return
  }

  const fragmentParams = new URLSearchParams(fragment)
  for (const [key, value] of fragmentParams) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
  }

  url.hash = ""
}

function buildOAuthReplayUrl(callbackUrl: string, target?: string): string | null {
  try {
    const callback = new URL(callbackUrl.trim())
    const targetUrl = target ? new URL(target.trim()) : undefined
    if (callback.protocol !== "http:" && callback.protocol !== "https:") {
      return null
    }
    if (targetUrl && targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return null
    }
    if (!isLoopbackHost(callback.hostname)) return null

    mergeFragmentParams(callback)
    if (!callback.searchParams.get("code")) return null
    if (!callback.searchParams.get("state")) return null

    callback.protocol = "http:"
    callback.hostname = targetUrl?.hostname || callback.hostname
    callback.port = callback.port || String(OAUTH_CALLBACK_PORT)
    return callback.toString()
  } catch {
    return null
  }
}

async function replayProviderOAuthCallback(target: string | undefined, providerID: string, callbackUrl: string): Promise<Response> {
  const replayUrl = buildOAuthReplayUrl(callbackUrl, target)
  if (!replayUrl) {
    return Response.json({ ok: false, error: "invalid callbackUrl" }, { status: 400 })
  }

  const fetchReplay = async (url: string): Promise<Response> => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
    const error = res.ok ? undefined : await readResponseError(res)
    return Response.json(
      {
        ok: res.ok,
        providerID,
        status: res.status,
        error: error || undefined,
      },
      { status: res.ok ? 200 : res.status },
    )
  }

  try {
    return await fetchReplay(replayUrl)
  } catch (e) {
    try {
      const fallback = new URL(replayUrl)
      if (isLoopbackHost(fallback.hostname)) {
        fallback.hostname = "host.docker.internal"
        return await fetchReplay(fallback.toString())
      }
    } catch {
      // Fall through to original error handling.
    }

    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ ok: false, providerID, error: message }, { status: message.includes("timed out") ? 504 : 502 })
  }
}

function getGlobalConfigCandidates(): string[] {
  const homeDir = process.env.HOME || os.homedir()
  const configDir = process.env.OPENCODE_CONFIG_DIR || nodePath.join(homeDir, ".config", "opencode")
  return [nodePath.join(configDir, "opencode.jsonc"), nodePath.join(configDir, "opencode.json"), nodePath.join(configDir, "config.json")]
}

function parseGlobalConfig(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const jsonContent = text
      .split("\n")
      .map((line) => {
        const commentMatch = line.match(/^([^"]*(?:"[^"]*"[^"]*)*)\s*\/\//)
        if (commentMatch) return commentMatch[1]
        return line
      })
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")

    return JSON.parse(jsonContent) as Record<string, unknown>
  }
}

async function deleteGlobalProviderFromFile(providerID: string): Promise<Response> {
  const candidates = getGlobalConfigCandidates()
  const existing = candidates.filter((file) => fs.existsSync(file))
  if (existing.length === 0) {
    return Response.json({ error: "Config file not found" }, { status: 404 })
  }

  try {
    let updated = false

    for (const configPath of existing) {
      const content = await fs.promises.readFile(configPath, "utf-8")
      const config = parseGlobalConfig(content)
      const provider = config.provider as Record<string, unknown> | undefined
      if (!provider || !provider[providerID]) continue

      delete provider[providerID]
      if (Object.keys(provider).length === 0) {
        delete config.provider
      }

      // Write with trailing newline so backend detects change when updateGlobal({}) is called,
      // which triggers cache invalidation and instance disposal.
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2) + "\n")
      updated = true
    }

    if (!updated) {
      return Response.json({ error: "Provider not found in config" }, { status: 404 })
    }

    return Response.json({ success: true })
  } catch (e) {
    console.error("[ExtAPI] global provider delete error:", e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

type ProviderValidateModel = {
  id?: string
  name?: string
}

function readResponseErrorBody(body: unknown): string | undefined {
  if (!body) return undefined
  if (typeof body === "string") return body.trim() || undefined
  if (typeof body !== "object") return undefined

  const raw = body as Record<string, unknown>
  const error = raw.error
  if (typeof error === "string" && error.trim()) return error.trim()
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>
    const message = typeof nested.message === "string" ? nested.message.trim() : ""
    if (message) return message
  }

  const message = typeof raw.message === "string" ? raw.message.trim() : ""
  if (message) return message

  const detail = typeof raw.detail === "string" ? raw.detail.trim() : ""
  if (detail) return detail

  if (Array.isArray(raw.errors)) {
    for (const item of raw.errors) {
      if (!item || typeof item !== "object") continue
      const nested = item as Record<string, unknown>
      const nestedMessage = typeof nested.message === "string" ? nested.message.trim() : ""
      if (nestedMessage) return nestedMessage
    }
  }

  return undefined
}

async function readResponseError(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "")
  if (!text) return undefined

  try {
    return readResponseErrorBody(JSON.parse(text)) || text.trim() || undefined
  } catch {
    return text.trim() || undefined
  }
}

function buildProviderModelsProbe(baseURL: string): string | undefined {
  const input = baseURL.trim()
  if (!input) return undefined

  try {
    const normalized = input.endsWith("/") ? input : `${input}/`
    const probe = new URL("models", normalized)
    if (probe.protocol !== "http:" && probe.protocol !== "https:") return undefined
    return probe.toString()
  } catch {
    return undefined
  }
}

/**
 * Validate that a path is safe (within allowed root, no traversal attacks).
 * Returns the normalized absolute path if valid, or null if invalid.
 */
function validatePath(inputPath: string, allowedRoot: string): string | null {
  // Resolve to absolute path
  const resolved = nodePath.resolve(allowedRoot, inputPath)
  const normalizedRoot = nodePath.resolve(allowedRoot)

  // Handle edge case where root is "/" (filesystem root)
  if (normalizedRoot === "/") {
    // When root is /, allow any absolute path (but still normalized)
    return resolved
  }

  // Check that resolved path is within allowed root (prevents ../ traversal).
  // Allow the allowed root itself as a valid target so callers can list the
  // configured workspace root directory (e.g. OPENCODE_WORKSPACE_ROOT or HOME).
  if (resolved === normalizedRoot) {
    return resolved
  }

  // Otherwise require resolved path to be inside the root (root + separator)
  if (!resolved.startsWith(normalizedRoot + nodePath.sep)) {
    return null
  }

  return resolved
}

/**
 * Validate that a server name contains only safe characters.
 * Prevents path traversal and other injection attacks.
 */
function isValidServerName(name: string): boolean {
  // Allow alphanumeric, hyphens, underscores, dots (but not starting with dot)
  // Reject empty strings, path separators, and traversal sequences
  if (!name || name.length === 0 || name.length > 100) return false
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false
  if (name.startsWith(".")) return false
  return /^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*$/.test(name)
}

function restartOpencodeService(): Response {
  try {
    setTimeout(() => {
      try {
        const proc = Bun.spawn(OPENCODE_RESTART_COMMAND, {
          stdout: "ignore",
          stderr: "ignore",
          env: process.env,
        })
        proc.exited.catch(() => {})
      } catch (e) {
        console.error("[ExtAPI] restart scheduling failed:", e)
      }
    }, 1500)

    return Response.json({ ok: true, message: "Restart scheduled" }, { status: 202 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.json(
      {
        ok: false,
        error: message.includes("ENOENT")
          ? "restart command is unavailable in this runtime"
          : message,
      },
      { status: 501 },
    )
  }
}

async function readOpencodeHealth(options?: ExtendedEndpointOptions): Promise<Response> {
  const baseUrl = options?.getUpstreamBaseUrl?.()?.trim() || process.env.API_URL || "http://127.0.0.1:4096"
  const target = new URL("/global/health", baseUrl)
  const headers = new Headers()
  const auth = options?.resolveUpstreamAuthHeader?.(baseUrl)
  if (auth) headers.set("Authorization", auth)

  try {
    const res = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      headers,
    })
    const data = await res.json().catch(() => null)
    return Response.json(
      {
        ok: res.ok && !!data && typeof data === "object" && (data as { healthy?: boolean }).healthy === true,
        healthy: !!data && typeof data === "object" && (data as { healthy?: boolean }).healthy === true,
        status: res.status,
        error: res.ok ? undefined : readResponseErrorBody(data) || res.statusText || `HTTP ${res.status}`,
      },
      { status: res.ok ? 200 : res.status },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ ok: false, healthy: false, error: message }, { status: message.includes("timed out") ? 504 : 502 })
  }
}

/**
 * Get the allowed root directory for filesystem operations.
 * Defaults to HOME directory.
 */
export function getAllowedRoot(): string {
  return process.env.OPENCODE_WORKSPACE_ROOT || process.env.HOME || os.homedir()
}

/**
 * API paths that should be proxied to the OpenCode API server.
 * Extended endpoints (/api/ext/*) are NOT in this list - they're handled separately.
 */
export const API_PATHS = [
  "/api",
  "/event",
  "/config",
  "/provider",
  "/project",
  "/permission",
  "/pty",
  "/mcp",
  "/file",
  "/health",
  "/path",
  "/command",
  "/auth",
  "/app",
  "/agent",
  "/session",
  "/global",
  "/skill",
  "/lsp",
  "/formatter",
  "/doc",
  "/log",
  "/instance",
  "/question",
  "/find",
  "/vcs",
]

/**
 * Check if a path should be proxied to the OpenCode API server.
 */
export function isApiPath(path: string): boolean {
  return API_PATHS.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"))
}

/**
 * Handle extended API endpoints.
 * Returns a Response if the path matches an extended endpoint, otherwise undefined.
 */
export async function handleExtendedEndpoint(
  path: string,
  method: string,
  url: URL,
  req: Request,
  options?: ExtendedEndpointOptions,
): Promise<Response | undefined> {
  // POST/PUT /api/ext/auth-session - Sync upstream credentials for target
  if (path === "/api/ext/auth-session" && (method === "POST" || method === "PUT")) {
    const body = await req.json().catch(() => null)
    return syncProxyAuthSession(req, body)
  }

  // DELETE /api/ext/auth-session?target=<url> - Clear upstream credentials for target
  if (path === "/api/ext/auth-session" && method === "DELETE") {
    const target = url.searchParams.get("target") || ""
    if (!target) {
      return Response.json({ error: "target parameter is required" }, { status: 400 })
    }
    return clearProxyAuthSession(req, target)
  }

  // POST /api/ext/provider-auth - Sync provider auth for the current target
  if (path === "/api/ext/provider-auth" && (method === "POST" || method === "PUT")) {
    const body = await req.json().catch(() => null)
    const target = url.searchParams.get("target") || ""
    return syncProviderAuthSession(req, target, body)
  }

  // POST /api/ext/provider-oauth/replay - Replay a pasted OAuth callback URL to the backend listener
  if (path === "/api/ext/provider-oauth/replay" && method === "POST") {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return Response.json({ ok: false, error: "invalid body" }, { status: 400 })
    }

    const raw = body as Record<string, unknown>
    const providerID = typeof raw.providerID === "string" ? raw.providerID.trim() : (url.searchParams.get("providerID") || "").trim()
    const callbackUrl = typeof raw.callbackUrl === "string" ? raw.callbackUrl.trim() : ""
    const target = url.searchParams.get("target") || undefined

    if (!providerID || !callbackUrl) {
      return Response.json({ ok: false, error: "providerID and callbackUrl are required" }, { status: 400 })
    }

    return replayProviderOAuthCallback(target, providerID, callbackUrl)
  }

  // DELETE /api/ext/global-provider?providerID=<id> - Remove a custom provider from global config
  if (path === "/api/ext/global-provider" && method === "DELETE") {
    const providerID = url.searchParams.get("providerID") || ""
    if (!providerID) {
      return Response.json({ error: "providerID parameter is required" }, { status: 400 })
    }
    return deleteGlobalProviderFromFile(providerID)
  }

  // POST /api/ext/opencode/restart - Restart the local s6-managed OpenCode service
  if (path === "/api/ext/opencode/restart" && method === "POST") {
    if (url.searchParams.has("target")) {
      return Response.json({ ok: false, error: "restart is local-only" }, { status: 400 })
    }

    return restartOpencodeService()
  }

  // GET /api/ext/opencode/health - Probe the real OpenCode backend health
  if (path === "/api/ext/opencode/health" && method === "GET") {
    if (url.searchParams.has("target")) {
      return Response.json({ ok: false, error: "health is local-only" }, { status: 400 })
    }

    return readOpencodeHealth(options)
  }

  // POST /api/ext/provider-validate - Validate an OpenAI-compatible custom provider without saving it
  if (path === "/api/ext/provider-validate" && method === "POST") {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return Response.json({ ok: false, error: "invalid body" }, { status: 400 })
    }

    const raw = body as Record<string, unknown>
    const providerID = typeof raw.providerID === "string" ? raw.providerID.trim() : ""
    const baseURL = typeof raw.baseURL === "string" ? raw.baseURL.trim() : ""
    const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : ""
    const models = Array.isArray(raw.models)
      ? raw.models
          .map((item) => {
            if (!item || typeof item !== "object") return undefined
            const model = item as ProviderValidateModel
            const id = typeof model.id === "string" ? model.id.trim() : ""
            const name = typeof model.name === "string" ? model.name.trim() : ""
            if (!id) return undefined
            return { id, name }
          })
          .filter((item): item is { id: string; name: string } => !!item)
      : []

    if (!baseURL) {
      return Response.json({ ok: false, error: "baseURL is required" }, { status: 400 })
    }
    if (!apiKey) {
      return Response.json({ ok: false, error: "apiKey is required" }, { status: 400 })
    }

    const probe = buildProviderModelsProbe(baseURL)
    if (!probe) {
      return Response.json({ ok: false, error: "invalid baseURL" }, { status: 400 })
    }

    try {
      const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      })

      const res = await fetch(probe, {
        signal: AbortSignal.timeout(8000),
        headers,
      })

      const error = res.ok ? undefined : await readResponseError(res)
      return Response.json({
        ok: res.ok,
        reachable: true,
        providerID: providerID || undefined,
        url: probe,
        status: res.status,
        message: res.ok ? "Connection succeeded" : undefined,
        error: res.ok ? undefined : error || res.statusText || "provider validation failed",
        modelsChecked: models.length,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return Response.json({
        ok: false,
        reachable: false,
        providerID: providerID || undefined,
        error: msg,
      })
    }
  }

  // POST /api/ext/provider-auth/from-backend - Sync provider auth from the OpenCode backend auth store
  if (path === "/api/ext/provider-auth/from-backend" && method === "POST") {
    const providerID = url.searchParams.get("providerID") || ""
    const target = url.searchParams.get("target") || ""
    if (!providerID || !target) {
      return Response.json({ error: "target and providerID parameters are required" }, { status: 400 })
    }
    return syncProviderAuthFromBackend(req, target, providerID)
  }

  // DELETE /api/ext/provider-auth?target=<url>&providerID=<id> - Clear provider auth
  if (path === "/api/ext/provider-auth" && method === "DELETE") {
    const target = url.searchParams.get("target") || ""
    const providerID = url.searchParams.get("providerID") || ""
    if (!target || !providerID) {
      return Response.json({ error: "target and providerID parameters are required" }, { status: 400 })
    }
    return clearProviderAuthSession(req, target, providerID)
  }

  // POST /api/ext/mkdir - Create directory recursively
  if (path === "/api/ext/mkdir" && method === "POST") {
    try {
      const body = await req.json()
      const dirPath = body.path
      if (!dirPath || typeof dirPath !== "string") {
        return Response.json({ error: "path is required" }, { status: 400 })
      }

      // Validate path is within allowed root
      const allowedRoot = getAllowedRoot()
      const validatedPath = validatePath(dirPath, allowedRoot)
      if (!validatedPath) {
        console.warn("[ExtAPI] mkdir: path outside allowed root:", dirPath)
        return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
      }

      console.log("[ExtAPI] mkdir:", validatedPath)
      await fs.promises.mkdir(validatedPath, { recursive: true })
      return Response.json(true)
    } catch (e) {
      console.error("[ExtAPI] mkdir error:", e)
      return Response.json(false)
    }
  }

  // POST /api/ext/move - Move a file or directory (rename)
  if (path === "/api/ext/move" && method === "POST") {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.source !== "string" || typeof body.dest !== "string") {
      return Response.json({ error: "source and dest are required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedSource = validatePath(body.source, allowedRoot)
    const validatedDest = validatePath(body.dest, allowedRoot)
    if (!validatedSource || !validatedDest) {
      console.warn("[ExtAPI] move: path outside allowed root:", body.source, body.dest)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] move:", validatedSource, "->", validatedDest)

    try {
      await fs.promises.rename(validatedSource, validatedDest)
      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] move error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // POST /api/ext/file - Upload file content (multipart form)
  if (path === "/api/ext/file" && method === "POST") {
    const form = await req.formData().catch(() => null)
    if (!form) {
      return Response.json({ error: "multipart form data is required" }, { status: 400 })
    }

    const filePath = form.get("path")
    const fileEntry = form.get("file")
    if (typeof filePath !== "string" || !filePath) {
      return Response.json({ error: "path is required" }, { status: 400 })
    }
    if (!(fileEntry instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedPath = validatePath(filePath, allowedRoot)
    if (!validatedPath) {
      console.warn("[ExtAPI] file upload: path outside allowed root:", filePath)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] file upload:", validatedPath)

    try {
      const parentDir = nodePath.dirname(validatedPath)
      await fs.promises.mkdir(parentDir, { recursive: true })
      await fs.promises.writeFile(validatedPath, Buffer.from(await fileEntry.arrayBuffer()))
      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] file upload error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // GET /api/ext/list-dirs - List directories in a given path
  if (path === "/api/ext/list-dirs" && method === "GET") {
    const directory = url.searchParams.get("directory")
    const query = url.searchParams.get("query") || ""
    const depthParam = parseInt(url.searchParams.get("depth") || "1", 10)
    const limitParam = parseInt(url.searchParams.get("limit") || "100", 10)
    // Cap depth to 1 or 2, default 1
    const depth = isNaN(depthParam) ? 1 : Math.min(Math.max(1, depthParam), 2)
    // Cap limit to reasonable maximum, handle NaN
    const limit = isNaN(limitParam) ? 100 : Math.min(Math.max(1, limitParam), 500)

    if (!directory) {
      return Response.json({ error: "directory parameter is required" }, { status: 400 })
    }

    // Validate path is within allowed root
    const allowedRoot = getAllowedRoot()
    const validatedDir = validatePath(directory, allowedRoot)
    if (!validatedDir) {
      console.warn("[ExtAPI] list-dirs: path outside allowed root:", directory)
      return Response.json({ error: "directory must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] list-dirs:", validatedDir, "depth:", depth, "query:", query)

    try {
      const dirs: string[] = []
      const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor", ".git"])
      const shouldIgnore = (name: string) => name.startsWith(".") || ignoreNested.has(name)

      // Read top-level directories
      const topEntries = await fs.promises.readdir(validatedDir, { withFileTypes: true }).catch(() => [])

      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue
        if (shouldIgnore(entry.name)) continue
        dirs.push(entry.name + "/")

        // Read second-level directories only if depth >= 2
        if (depth >= 2) {
          const subDir = nodePath.join(validatedDir, entry.name)
          const subEntries = await fs.promises.readdir(subDir, { withFileTypes: true }).catch(() => [])
          for (const subEntry of subEntries) {
            if (!subEntry.isDirectory()) continue
            if (shouldIgnore(subEntry.name)) continue
            dirs.push(entry.name + "/" + subEntry.name + "/")
          }
        }
      }

      // Sort and filter by query
      dirs.sort()
      const queryLower = query.trim().toLowerCase()
      const filtered = queryLower ? dirs.filter((d) => d.toLowerCase().includes(queryLower)) : dirs

      return Response.json(filtered.slice(0, limit))
    } catch (e) {
      console.error("[ExtAPI] list-dirs error:", e)
      return Response.json([])
    }
  }

  // DELETE /api/ext/mcp/:name - Remove an MCP server from global config
  if (path.startsWith("/api/ext/mcp/") && method === "DELETE") {
    const rawServerName = path.replace("/api/ext/mcp/", "")
    
    // Decode URL-encoded name (handle malformed encoding)
    let serverName: string
    try {
      serverName = decodeURIComponent(rawServerName)
    } catch {
      return Response.json({ error: "invalid URL encoding" }, { status: 400 })
    }
    
    if (!serverName) {
      return Response.json({ error: "server name is required" }, { status: 400 })
    }
    
    if (!isValidServerName(serverName)) {
      return Response.json({ error: "invalid server name" }, { status: 400 })
    }

    console.log("[ExtAPI] Deleting MCP server:", serverName)

    try {
      // Find the global config file
      const homeDir = process.env.HOME || os.homedir()
      const configDir = process.env.OPENCODE_CONFIG_DIR || nodePath.join(homeDir, ".config", "opencode")

      // Try both .jsonc and .json
      let configPath = nodePath.join(configDir, "opencode.jsonc")
      if (!fs.existsSync(configPath)) {
        configPath = nodePath.join(configDir, "opencode.json")
      }

      if (!fs.existsSync(configPath)) {
        return Response.json({ error: "Config file not found" }, { status: 404 })
      }

      // Read and parse config
      const content = await fs.promises.readFile(configPath, "utf-8")

      // Try parsing as JSON first, then strip comments if it fails
      let config: Record<string, unknown>
      try {
        config = JSON.parse(content)
      } catch {
        // Strip comments more carefully - only match // at start of line or after whitespace
        // (not inside strings like URLs)
        const jsonContent = content
          .split("\n")
          .map((line) => {
            // Remove trailing comments (// at end of line, but not in strings)
            // Simple heuristic: if line has even number of quotes before //, it's a comment
            const commentMatch = line.match(/^([^"]*(?:"[^"]*"[^"]*)*)\s*\/\//)
            if (commentMatch) {
              return commentMatch[1]
            }
            return line
          })
          .join("\n")
          .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments

        config = JSON.parse(jsonContent)
      }

      // Remove the MCP server
      const mcpConfig = config.mcp as Record<string, unknown> | undefined
      if (mcpConfig && mcpConfig[serverName]) {
        delete mcpConfig[serverName]
        console.log("[ExtAPI] Removed MCP server from config:", serverName)
      } else {
        console.log("[ExtAPI] MCP server not found in config:", serverName)
        return Response.json({ error: "Server not found in config" }, { status: 404 })
      }

      // Write back (as plain JSON since we stripped comments)
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2))
      console.log("[ExtAPI] Config saved")

      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] mcp delete error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // PUT /api/ext/file - Write file content
  if (path === "/api/ext/file" && method === "PUT") {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.path !== "string" || typeof body.content !== "string") {
      return Response.json({ error: "path and content are required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedPath = validatePath(body.path, allowedRoot)
    if (!validatedPath) {
      console.warn("[ExtAPI] file write: path outside allowed root:", body.path)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] file write:", validatedPath)

    try {
      // Create parent directories if needed
      const parentDir = nodePath.dirname(validatedPath)
      await fs.promises.mkdir(parentDir, { recursive: true })

      await fs.promises.writeFile(validatedPath, body.content, "utf-8")
      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] file write error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // Not an extended endpoint
  // DELETE /api/ext/file - Delete a file
  if (path === "/api/ext/file" && method === "DELETE") {
    const filePath = url.searchParams.get("path")
    if (!filePath) {
      return Response.json({ error: "path parameter is required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedPath = validatePath(filePath, allowedRoot)
    if (!validatedPath) {
      console.warn("[ExtAPI] file delete: path outside allowed root:", filePath)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] file delete:", validatedPath)

    try {
      await fs.promises.unlink(validatedPath)
      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] file delete error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // DELETE /api/ext/dir - Delete a directory
  if (path === "/api/ext/dir" && method === "DELETE") {
    const dirPath = url.searchParams.get("path")
    if (!dirPath) {
      return Response.json({ error: "path parameter is required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedPath = validatePath(dirPath, allowedRoot)
    if (!validatedPath) {
      console.warn("[ExtAPI] dir delete: path outside allowed root:", dirPath)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] dir delete:", validatedPath)

    try {
      await fs.promises.rm(validatedPath, { recursive: true, force: true })
      return Response.json({ success: true })
    } catch (e) {
      console.error("[ExtAPI] dir delete error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // GET /api/ext/file - Read file content
  if (path === "/api/ext/file" && method === "GET") {
    const filePath = url.searchParams.get("path")
    if (!filePath) {
      return Response.json({ error: "path parameter is required" }, { status: 400 })
    }

    const allowedRoot = getAllowedRoot()
    const validatedPath = validatePath(filePath, allowedRoot)
    if (!validatedPath) {
      console.warn("[ExtAPI] file read: path outside allowed root:", filePath)
      return Response.json({ error: "path must be within allowed directory" }, { status: 403 })
    }

    console.log("[ExtAPI] file read:", validatedPath)

    try {
      const content = await fs.promises.readFile(validatedPath, "utf-8")
      return Response.json({ content })
    } catch (e) {
      console.error("[ExtAPI] file read error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  // GET /api/ext/log-files - List available OpenCode log files
  if (path === "/api/ext/log-files" && method === "GET") {
    try {
      const homeDir = process.env.HOME || os.homedir()
      const logDir = nodePath.join(homeDir, ".local", "share", "opencode", "log")

      const entries = await fs.promises.readdir(logDir, { withFileTypes: true }).catch(() => [])
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".log"))
        .map((e) => e.name)
        .sort()
        .reverse()

      return Response.json(files)
    } catch (e) {
      console.error("[ExtAPI] log-files error:", e)
      return Response.json([])
    }
  }

  // GET /api/ext/log-file?name=<filename> - Read a specific OpenCode log file
  if (path === "/api/ext/log-file" && method === "GET") {
    const name = url.searchParams.get("name")
    if (!name) {
      return Response.json({ error: "name parameter is required" }, { status: 400 })
    }

    if (name.includes("/") || name.includes("\\") || name.includes("..") || !name.endsWith(".log")) {
      return Response.json({ error: "invalid log file name" }, { status: 400 })
    }

    try {
      const homeDir = process.env.HOME || os.homedir()
      const logPath = nodePath.join(homeDir, ".local", "share", "opencode", "log", name)

      console.log("[ExtAPI] log-file read:", logPath)
      const content = await fs.promises.readFile(logPath, "utf-8")
      return Response.json({ content })
    } catch (e) {
      console.error("[ExtAPI] log-file read error:", e)
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  if (path === "/api/ext/probe-server" && method === "GET") {
    const targetUrl = url.searchParams.get("url")
    if (!targetUrl) {
      return Response.json({ ok: false, error: "url parameter is required" }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(targetUrl)
    } catch {
      return Response.json({ ok: false, error: "invalid URL" }, { status: 400 })
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return Response.json({ ok: false, error: "only http/https allowed" }, { status: 400 })
    }

    const probe = new URL(parsed.toString())
    const pathWithHealth = probe.pathname === "/"
      ? "/health"
      : probe.pathname.endsWith("/")
        ? `${probe.pathname}health`
        : `${probe.pathname}/health`
    probe.pathname = pathWithHealth

    try {
      const headers = new Headers()
      const auth = options?.resolveUpstreamAuthHeader?.(probe.toString())
      if (auth) headers.set("Authorization", auth)

      const res = await fetch(probe.toString(), {
        signal: AbortSignal.timeout(5000),
        headers,
      })

      if (res.status === 401) {
        return Response.json({
          ok: true,
          reachable: true,
          authRequired: true,
          status: res.status,
          url: probe.toString(),
        })
      }

      return Response.json({
        ok: res.ok,
        reachable: true,
        authRequired: false,
        status: res.status,
        url: probe.toString(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return Response.json({
        ok: false,
        reachable: false,
        authRequired: false,
        error: msg,
      })
    }
  }

  // GET /api/ext/quota - Get quota data for all providers
  if (path === "/api/ext/quota" && method === "GET") {
    const refresh = url.searchParams.get("refresh") === "true"
    const providerFilter = url.searchParams.get("provider") || undefined
    const target = url.searchParams.get("target") || ""

    try {
      const { getQuotaData } = await import("./quota/index")
      const result = await getQuotaData({
        refresh,
        providerFilter,
        targetUrl: target,
        resolveAuthHeader: options?.resolveUpstreamAuthHeader,
        resolveProviderAuthHeader: (providerID) => resolveProviderAuthHeader(req, target, providerID),
        resolveProviderAuthAccountId: (providerID) => resolveProviderAuthAccountId(req, target, providerID),
      })
      return Response.json(result)
    } catch (error) {
      console.error("[ExtAPI] quota error:", error)
      return Response.json({ error: String(error) }, { status: 500 })
    }
  }
}
