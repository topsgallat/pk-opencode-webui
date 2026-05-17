import { getProviderIDCandidates } from "../../../shared/provider-auth-session"
import type { QuotaProviderView } from "../../../shared/quota/types"

export function findQuotaProviderBySelectedModel(providers: QuotaProviderView[], providerID?: string): QuotaProviderView | null {
  if (!providerID) return providers[0] ?? null

  const ids = getProviderIDCandidates(providerID)
  return providers.find((p) => ids.includes(p.id)) ?? null
}
