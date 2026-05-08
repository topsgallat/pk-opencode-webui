declare global {
  interface Window {
    __OPENCODE__?: {
      basePath?: string
      serverUrl?: string
      copilotModelMultipliers?: Record<string, number>
      openaiPricing?: Record<string, {
        input: number
        output: number
        cachedInput?: number
      }>
    }
  }
}

export function getBasePath(): string {
  // Priority order:
  // 1. Explicit config in window.__OPENCODE__
  // 2. <base href="..."> tag
  // 3. Build-time injected value
  // 4. Default to "/"

  if (typeof window !== "undefined") {
    // From global config
    if (window.__OPENCODE__?.basePath) {
      return normalizeBasePath(window.__OPENCODE__.basePath)
    }

    // From <base> tag
    const baseTag = document.querySelector("base")
    if (baseTag?.href) {
      const url = new URL(baseTag.href)
      return normalizeBasePath(url.pathname)
    }
  }

  // Build-time value
  // @ts-ignore - injected at build time
  if (typeof import.meta.env?.BASE_PATH === "string") {
    // @ts-ignore
    return normalizeBasePath(import.meta.env.BASE_PATH)
  }

  return "/"
}

export function normalizeBasePath(path: string): string {
  // Ensure leading slash, trailing slash
  let normalized = path.trim()
  if (!normalized.startsWith("/")) normalized = "/" + normalized
  if (!normalized.endsWith("/")) normalized = normalized + "/"
  return normalized
}

export function prefixPath(path: string, basePath: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path // Absolute URLs unchanged
  }
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
  const suffix = path.startsWith("/") ? path : "/" + path
  return base + suffix
}

export function getServerUrl(): string {
  if (typeof window !== "undefined" && window.__OPENCODE__?.serverUrl) {
    return window.__OPENCODE__.serverUrl
  }
  // Default to same origin + base path (so SDK requests go through our proxy)
  if (typeof window !== "undefined") {
    const basePath = getBasePath()
    // Remove trailing slash for server URL
    const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
    return window.location.origin + base
  }
  return "http://localhost:4096"
}

export function normalizeCopilotModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function normalizeOpenAIModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\[\^.*?\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function getCopilotModelMultipliers(): Record<string, number> {
  if (typeof window === "undefined") {
    return {}
  }
  return window.__OPENCODE__?.copilotModelMultipliers || {}
}

export function getCopilotMultiplier(providerID: string, modelID: string, modelName?: string): number | undefined {
  if (providerID !== "github-copilot") return undefined
  const key = normalizeCopilotModelKey(modelName || modelID)
  return getCopilotModelMultipliers()[key]
}

export function getOpenAIModelPricing(providerID: string, modelID: string, modelName?: string): { input: number; output: number; cachedInput?: number } | undefined {
  if (!(providerID === "openai" || providerID.startsWith("openai:"))) return undefined
  const key = normalizeOpenAIModelKey(modelName || modelID)
  return window.__OPENCODE__?.openaiPricing?.[key]
}

export function appendTargetParam(url: string, targetUrl?: string): string {
  if (!targetUrl) return url
  if (typeof window === "undefined") return url
  const next = new URL(url, window.location.origin)
  next.searchParams.set("target", targetUrl)
  return next.toString()
}

// URL-safe Base64 encoding for directory paths
export function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("")
  // URL-safe: replace + with -, / with _, remove padding =
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64Decode(value: string): string {
  // Restore standard base64 chars
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  // Restore padding (base64 must be multiple of 4)
  const pad = base64.length % 4
  if (pad) {
    base64 += "=".repeat(4 - pad)
  }
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Derive the active project directory from window.location.pathname.
 * Returns the decoded directory string for project-scoped routes, or
 * `undefined` for global routes (home `/`, `/settings`, etc.).
 *
 * Shared by `useActiveDirectory` in app.tsx and `SavedPromptsProvider`.
 */
export function deriveDirectoryFromPathname(): string | undefined {
  const basePath = getBasePath()
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
  const pathname = window.location.pathname
  const path = (pathname === base || pathname.startsWith(base + "/"))
    ? pathname.slice(base.length)
    : pathname
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return undefined
  try {
    const decoded = base64Decode(segments[0])
    if (decoded.startsWith("/") || decoded.startsWith("~")) return decoded
    return undefined
  } catch {
    return undefined
  }
}
