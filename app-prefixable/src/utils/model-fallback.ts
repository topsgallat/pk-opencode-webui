import type { QuotaApiResponse, QuotaProviderView } from "../../../shared/quota/types"
import { providerBaseID } from "./model-policy"
import { getQuotaPercentUsed, resolveQuotaProviderState } from "../components/session-info-helpers"

export interface FallbackPolicyConfig {
  enabled?: boolean
  cross_provider?: boolean
  order?: string[]
}

export interface FallbackCandidate {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  providerIndex: number
  modelIndex: number
}

export interface RankedFallbackCandidate extends FallbackCandidate {
  score: number
  quotaProvider: QuotaProviderView | null
  quotaPercentRemaining: number | null
  orderIndex: number | null
}

const RETRYABLE_STATUS = new Set([429, 402, 503])
const CONNECTION_FAILURE_TEXTS = [
  "cannot connect to api",
  "unable to connect",
  "unable to reach",
  "failed to fetch",
  "fetch failed",
  "network error",
  "network down",
  "connection refused",
  "econnrefused",
  "econnreset",
  "socket hang up",
  "timed out",
  "timeout",
]

function collectStrings(value: unknown, out = new Set<string>()) {
  if (!value) return out
  if (typeof value === "string") {
    out.add(value)
    return out
  }
  if (typeof value !== "object") return out

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }

  const record = value as Record<string, unknown>
  for (const key of ["message", "error", "detail", "reason", "title", "description", "statusText", "code"]) {
    collectStrings(record[key], out)
  }
  if (record.data) collectStrings(record.data, out)
  if (record.body) collectStrings(record.body, out)
  return out
}

function extractStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  if (typeof record.status === "number") return record.status
  if (typeof record.statusCode === "number") return record.statusCode
  if (typeof record.code === "number") return record.code
  if (record.data && typeof record.data === "object") {
    const data = record.data as Record<string, unknown>
    if (typeof data.status === "number") return data.status
    if (typeof data.statusCode === "number") return data.statusCode
  }
  return undefined
}

export function isRetryableModelFailure(error: unknown): boolean {
  const status = extractStatus(error)
  if (status !== undefined && RETRYABLE_STATUS.has(status)) return true

  if (isConnectionModelFailure(error)) return true

  const text = [...collectStrings(error)].join(" ").toLowerCase()
  if (!text) return false

  return [
    "rate limit",
    "rate limited",
    "too many requests",
    "insufficient_quota",
    "quota exceeded",
    "exceeded your current quota",
    "billing limit",
    "usage limit",
    "cooldown",
    "try again later",
    "cannot connect to api",
    "unable to connect",
    "failed to fetch",
    "fetch failed",
    "network error",
    "connection refused",
    "econnrefused",
    "ehostunreach",
    "enotfound",
  ].some((needle) => text.includes(needle))
}

export function isConnectionModelFailure(error: unknown): boolean {
  const text = [...collectStrings(error)].join(" ").toLowerCase()
  if (!text) return false

  return CONNECTION_FAILURE_TEXTS.some((needle) => text.includes(needle))
}

export function shouldFallbackAfterRetryAttempts(error: unknown, attempts: number, limit = 5): boolean {
  return isConnectionModelFailure(error) && attempts >= limit
}

function getPrimaryQuotaPercentRemaining(provider: QuotaProviderView | null) {
  if (!provider) return null
  const entry = resolveQuotaProviderState([provider], provider.id).entry
  if (!entry) return null
  const percentUsed = getQuotaPercentUsed(entry)
  if (percentUsed === null) return entry.unlimited ? 100 : null
  return Math.max(0, 100 - percentUsed)
}

function normalizeOrderItem(value: string) {
  return value.trim().toLowerCase()
}

function matchesOrderItem(item: string, candidate: FallbackCandidate) {
  const normalized = normalizeOrderItem(item)
  if (!normalized) return false

  const provider = providerBaseID(candidate.providerID).toLowerCase()
  const exactProvider = candidate.providerID.toLowerCase()
  const model = candidate.modelID.toLowerCase()
  const displayModel = candidate.modelName.toLowerCase()

  if (normalized === exactProvider) return true
  if (normalized === provider) return true
  if (normalized === `${exactProvider}/${model}`) return true
  if (normalized === `${provider}/${model}`) return true
  if (normalized === `${provider}/*`) return true
  if (normalized === `${exactProvider}/*`) return true
  if (normalized === `${provider}/${displayModel}`) return true
  return false
}

function orderIndexFor(candidate: FallbackCandidate, order?: string[]) {
  if (!order || order.length === 0) return null
  const index = order.findIndex((item) => matchesOrderItem(item, candidate))
  return index >= 0 ? index : null
}

export function rankFallbackCandidates(candidates: FallbackCandidate[], quota?: QuotaApiResponse | null, policy?: FallbackPolicyConfig): RankedFallbackCandidate[] {
  const providers = quota?.providers ?? []

  return candidates
    .map((candidate) => {
      const quotaProvider = resolveQuotaProviderState(providers, candidate.providerID).provider
      if (quotaProvider && quotaProvider.status !== "ok") return null

      const cooldownUntil = quotaProvider?.cooldownUntil
      if (cooldownUntil) {
        const cooldownAt = Date.parse(cooldownUntil)
        if (!Number.isNaN(cooldownAt) && cooldownAt > Date.now()) return null
      }

      const quotaPercentRemaining = getPrimaryQuotaPercentRemaining(quotaProvider)
      const score = quotaPercentRemaining ?? (quotaProvider ? 1 : 0)
      const orderIndex = orderIndexFor(candidate, policy?.order)

      return {
        ...candidate,
        score,
        quotaProvider,
        quotaPercentRemaining,
        orderIndex,
      }
    })
    .filter((candidate): candidate is RankedFallbackCandidate => candidate !== null)
    .sort((left, right) => {
      if (left.orderIndex !== right.orderIndex) {
        if (left.orderIndex === null) return 1
        if (right.orderIndex === null) return -1
        return left.orderIndex - right.orderIndex
      }
      if (right.score !== left.score) return right.score - left.score
      if (left.providerIndex !== right.providerIndex) return left.providerIndex - right.providerIndex
      return left.modelIndex - right.modelIndex
    })
}

export function pickFallbackCandidate(
  candidates: FallbackCandidate[],
  current?: Pick<FallbackCandidate, "providerID" | "modelID"> | null,
  quota?: QuotaApiResponse | null,
  policy?: FallbackPolicyConfig,
): RankedFallbackCandidate | null {
  if (policy?.enabled === false) return null

  const next = candidates.filter((candidate) => {
    if (!current) return true
    if (policy?.cross_provider === false && providerBaseID(candidate.providerID) !== providerBaseID(current.providerID)) return false
    return candidate.providerID !== current.providerID || candidate.modelID !== current.modelID
  })

  return rankFallbackCandidates(next, quota, policy)[0] ?? null
}
