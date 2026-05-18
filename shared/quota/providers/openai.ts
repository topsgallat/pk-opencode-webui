import { QuotaProvider, QuotaProviderView, QuotaFetchOptions, QuotaEntryView } from '../types'
import { fetchQuotaJson, resolveQuotaAuthHeader } from '../http'

const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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
  const resetTimeIso = asString(window.reset_at ?? window.resetAt ?? window.resets_at ?? window.resetsAt)

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

export class OpenAIProvider implements QuotaProvider {
  id = 'openai'
  name = 'OpenAI'

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(options?.resolveProviderAuthHeader?.(this.id) || resolveQuotaAuthHeader(options, OPENAI_USAGE_URL))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const auth = options?.resolveProviderAuthHeader?.(this.id) || resolveQuotaAuthHeader(options, OPENAI_USAGE_URL)
      if (!auth) {
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

      const accountId = options?.resolveProviderAuthAccountId?.(this.id)
      const identity = extractOpenAIIdentity(auth, accountId)
      const requestHeaders: Record<string, string> = {}
      if (identity?.id) requestHeaders['ChatGPT-Account-Id'] = identity.id

      const data = await fetchQuotaJson<Record<string, unknown>>(OPENAI_USAGE_URL, { ...options, authHeader: auth }, {
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
        return {
          id: this.id,
          name: this.name,
          status: 'error',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: 'OpenAI quota response did not include rate limit windows',
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
