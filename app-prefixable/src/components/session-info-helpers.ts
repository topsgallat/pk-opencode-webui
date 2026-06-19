import { getProviderIDCandidates } from "../../../shared/provider-auth-session"
import type { QuotaEntryView, QuotaProviderView } from "../../../shared/quota/types"

function getQuotaProviderCandidates(providerID?: string): string[] {
  const id = providerID?.trim()
  if (!id) return []

  const candidates = getProviderIDCandidates(id)
  if (id === "anthropic" || id.startsWith("anthropic:")) {
    return ["anthropic", ...candidates]
  }

  if (id === "openai" || id.startsWith("openai:")) {
    return ["openai", ...candidates]
  }

  return candidates
}

function findQuotaEntryByLabels(entries: QuotaEntryView[], labels: string[]) {
  for (const label of labels) {
    const match = entries.find((entry) => entry.label === label)
    if (match) return match
  }
  return null
}

export function findQuotaProviderBySelectedModel(providers: QuotaProviderView[], providerID?: string): QuotaProviderView | null {
  if (!providerID) return providers[0] ?? null

  const ids = getQuotaProviderCandidates(providerID)
  return providers.find((p) => ids.includes(p.id)) ?? null
}

export function getQuotaPercentUsed(entry: Pick<QuotaEntryView, "used" | "total" | "percentUsed" | "unlimited">): number | null {
  if (entry.unlimited) return null
  if (entry.percentUsed !== undefined) return Math.max(0, Math.min(100, entry.percentUsed))
  if (entry.used !== undefined && entry.total !== undefined && entry.total > 0) {
    return Math.max(0, Math.min(100, (entry.used / entry.total) * 100))
  }
  return null
}

export function findPrimaryQuotaEntry(provider: Pick<QuotaProviderView, "id" | "entries"> | null | undefined): QuotaEntryView | null {
  if (!provider) return null

  if (provider.id === "anthropic") {
    return findQuotaEntryByLabels(provider.entries, ["Claude 5h", "Claude 7d"])
  }

  if (provider.id === "openai") {
    return findQuotaEntryByLabels(provider.entries, ["Primary Window", "Secondary Window"])
  }

  return provider.entries.find((entry) => getQuotaPercentUsed(entry) !== null) ?? provider.entries[0] ?? null
}

export function resolveQuotaProviderState(providers: QuotaProviderView[], providerID?: string) {
  const provider = findQuotaProviderBySelectedModel(providers, providerID)
  return {
    provider,
    entry: findPrimaryQuotaEntry(provider),
  }
}
