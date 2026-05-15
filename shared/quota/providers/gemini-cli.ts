import { QuotaProvider, QuotaProviderView, QuotaFetchOptions, QuotaEntryView } from '../types'
import { fetchQuotaJson, resolveQuotaAuthHeader } from '../http'

const GEMINI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildEntry(bucket: Record<string, unknown>, index: number): QuotaEntryView | undefined {
  const remainingFraction = asNumber(bucket.remainingFraction)
  const remainingAmount = asNumber(bucket.remainingAmount)
  const tokenType = asString(bucket.tokenType)
  const modelId = asString(bucket.modelId)
  const resetTimeIso = asString(bucket.resetTimeIso ?? bucket.resetAt ?? bucket.reset_time_iso ?? bucket.reset_time)

  if (remainingFraction === undefined && remainingAmount === undefined) return undefined

  const percentUsed = remainingFraction !== undefined ? Math.max(0, Math.min(100, (1 - remainingFraction) * 100)) : undefined

  return {
    id: modelId || tokenType || `bucket-${index}`,
    group: 'tier',
    label: modelId || tokenType || `Bucket ${index + 1}`,
    remaining: remainingAmount,
    percentUsed,
    percentRemaining: remainingFraction !== undefined ? Math.max(0, Math.min(100, remainingFraction * 100)) : undefined,
    resetTimeIso,
    window: 'monthly',
    subtitle: tokenType || modelId || undefined,
    unlimited: false,
  }
}

export class GeminiProvider implements QuotaProvider {
  id = 'gemini'
  name = 'Google Gemini'

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    return Boolean(resolveQuotaAuthHeader(options, GEMINI_QUOTA_URL))
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    try {
      const auth = resolveQuotaAuthHeader(options, GEMINI_QUOTA_URL)
      if (!auth) {
        return {
          id: this.id,
          name: this.name,
          status: 'unavailable',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          warning: 'No Google auth available for Gemini quota lookup',
        }
      }

      const data = await fetchQuotaJson<Record<string, unknown>>(GEMINI_QUOTA_URL, { ...options, authHeader: auth }, {
        method: 'POST',
      })

      const root = data as { buckets?: unknown; quota?: unknown }
      const quota = root.quota && typeof root.quota === 'object'
        ? root.quota as { buckets?: unknown }
        : undefined
      const buckets: unknown[] = Array.isArray(root.buckets)
        ? root.buckets
        : Array.isArray(quota?.buckets)
          ? quota?.buckets as unknown[]
          : []

      const entries = buckets
        .map((bucket, index) => (bucket && typeof bucket === 'object' ? buildEntry(bucket as Record<string, unknown>, index) : undefined))
        .filter((entry): entry is QuotaEntryView => Boolean(entry))

      if (entries.length === 0) {
        return {
          id: this.id,
          name: this.name,
          status: 'error',
          available: false,
          fetchedAt: new Date().toISOString(),
          entries: [],
          error: 'Gemini quota response did not include quota buckets',
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
