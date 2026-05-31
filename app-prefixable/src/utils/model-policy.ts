import type { ProviderConfig } from "../sdk/client"

function hasModelPolicy(config?: ProviderConfig) {
  return Array.isArray(config?.whitelist) || Array.isArray(config?.blacklist)
}

export function providerBaseID(providerID: string) {
  const idx = providerID.indexOf(":")
  return idx > 0 ? providerID.slice(0, idx) : providerID
}

export function providerModelConfig(
  providerID: string,
  globalProviders: Record<string, ProviderConfig>,
  legacyProjectProviders: Record<string, ProviderConfig>,
) {
  const base = providerBaseID(providerID)
  const configs = [
    globalProviders[providerID],
    globalProviders[base],
    legacyProjectProviders[providerID],
    legacyProjectProviders[base],
  ]
  return configs.find(hasModelPolicy)
}

export function modelPolicyEnabled(
  providerID: string,
  modelID: string,
  globalProviders: Record<string, ProviderConfig>,
  legacyProjectProviders: Record<string, ProviderConfig>,
) {
  const provider = providerModelConfig(providerID, globalProviders, legacyProjectProviders)
  if (provider?.whitelist) return provider.whitelist.includes(modelID)
  if (provider?.blacklist) return !provider.blacklist.includes(modelID)
  return true
}
