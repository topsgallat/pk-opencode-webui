export type Dialect = "v1" | "v2"

const PROBE_TIMEOUT_MS = 6_000
const cache = new Map<string, Promise<Dialect>>()
// The V2 API drifted across generations: 2.0.x releases take the prompt text
// top-level, newer dev builds wrap it in {prompt}. Remember the version the
// probe saw per target so request mapping can pick the right shape.
const versions = new Map<string, string>()

function cacheKey(baseUrl: string, targetUrl?: string): string {
  return `${targetUrl ?? ""}|${baseUrl}`
}

function versionKey(targetUrl?: string): string {
  return `v:${targetUrl ?? "@"}`
}

export function cacheV2Version(targetUrl: string | undefined, version: string): void {
  versions.set(versionKey(targetUrl), version)
}

export function cachedV2Version(targetUrl?: string): string | undefined {
  return versions.get(versionKey(targetUrl))
}

async function probeJson(url: string, headers: HeadersInit): Promise<unknown> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("json")) return undefined
    return response.json().catch(() => undefined)
  } catch {
    return undefined
  }
}

async function probe(baseUrl: string, targetUrl?: string): Promise<Dialect> {
  const headers: HeadersInit = targetUrl ? { "x-opencode-target": targetUrl } : {}
  // /global/health returns {healthy: true, version} on BOTH the V1 (1.x) and
  // the V2 (2.x) lines, and V2 keeps the whole legacy V1 surface mounted
  // (including directory-scoped /event). So a healthy answer means "use the
  // V1-compatible surface" — routing stock V2 servers to the /api/* paths
  // would break chat (native runner rejects non-catalog models). The /api/*
  // dialect below only fires for builds that expose JSON /api/info and no
  // healthy /global/health.
  const health = await probeJson(`${baseUrl}/global/health`, headers)
  if (health && typeof health === "object" && (health as Record<string, unknown>).healthy === true) return "v1"
  const info = await probeJson(`${baseUrl}/api/info`, headers)
  if (info && typeof info === "object" && typeof (info as Record<string, unknown>).version === "string") {
    cacheV2Version(targetUrl, (info as Record<string, unknown>).version as string)
    return "v2"
  }
  return "v1"
}

export function dialectFor(baseUrl: string, targetUrl?: string): Promise<Dialect> {
  const key = cacheKey(baseUrl, targetUrl)
  const cached = cache.get(key)
  if (cached) return cached
  const pending = probe(baseUrl, targetUrl)
  cache.set(key, pending)
  pending.catch(() => cache.delete(key))
  return pending
}

export function resetDialectCacheForTests(): void {
  cache.clear()
  versions.clear()
}
