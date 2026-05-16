import { getProviderIDCandidates } from "../../../shared/provider-auth-session"

export function findQuotaProviderBySelectedModel(providers: { id: string }[], providerID?: string): { id: string } | null {
  if (!providerID) return providers[0] ?? null

  const ids = getProviderIDCandidates(providerID)
  return providers.find((p) => ids.includes(p.id)) ?? null
}
