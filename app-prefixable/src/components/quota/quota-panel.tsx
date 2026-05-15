import { createResource, createSignal } from 'solid-js'
import { useBasePath } from '../../context/base-path'
import { getQuota } from '../../utils/extended-api'
import { QuotaProviderView } from '../../types/quota'
import { QuotaProviderCard } from './quota-provider-card'

export function QuotaContent() {
  const { prefix } = useBasePath()
  const [refreshing, setRefreshing] = createSignal(false)
  const [selectedProvider, setSelectedProvider] = createSignal<string>('all')

  const [quotaResource, { refetch }] = createResource(
    () => ({ serverUrl: prefix(''), refresh: false }),
    async ({ serverUrl }) => {
      try {
        return await getQuota(serverUrl)
      } catch (error) {
        console.error('Failed to fetch quota:', error)
        return null
      }
    }
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const serverUrl = prefix('')
      await getQuota(serverUrl, { refresh: true })
      refetch()
    } catch (error) {
      console.error('Failed to refresh quota:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const filteredProviders = () => {
    const data = quotaResource()
    if (!data) return []

    if (selectedProvider() === 'all') return data.providers
    return data.providers.filter((p: QuotaProviderView) => p.id === selectedProvider())
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Quota Usage</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            View your usage across connected AI providers
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing()}
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshing() ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Filter */}
      <div class="flex gap-2">
        <button
          onClick={() => setSelectedProvider('all')}
          class={`px-3 py-1 rounded ${selectedProvider() === 'all' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}
        >
          All
        </button>
        <button
          onClick={() => setSelectedProvider('copilot')}
          class={`px-3 py-1 rounded ${selectedProvider() === 'copilot' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}
        >
          Copilot
        </button>
        <button
          onClick={() => setSelectedProvider('openai')}
          class={`px-3 py-1 rounded ${selectedProvider() === 'openai' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}
        >
          OpenAI
        </button>
        <button
          onClick={() => setSelectedProvider('gemini')}
          class={`px-3 py-1 rounded ${selectedProvider() === 'gemini' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}
        >
          Gemini
        </button>
      </div>

      {/* Content */}
      <div class="space-y-4">
        {quotaResource.loading && (
          <div class="text-center py-8">Loading quota data...</div>
        )}

        {quotaResource.error && (
          <div class="text-center py-8 text-red-600">
            Failed to load quota data: {quotaResource.error.message}
          </div>
        )}

        {quotaResource() && (
          <>
            {filteredProviders().map((provider: QuotaProviderView) => (
              <QuotaProviderCard provider={provider} />
            ))}
            {filteredProviders().length === 0 && (
              <div class="text-center py-8 text-gray-500">
                No quota data available for selected provider
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}