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
  fetchedAt?: string
  entries: QuotaEntryView[]
  accounts?: QuotaAccountView[]
  error?: string
  warning?: string
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
  entries: QuotaEntryView[]
}