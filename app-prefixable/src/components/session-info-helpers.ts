import { getProviderIDCandidates } from "../../../shared/provider-auth-session"
import type { QuotaProviderView } from "../../../shared/quota/types"

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

export function findQuotaProviderBySelectedModel(providers: QuotaProviderView[], providerID?: string): QuotaProviderView | null {
  if (!providerID) return providers[0] ?? null

  const ids = getQuotaProviderCandidates(providerID)
  return providers.find((p) => ids.includes(p.id)) ?? null
}
