import { QuotaProvider, QuotaProviderView, QuotaFetchOptions, QuotaEntryView } from '../types'
import { fetchQuotaJson, resolveQuotaAuthHeader } from '../http'
import { loadOpenAIQuotaAccountCandidates } from './openai-account-source'

const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asResetIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }

  const text = asString(value)
  if (text) return text

  return undefined
}

function pickResetIso(window: Record<string, unknown>): string | undefined {
  const keys = [
    'reset_at',
    'resetAt',
    'reset_time',
    'resetTime',
    'reset_time_iso',
    'resetTimeIso',
    'resets_at',
    'resetsAt',
    'window_ends_at',
    'windowEndsAt',
    'expires_at',
    'expiresAt',
  ]

  for (const key of keys) {
    const text = asResetIso(window[key])
    if (text) return text
  }

  for (const [key, value] of Object.entries(window)) {
    const lower = key.toLowerCase()
    if (!lower.includes('reset') && !lower.includes('expire') && !lower.includes('end')) continue
    const text = asResetIso(value)
    if (text) return text
  }

  return undefined
}

type OpenAIAccountIdentity = {
  id: string
  label: string
  email?: string
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function extractOpenAIIdentity(authHeader: string, accountId?: string): OpenAIAccountIdentity | undefined {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return undefined

  const payload = decodeJwtPayload(token)
  const profile = payload?.['https://api.openai.com/profile']
  const auth = payload?.['https://api.openai.com/auth']
  const profileRecord = profile && typeof profile === 'object' ? profile as Record<string, unknown> : undefined
  const authRecord = auth && typeof auth === 'object' ? auth as Record<string, unknown> : undefined
  const email = asString(profileRecord?.email)
  const resolvedAccountId = accountId || asString(authRecord?.chatgpt_account_id ?? authRecord?.chatgptAccountId ?? authRecord?.accountId)

  if (!email && !resolvedAccountId) return undefined

  return {
    id: resolvedAccountId || email || 'openai',
    label: email || resolvedAccountId || 'OpenAI account',
    email,
  }
}

function percentToEntry(label: string, window: Record<string, unknown>, windowType: QuotaEntryView['window'], subtitle: string): QuotaEntryView | undefined {
  const usedPercent = asNumber(window.used_percent ?? window.usedPercent)
  const resetTimeIso = pickResetIso(window)

  if (usedPercent === undefined) return undefined

  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    group: 'usage',
    label,
    subtitle,
    percentUsed: usedPercent,
    percentRemaining: Math.max(0, 100 - usedPercent),
    window: windowType,
    resetTimeIso,
    unlimited: false,
  }
}

async function fetchAccountQuota(options: QuotaFetchOptions, authHeader: string, accountId: string | undefined, label: string, email: string | undefined) {
  const identity = extractOpenAIIdentity(authHeader, accountId)
  const requestHeaders: Record<string, string> = {}
  if (identity?.id) requestHeaders['ChatGPT-Account-Id'] = identity.id

  const data = await fetchQuotaJson<Record<string, unknown>>(OPENAI_USAGE_URL, { ...options, authHeader }, {
    method: 'GET',
    headers: requestHeaders,
  })

  const rateLimit = (data.rate_limit && typeof data.rate_limit === 'object' ? data.rate_limit : data) as Record<string, unknown>
  const primary = (rateLimit.primary_window && typeof rateLimit.primary_window === 'object' ? rateLimit.primary_window : undefined) as Record<string, unknown> | undefined
  const secondary = (rateLimit.secondary_window && typeof rateLimit.secondary_window === 'object' ? rateLimit.secondary_window : undefined) as Record<string, unknown> | undefined
  const codeReviewRoot = (rateLimit.code_review_rate_limit && typeof rateLimit.code_review_rate_limit === 'object' ? rateLimit.code_review_rate_limit : undefined) as Record<string, unknown> | undefined
  const codeReview = (codeReviewRoot?.primary_window && typeof codeReviewRoot.primary_window === 'object' ? codeReviewRoot.primary_window : undefined) as Record<string, unknown> | undefined

  const entries: QuotaEntryView[] = []
  const primaryEntry = primary ? percentToEntry('Primary Window', primary, 'hourly', '5h window') : undefined
  const secondaryEntry = secondary ? percentToEntry('Secondary Window', secondary, 'weekly', 'Weekly window') : undefined
  const codeReviewEntry = codeReview ? percentToEntry('Code Review', codeReview, 'daily', 'Code review window') : undefined
  if (primaryEntry) entries.push(primaryEntry)
  if (secondaryEntry) entries.push(secondaryEntry)
  if (codeReviewEntry) entries.push(codeReviewEntry)

  if (entries.length === 0) {
    throw new Error('OpenAI quota response did not include rate limit windows')
  }

  return {
    account: {
      id: identity?.id || accountId || email || label,
      label: identity?.label || label,
      email: identity?.email || email,
      status: 'ok' as const,
      entries,
    },
    entries,
    identity,
  }
}

export class OpenAIProvider implements QuotaProvider {
  id = 'openai'
  name = 'OpenAI'

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(options?.resolveProviderAuthHeader?.(this.id) || resolveQuotaAuthHeader(options, OPENAI_USAGE_URL))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const fallbackAuth = options?.resolveProviderAuthHeader?.(this.id) || resolveQuotaAuthHeader(options, OPENAI_USAGE_URL)
      const candidates = await loadOpenAIQuotaAccountCandidates({ projectDir: options?.projectDir })
      const resolved = candidates.length > 0
        ? candidates
        : fallbackAuth
          ? [{ authHeader: fallbackAuth, label: 'OpenAI account', active: true }]
          : []

      if (resolved.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: 'unavailable',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          warning: 'No OpenAI auth available for quota lookup',
        }
      }

      const accounts = [] as NonNullable<QuotaProviderView['accounts']>
      let activeAccountId: string | undefined
      let activeEntries: QuotaEntryView[] = []
      let sawActiveAccount = false

      for (const candidate of resolved) {
        try {
          const result = await fetchAccountQuota(options, candidate.authHeader, candidate.accountId, candidate.label, candidate.email)
          const account = {
            ...result.account,
            active: candidate.active,
          } as NonNullable<QuotaProviderView['accounts']>[number] & { active?: boolean }
          accounts.push(account)
          if (candidate.active) {
            sawActiveAccount = true
            activeAccountId = account.id
            activeEntries = result.entries
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const account = {
            id: candidate.accountId || candidate.email || candidate.label,
            label: candidate.label,
            email: candidate.email,
            status: message.includes('rate limit windows') ? 'error' : 'error',
            reason: message,
            entries: [],
            active: candidate.active,
          } as NonNullable<QuotaProviderView['accounts']>[number]
          accounts.push(account)
          if (candidate.active) {
            sawActiveAccount = true
            activeAccountId = account.id
          }
        }
      }

      if (activeEntries.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: 'error',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          accounts: accounts.length > 0 ? accounts : undefined,
          activeAccountId,
          error: sawActiveAccount
            ? accounts.find((account) => account.active)?.reason || 'OpenAI quota response did not include rate limit windows'
            : accounts.find((account) => account.reason)?.reason || 'OpenAI quota response did not include rate limit windows',
        }
      }

      return {
        id: this.id,
        name: this.name,
        status: 'ok',
        available: true,
        fetchedAt: new Date().toISOString(),
        entries: activeEntries,
        accounts: accounts.length > 0 ? accounts : undefined,
        activeAccountId,
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
