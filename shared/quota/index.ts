import { QuotaProvider, QuotaProviderView, QuotaApiResponse, QuotaFetchOptions } from './types'
import { CopilotProvider } from './providers/copilot'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini-cli'

export async function getQuotaData(options: {
  refresh?: boolean
  providerFilter?: string
  targetUrl?: string
  authHeader?: string
}): Promise<QuotaApiResponse> {
  const providers: QuotaProvider[] = [
    new CopilotProvider(),
    new OpenAIProvider(),
    new GeminiProvider(),
  ]

  const providerViews: QuotaProviderView[] = []
  const availableProviders: string[] = []
  const unavailableProviders: Array<{ id: string; reason: string }> = []
  const warnings: string[] = []

  for (const provider of providers) {
    try {
      const available = await provider.isAvailable()
      if (available) {
        availableProviders.push(provider.id)
        if (!options.providerFilter || provider.id === options.providerFilter) {
          const view = await provider.fetch(options)
          providerViews.push(view)
        }
      } else {
        unavailableProviders.push({ id: provider.id, reason: 'Provider not available' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      unavailableProviders.push({ id: provider.id, reason: message })
      warnings.push(`${provider.name}: ${message}`)
    }
  }

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    refreshed: options.refresh || false,
    source: options.refresh ? 'live' : 'cache',
    providers: providerViews,
    summary: {
      availableProviders,
      unavailableProviders,
      hasWarnings: warnings.length > 0
    },
    warnings
  }
}
