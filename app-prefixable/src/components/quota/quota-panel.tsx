import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useBasePath } from '../../context/base-path'
import { getQuota } from '../../utils/extended-api'
import { QuotaProviderView } from '../../types/quota'
import { QuotaProviderCard } from './quota-provider-card'

export function QuotaContent() {
  const { serverUrl } = useBasePath()
  const [refreshing, setRefreshing] = createSignal(false)
  const [selectedProvider, setSelectedProvider] = createSignal<string>('all')

  const [quotaResource, { refetch }] = createResource(
    () => ({ serverUrl, refresh: false }),
    async ({ serverUrl }) => {
      return await getQuota(serverUrl)
    }
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await getQuota(serverUrl, { refresh: true })
      refetch()
    } catch (error) {
      console.error('Failed to refresh quota:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const providers = createMemo(() => quotaResource()?.providers ?? [])

  const filterOptions = createMemo(() => [
    { id: 'all', label: 'All providers' },
    ...providers().map(provider => ({ id: provider.id, label: provider.name })),
  ])

  const [visibleProviders, setVisibleProviders] = createSignal<QuotaProviderView[]>([])

  const applyProviderFilter = (id: string) => {
    if (typeof document === 'undefined') return

    document.querySelectorAll<HTMLElement>('[data-quota-provider-id]').forEach((card) => {
      card.hidden = id !== 'all' && card.dataset.quotaProviderId !== id
    })

    document.querySelectorAll<HTMLButtonElement>('[data-quota-filter-id]').forEach((button) => {
      const active = button.dataset.quotaFilterId === id
      button.setAttribute('aria-pressed', String(active))
      button.style.background = active ? 'var(--background-base)' : 'transparent'
      button.style.color = active ? 'var(--text-strong)' : 'var(--text-weak)'
      button.style.border = active ? '1px solid var(--border-base)' : '1px solid transparent'
    })
  }

  createEffect(() => {
    const data = providers()
    if (selectedProvider() === 'all') {
      setVisibleProviders(data)
      applyProviderFilter('all')
      return
    }

    const id = selectedProvider()
    setVisibleProviders(data.filter((provider: QuotaProviderView) => provider.id === id))
    applyProviderFilter(id)
  })

  const selectedProviderLabel = createMemo(() => {
    const option = filterOptions().find(option => option.id === selectedProvider())
    return option?.label ?? selectedProvider()
  })

  const fetchedLabel = createMemo(() => {
    const timestamp = quotaResource()?.fetchedAt
    if (!timestamp) return null
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  })

  const availableCount = createMemo(() => providers().filter(provider => provider.available).length)

  return (
    <div class="space-y-6">
      <header>
        <h1 class="text-lg font-medium" style={{ color: 'var(--text-strong)' }}>
          Quota
        </h1>
        <p class="mt-1 text-sm" style={{ color: 'var(--text-weak)' }}>
          Review provider limits and recent quota windows without leaving Settings.
        </p>
      </header>

      <section
        class="rounded-lg overflow-hidden"
        style={{
          background: 'var(--background-base)',
          border: '1px solid var(--border-base)',
        }}
      >
        <div
          class="flex flex-col gap-4 px-4 py-3 md:flex-row md:items-start md:justify-between"
          style={{ 'border-bottom': '1px solid var(--border-base)' }}
        >
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                Provider usage overview
              </h2>
              <Show when={providers().length > 0}>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    background: 'var(--surface-inset)',
                    color: 'var(--text-weak)',
                    border: '1px solid var(--border-base)',
                  }}
                >
                  {availableCount()} of {providers().length} available
                </span>
              </Show>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-weak)' }}>
              <span>{refreshing() ? 'Refreshing quota data…' : 'Live provider snapshots and account-level limits.'}</span>
              <Show when={fetchedLabel()}>
                {(label) => <span>Updated {label()}</span>}
              </Show>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing()}
            class="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-base)',
            }}
            onMouseEnter={(e) => {
              if (!refreshing()) e.currentTarget.style.background = 'var(--surface-raised)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface-inset)'
            }}
          >
            {refreshing() ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div class="space-y-4 p-4">
        <div
          class="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
          style={{
            background: 'var(--surface-inset)',
            border: '1px solid var(--border-base)',
          }}
        >
          <span class="pr-1 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-weak)' }}>
            Filter
          </span>
          <select
            value={selectedProvider()}
            onInput={(e) => setSelectedProvider(e.currentTarget.value)}
            class="min-w-40 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: 'var(--background-base)',
              color: 'var(--text-strong)',
              border: '1px solid var(--border-base)',
            }}
            aria-label="Filter quota providers"
          >
            <For each={filterOptions()}>
              {(option) => <option value={option.id}>{option.label}</option>}
            </For>
          </select>
        </div>

          <div class="space-y-4">
            <Show when={quotaResource.loading}>
              <div
                class="rounded-lg px-4 py-8 text-center"
                style={{
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border-base)',
                }}
              >
                <div class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                  Loading quota data
                </div>
                <p class="mt-1 text-sm" style={{ color: 'var(--text-weak)' }}>
                  Fetching the latest provider usage and reset windows.
                </p>
              </div>
            </Show>

            <Show when={quotaResource.error && !quotaResource.loading}>
              <div
                class="rounded-lg px-4 py-8 text-center"
                style={{
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border-base)',
                }}
              >
                <div class="text-sm font-medium" style={{ color: 'var(--text-critical-base)' }}>
                  Unable to load quota data
                </div>
                <p class="mt-1 text-sm" style={{ color: 'var(--text-weak)' }}>
                  {quotaResource.error.message}
                </p>
              </div>
            </Show>

            <Show when={quotaResource() && !quotaResource.loading && !quotaResource.error}>
              <Show
                when={visibleProviders().length > 0}
                fallback={
                  <div
                    class="rounded-lg px-4 py-8 text-center"
                    style={{
                      background: 'var(--surface-inset)',
                      border: '1px solid var(--border-base)',
                    }}
                  >
                    <div class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                      No quota entries for {selectedProviderLabel()}
                    </div>
                    <p class="mt-1 text-sm" style={{ color: 'var(--text-weak)' }}>
                      Try another provider filter or refresh to pull a newer snapshot.
                    </p>
                  </div>
                }
              >
                <For each={visibleProviders()}>
                  {(provider) => (
                    <div data-quota-provider-id={provider.id}>
                      <QuotaProviderCard provider={provider} />
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </section>
    </div>
  )
}
