import { QuotaProvider, QuotaProviderView, QuotaFetchOptions, QuotaEntryView } from '../types'
import { fetchQuotaJson, resolveQuotaAuthHeader } from '../http'

const COPILOT_QUOTA_URL = 'https://api.github.com/copilot_internal/user'

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asResetIso(value: unknown): string | undefined {
  const text = asString(value)
  if (!text) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function buildEntry(label: string, quota: Record<string, unknown>, resetTimeIso?: string): QuotaEntryView | undefined {
  let used = asNumber(quota.used)
  let total = asNumber(quota.limit ?? quota.total ?? quota.entitlement)
  let remaining = asNumber(quota.remaining ?? quota.quota_remaining)
  let percentRemaining = asNumber(quota.percent_remaining ?? quota.percentRemaining)
  let percentUsed = asNumber(quota.percent_used ?? quota.percentUsed)
  const reset = asResetIso(resetTimeIso ?? quota.reset_at ?? quota.resetAt ?? quota.reset_date ?? quota.resetDate)

  if (total === undefined && used !== undefined && remaining !== undefined) {
    total = used + remaining
  }
  if (used === undefined && total !== undefined) {
    if (remaining !== undefined) {
      used = Math.max(0, total - remaining)
    } else if (percentRemaining !== undefined) {
      used = Math.max(0, total * (1 - percentRemaining / 100))
    }
  }
  if (remaining === undefined && total !== undefined) {
    if (used !== undefined) {
      remaining = Math.max(0, total - used)
    } else if (percentRemaining !== undefined) {
      remaining = Math.max(0, total * (percentRemaining / 100))
    }
  }
  if (percentRemaining === undefined && total !== undefined && remaining !== undefined) {
    percentRemaining = total === 0 ? undefined : (remaining / total) * 100
  }
  if (percentUsed === undefined && percentRemaining !== undefined) {
    percentUsed = 100 - percentRemaining
  }

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
    resetTimeIso: reset,
    window: 'monthly',
    unlimited: false,
  }
}

function pickQuotaSnapshot(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const snapshots = asObject(data.quota_snapshots)
  if (snapshots) {
    const record = snapshots
    const premium = record.premium_interactions
    if (premium && typeof premium === 'object') return premium as Record<string, unknown>

    const chat = record.chat
    if (chat && typeof chat === 'object') return chat as Record<string, unknown>

    const completions = record.completions
    if (completions && typeof completions === 'object') return completions as Record<string, unknown>
  }

  const quota = asObject(data.quota)
  if (quota) return quota
  return undefined
}

async function fetchGitHubIdentity(authHeader: string): Promise<{ id: string; label: string; email?: string } | undefined> {
  try {
    const data = await fetchQuotaJson<Record<string, unknown>>('https://api.github.com/user', {
      authHeader,
    }, {
      headers: {
        'User-Agent': 'pk-opencode-webui',
      },
    })

    const login = asString(data.login)
    const name = asString(data.name)
    const email = asString(data.email)
    const id = typeof data.id === 'number' && Number.isFinite(data.id) ? String(data.id) : asString(data.id)

    if (!id && !login && !name && !email) return undefined

    return {
      id: id || login || name || email || 'copilot',
      label: name || login || 'GitHub Copilot',
      email,
    }
  } catch {
    return undefined
  }
}

export class CopilotProvider implements QuotaProvider {
  id = 'copilot'
  name = 'GitHub Copilot'

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(resolveQuotaAuthHeader(options, COPILOT_QUOTA_URL) || options?.resolveProviderAuthHeader?.(this.id))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const auth = options?.resolveProviderAuthHeader?.(this.id) || resolveQuotaAuthHeader(options, COPILOT_QUOTA_URL)
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
      const quota = pickQuotaSnapshot(data) || data
      const entry = buildEntry('Personal Usage', quota, asResetIso(data.quota_reset_date_utc ?? data.quota_reset_date))
      const entries = entry ? [entry] : []
      const identity = await fetchGitHubIdentity(auth)

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
        accounts: identity ? [{ ...identity, entries }] : undefined,
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
