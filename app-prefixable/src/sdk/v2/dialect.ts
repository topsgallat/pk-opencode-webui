export type Dialect = "v1" | "v2"

const PROBE_TIMEOUT_MS = 6_000
const cache = new Map<string, Promise<Dialect>>()

function cacheKey(baseUrl: string, targetUrl?: string): string {
  return `${targetUrl ?? ""}|${baseUrl}`
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
  const health = await probeJson(`${baseUrl}/global/health`, headers)
  if (health && typeof health === "object" && (health as Record<string, unknown>).healthy === true) return "v1"
  const info = await probeJson(`${baseUrl}/api/info`, headers)
  if (info && typeof info === "object" && typeof (info as Record<string, unknown>).version === "string") return "v2"
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
}
