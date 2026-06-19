import { QuotaProvider, QuotaProviderView, QuotaApiResponse } from './types'
import { AnthropicProvider } from './providers/anthropic'
import { CopilotProvider } from './providers/copilot'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini-cli'

export async function getQuotaData(options: {
  refresh?: boolean
  providerFilter?: string
  targetUrl?: string
  projectDir?: string
  skipProviders?: string[]
  authHeader?: string
  resolveAuthHeader?: (target: string) => string | undefined
  resolveProviderAuthHeader?: (providerID: string) => string | undefined
  resolveProviderAuthAccountId?: (providerID: string) => string | undefined
}): Promise<QuotaApiResponse> {
  const providers: QuotaProvider[] = [
    new CopilotProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GeminiProvider(),
  ]

  const providerViews: QuotaProviderView[] = []
  const availableProviders: string[] = []
  const unavailableProviders: Array<{ id: string; reason: string }> = []
  const warnings: string[] = []
  const skipSet = new Set(options.skipProviders ?? [])

  for (const provider of providers) {
    if (skipSet.has(provider.id)) continue
    if (options.providerFilter && provider.id !== options.providerFilter) continue

    try {
      const view = await provider.fetch(options)
      const reason = view.error || view.warning || (view.status !== 'ok' ? 'Provider unavailable' : undefined)
      providerViews.push(reason ? { ...view, reason } : view)

      if (view.status === 'ok' && view.available) {
        availableProviders.push(provider.id)
      } else {
        unavailableProviders.push({
          id: provider.id,
          reason: reason || 'Provider unavailable',
        })
      }

      if (view.warning) warnings.push(`${provider.name}: ${view.warning}`)
      if (view.error) warnings.push(`${provider.name}: ${view.error}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      providerViews.push({
        id: provider.id,
        name: provider.name,
        status: 'error',
        available: false,
        entries: [],
        error: message,
        reason: message,
      })
      unavailableProviders.push({ id: provider.id, reason: message })
      warnings.push(`${provider.name}: ${message}`)
    }
  }

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    refreshed: options.refresh || false,
    source: 'live',
    providers: providerViews,
    summary: {
      availableProviders,
      unavailableProviders,
      hasWarnings: warnings.length > 0
    },
    warnings
  }
}
