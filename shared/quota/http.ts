import type { QuotaFetchOptions } from "./types"

const QUOTA_REQUEST_TIMEOUT_MS = 5000

export function resolveQuotaAuthHeader(options: QuotaFetchOptions | undefined, target: string): string | undefined {
  return options?.resolveAuthHeader?.(target) || options?.authHeader
}

export async function fetchQuotaJson<T>(target: string, options: QuotaFetchOptions | undefined, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const auth = resolveQuotaAuthHeader(options, target)
  if (auth && !headers.has("Authorization")) headers.set("Authorization", auth)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")

  const res = await fetch(target, {
    ...init,
    headers,
    signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const detail = body.trim() ? `: ${body.slice(0, 300)}` : ""
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail}`.trim())
  }

  return await res.json() as T
}
