import { QuotaFetchOptions, QuotaProvider, QuotaProviderView } from "../types"
import { loadAnthropicQuota } from "../../anthropic-quota"

type AnthropicOps = {
  run?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string } | null>
  readText?: (path: string) => Promise<string | undefined>
  fetch?: typeof fetch
  now?: () => number
}

export class AnthropicProvider implements QuotaProvider {
  id = "anthropic"
  name = "Anthropic / Claude.ai"

  constructor(private readonly ops?: AnthropicQuotaOps) {}

  async isAvailable(options?: QuotaFetchOptions): Promise<boolean> {
    const quota = await loadAnthropicQuota({ targetUrl: options?.targetUrl, ops: this.ops })
    return quota.entries.length > 0
  }

  async fetch(options: QuotaFetchOptions): Promise<QuotaProviderView> {
    const quota = await loadAnthropicQuota({ targetUrl: options?.targetUrl, refresh: options?.refresh, ops: this.ops })

    if (quota.entries.length === 0) {
      return {
        id: this.id,
        name: this.name,
        status: quota.warning ? "unavailable" : "error",
        available: false,
        fetchedAt: new Date().toISOString(),
        entries: [],
        warning: quota.warning || "Claude.ai quota data was not available",
      }
    }

    return {
      id: this.id,
      name: this.name,
      status: "ok",
      available: true,
      fetchedAt: new Date().toISOString(),
      entries: quota.entries,
      warning: quota.warning,
    }
  }
}
