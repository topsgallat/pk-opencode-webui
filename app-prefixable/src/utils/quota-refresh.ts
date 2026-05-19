import type { QuotaApiResponse } from "../../../shared/quota/types"

export const QUOTA_REFRESH_TTL_MS = 60_000

export function shouldRefreshQuotaOnOpen(
  quota: Pick<QuotaApiResponse, "fetchedAt"> | null | undefined,
  hasError: boolean,
  now = Date.now(),
  ttlMs = QUOTA_REFRESH_TTL_MS,
): boolean {
  if (hasError) return true
  if (!quota?.fetchedAt) return true
  return now - Date.parse(quota.fetchedAt) >= ttlMs
}

export function shouldLoadQuotaOnOpen(options: {
  requested: boolean
  loading: boolean
  quota: Pick<QuotaApiResponse, "fetchedAt"> | null | undefined
  hasError: boolean
  now?: number
  ttlMs?: number
}): boolean {
  if (!options.requested) return true
  if (options.loading) return false
  return shouldRefreshQuotaOnOpen(options.quota, options.hasError, options.now, options.ttlMs)
}
