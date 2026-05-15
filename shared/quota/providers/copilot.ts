import { QuotaProvider, QuotaProviderView, QuotaFetchOptions, QuotaEntryView } from '../types'
import { fetchQuotaJson, resolveQuotaAuthHeader } from '../http'

const COPILOT_QUOTA_URL = 'https://api.github.com/copilot_internal/user'

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildEntry(label: string, quota: Record<string, unknown>): QuotaEntryView | undefined {
  const used = asNumber(quota.used)
  const total = asNumber(quota.limit ?? quota.total)
  const remaining = asNumber(quota.remaining)
  const percentRemaining = asNumber(quota.percent_remaining ?? quota.percentRemaining)
  const percentUsed = asNumber(quota.percent_used ?? quota.percentUsed)
  const resetTimeIso = asString(quota.reset_at ?? quota.resetAt)

  if (used === undefined && total === undefined && remaining === undefined && percentRemaining === undefined && percentUsed === undefined) {
    return undefined
  }

  return {
    id: 'personal',
    group: 'personal',
    label,
    used,
    total,
    remaining,
    percentRemaining,
    percentUsed,
    resetTimeIso,
    window: 'monthly',
    unlimited: false,
  }
}

export class CopilotProvider implements QuotaProvider {
  id = 'copilot'
  name = 'GitHub Copilot'

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(resolveQuotaAuthHeader(options, COPILOT_QUOTA_URL))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const auth = resolveQuotaAuthHeader(options, COPILOT_QUOTA_URL)
      if (!auth) {
        return {
          id: this.id,
          name: this.name,
          status: 'unavailable',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          warning: 'No GitHub auth available for Copilot quota',
        }
      }

      const data = await fetchQuotaJson<Record<string, unknown>>(COPILOT_QUOTA_URL, { ...options, authHeader: auth })
      const quota = (data.quota && typeof data.quota === 'object' ? data.quota : data) as Record<string, unknown>
      const entry = buildEntry('Personal Usage', quota)
      const entries = entry ? [entry] : []

      if (entries.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: 'error',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: 'Copilot quota response did not include usage data',
        }
      }

      return {
        id: this.id,
        name: this.name,
        status: 'ok',
        available: true,
        fetchedAt: new Date().toISOString(),
        entries,
        matchedCurrentModel: true,
      }
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        status: 'error',
        available: false,
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
