import { QuotaProvider, QuotaProviderView, QuotaApiResponse } from './types'
import { CopilotProvider } from './providers/copilot'
import { OpenAIProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini-cli'

export async function getQuotaData(options: {
  refresh?: boolean
  providerFilter?: string
  targetUrl?: string
  authHeader?: string
  resolveAuthHeader?: (target: string) => string | undefined
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
    if (options.providerFilter && provider.id !== options.providerFilter) continue

    try {
      const view = await provider.fetch(options)
      providerViews.push(view)

      if (view.status === 'ok' && view.available) {
        availableProviders.push(provider.id)
      } else {
        unavailableProviders.push({
          id: provider.id,
          reason: view.error || view.warning || 'Provider unavailable',
        })
      }

      if (view.warning) warnings.push(`${provider.name}: ${view.warning}`)
      if (view.error) warnings.push(`${provider.name}: ${view.error}`)
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
