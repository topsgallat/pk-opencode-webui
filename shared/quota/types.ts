export interface QuotaFetchOptions {
  refresh?: boolean
  targetUrl?: string
  projectDir?: string
  skipProviders?: string[]
  authHeader?: string
  resolveAuthHeader?: (target: string) => string | undefined
  resolveProviderAuthHeader?: (providerID: string) => string | undefined
  resolveProviderAuthAccountId?: (providerID: string) => string | undefined
}

export interface QuotaProvider {
  id: string
  name: string
  isAvailable(options?: QuotaFetchOptions): Promise<boolean>
  fetch(options: QuotaFetchOptions): Promise<QuotaProviderView>
}

export type QuotaApiResponse = {
  ok: boolean
  fetchedAt: string
  refreshed: boolean
  source: "live" | "cache" | "mixed"
  providers: QuotaProviderView[]
  summary: {
    availableProviders: string[]
    unavailableProviders: Array<{ id: string; reason: string }>
    hasWarnings: boolean
  }
  warnings: string[]
}

export type QuotaProviderView = {
  id: string
  name: string
  status: "ok" | "unavailable" | "error"
  available: boolean
  matchedCurrentModel?: boolean
  activeAccountId?: string
  cooldownUntil?: string
  fetchedAt?: string
  entries: QuotaEntryView[]
  accounts?: QuotaAccountView[]
  error?: string
  warning?: string
  reason?: string
}

export type QuotaEntryView = {
  id: string
  group: string
  label: string
  used?: number
  total?: number
  remaining?: number
  percentRemaining?: number
  percentUsed?: number
  resetTimeIso?: string
  window?: "hourly" | "daily" | "weekly" | "monthly" | "unknown"
  rightText?: string
  subtitle?: string
  unlimited?: boolean
}

export type QuotaAccountView = {
  id: string
  label: string
  email?: string
  status?: "ok" | "unavailable" | "error"
  reason?: string
  active?: boolean
  entries: QuotaEntryView[]
}
