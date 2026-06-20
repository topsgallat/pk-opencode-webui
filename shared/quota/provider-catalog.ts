export type QuotaProviderCatalogItem = {
  id: string
  name: string
}

export const QUOTA_PROVIDER_CATALOG: QuotaProviderCatalogItem[] = [
  { id: "copilot", name: "GitHub Copilot" },
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic / Claude.ai" },
  { id: "gemini", name: "Google Gemini" },
]

export function quotaProviderName(id: string): string {
  return QUOTA_PROVIDER_CATALOG.find((provider) => provider.id === id)?.name ?? id
}
