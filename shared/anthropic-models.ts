export function isAnthropicProviderID(providerID: string): boolean {
  return providerID === "anthropic" || providerID.startsWith("anthropic:")
}

export function normalizeAnthropicModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
