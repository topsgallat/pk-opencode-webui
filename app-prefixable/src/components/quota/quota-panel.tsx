import { createEffect, createMemo, createResource, createSignal, For, Show, onCleanup } from 'solid-js'
import { useBasePath } from '../../context/base-path'
import { useSDK } from '../../context/sdk'
import { getQuota } from '../../utils/extended-api'
import { loadSettings, saveSetting } from '../../utils/settings-api'
import { QuotaProviderView } from '../../types/quota'
import { QUOTA_PROVIDER_CATALOG } from '../../../../shared/quota/provider-catalog'
import { QuotaProviderCard } from './quota-provider-card'

export function QuotaContent() {
  const { serverUrl } = useBasePath()
  const { targetUrl } = useSDK()
  const [refreshing, setRefreshing] = createSignal(false)
  const [selectedProvider, setSelectedProvider] = createSignal<string>('all')
  const [clock, setClock] = createSignal(Date.now())
  const [disabledProviders, setDisabledProviders] = createSignal<string[]>([])

  const [goWorkspaceId, setGoWorkspaceId] = createSignal('')
  const [goAuthCookie, setGoAuthCookie] = createSignal('')
  const [goSaving, setGoSaving] = createSignal(false)
  const [goSavedAt, setGoSavedAt] = createSignal<string | null>(null)

  const [settings] = createResource(
    () => serverUrl,
    async (url) => {
      const [quotaData, goData] = await Promise.all([
        loadSettings(url, "quota"),
        loadSettings(url, "opencode-go"),
      ])
      const ids = Array.isArray(quotaData?.disabledProviders) ? quotaData.disabledProviders.filter((id: unknown): id is string => typeof id === "string") : []
      setDisabledProviders(ids)
      if (typeof goData?.workspaceId === "string") setGoWorkspaceId(goData.workspaceId)
      if (typeof goData?.authCookie === "string") setGoAuthCookie(goData.authCookie)
      return { quota: quotaData, go: goData }
    },
  )

  const goConfigured = createMemo(() => Boolean(goWorkspaceId().trim() && goAuthCookie().trim()))

  const handleSaveGoConfig = async () => {
    setGoSaving(true)
    try {
      await saveSetting(serverUrl, "opencode-go", "workspaceId", goWorkspaceId().trim())
      await saveSetting(serverUrl, "opencode-go", "authCookie", goAuthCookie().trim())
      setGoSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      refetch()
    } catch (error) {
      console.error("Failed to save OpenCode Go config:", error)
    } finally {
      setGoSaving(false)
    }
  }

  const toggleProvider = async (id: string) => {
    const next = disabledProviders().includes(id)
      ? disabledProviders().filter((p) => p !== id)
      : [...disabledProviders(), id]
    setDisabledProviders(next)
    try {
      await saveSetting(serverUrl, "quota", "disabledProviders", next)
      refetch()
    } catch (error) {
      console.error("Failed to save provider toggle:", error)
    }
  }

  const [quotaResource, { refetch }] = createResource(
    () => ({ serverUrl, settings: settings(), refresh: false }),
    async ({ serverUrl }) => {
      return await getQuota(serverUrl, { targetUrl })
    }
  )

  const handleRefresh = async () => {
    if (anthropicCoolingDown()) return

    setRefreshing(true)
    try {
      await getQuota(serverUrl, { refresh: true, targetUrl })
      refetch()
    } catch (error) {
      console.error('Failed to refresh quota:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const providers = createMemo(() => quotaResource()?.providers ?? [])
  const anthropicProvider = createMemo(() => providers().find((provider) => provider.id === 'anthropic') ?? null)
  const anthropicCooldownUntil = createMemo(() => anthropicProvider()?.cooldownUntil ?? null)
  const anthropicCoolingDown = createMemo(() => {
    const cooldownUntil = anthropicCooldownUntil()
    if (!cooldownUntil) return false

    const cooldownAt = Date.parse(cooldownUntil)
    return !Number.isNaN(cooldownAt) && clock() < cooldownAt
  })

  createEffect(() => {
    const cooldownUntil = anthropicCooldownUntil()
    if (!cooldownUntil) return

    const cooldownAt = Date.parse(cooldownUntil)
    if (Number.isNaN(cooldownAt)) return

    const delay = Math.max(0, cooldownAt - Date.now()) + 1_000
    const timer = setTimeout(() => setClock(Date.now()), delay)
    onCleanup(() => clearTimeout(timer))
  })

  const filterOptions = createMemo(() => [
    { id: 'all', label: 'All providers' },
    ...QUOTA_PROVIDER_CATALOG.map(provider => ({ id: provider.id, label: provider.name })),
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
  const refreshDisabled = createMemo(() => refreshing() || anthropicCoolingDown())
  const refreshLabel = createMemo(() => {
    if (refreshing()) return 'Refreshing…'
    if (!anthropicCoolingDown()) return 'Refresh'

    const cooldownUntil = anthropicCooldownUntil()
    if (!cooldownUntil) return 'Rate limited'

    const at = new Date(cooldownUntil)
    return `Rate limited until ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  })

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
            disabled={refreshDisabled()}
            class="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-base)',
            }}
            onMouseEnter={(e) => {
              if (!refreshDisabled()) e.currentTarget.style.background = 'var(--surface-raised)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface-inset)'
            }}
          >
            {refreshLabel()}
          </button>
        </div>

        <Show when={anthropicCoolingDown()}>
          <div class="px-4 text-xs" style={{ color: 'var(--status-warning-text)' }}>
            Anthropic is cooling down to avoid 429s. Manual refresh will re-enable after the retry window.
          </div>
        </Show>

        <div
          class="mx-4 my-4 rounded-lg p-4 space-y-3"
          style={{
            background: 'var(--surface-inset)',
            border: '1px solid var(--border-base)',
          }}
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
              OpenCode Go credentials
            </h3>
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: goConfigured() ? 'var(--surface-raised)' : 'var(--background-base)',
                color: goConfigured() ? 'var(--icon-success-base)' : 'var(--text-weak)',
                border: '1px solid var(--border-base)',
              }}
            >
              {goConfigured() ? 'Configured' : 'Not configured'}
            </span>
            <Show when={goSavedAt()}>
              <span class="text-xs" style={{ color: 'var(--text-weak)' }}>
                Saved at {goSavedAt()}
              </span>
            </Show>
          </div>
          <p class="text-xs" style={{ color: 'var(--text-weak)' }}>
            Enter your OpenCode workspace ID and auth cookie to display Go plan usage. Both values come from the opencode.ai website while you are logged in.
          </p>
          <details class="text-xs" style={{ color: 'var(--text-weak)' }}>
            <summary class="cursor-pointer select-none" style={{ color: 'var(--text-weak)' }}>
              How to find these values
            </summary>
            <div class="mt-2 space-y-2 pl-1">
              <div>
                <strong style={{ color: 'var(--text-base)' }}>Workspace ID</strong>
                <ol class="mt-1 list-decimal list-inside space-y-0.5">
                  <li>Open <a href="https://opencode.ai/" target="_blank" rel="noreferrer" style={{ color: 'var(--text-base)', 'text-decoration': 'underline' }}>opencode.ai</a> and sign in.</li>
                  <li>Go to your dashboard — the URL will look like <code style={{ 'font-family': 'var(--font-mono, monospace)' }}>https://opencode.ai/workspace/<strong>wk_xxx…</strong>/usage</code>.</li>
                  <li>The <strong>workspace ID</strong> is the <code>wk_…</code> segment in that URL. Copy it into the field above.</li>
                </ol>
              </div>
              <div>
                <strong style={{ color: 'var(--text-base)' }}>Auth cookie</strong>
                <ol class="mt-1 list-decimal list-inside space-y-0.5">
                  <li>While on the opencode.ai site, open your browser DevTools (F12, or right-click → Inspect).</li>
                  <li>Go to the <strong>Application</strong> tab → <strong>Storage</strong> → <strong>Cookies</strong> → <code>https://opencode.ai</code>.</li>
                  <li>Find the cookie named <code>auth</code> (it is httpOnly, so you may need to copy the value via the row's edit field).</li>
                  <li>Copy the cookie <em>value</em> (not the name) into the field above. It is a long opaque string.</li>
                </ol>
              </div>
              <p class="text-[11px]" style={{ color: 'var(--text-weak)' }}>
                The cookie is stored locally on this server only and is sent directly to opencode.ai. Sign out of opencode.ai to invalidate it.
              </p>
            </div>
          </details>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label class="flex-1 space-y-1">
              <span class="text-xs font-medium" style={{ color: 'var(--text-weak)' }}>Workspace ID</span>
              <input
                type="text"
                value={goWorkspaceId()}
                onInput={(e) => setGoWorkspaceId(e.currentTarget.value)}
                placeholder="e.g. wk_abc123"
                class="w-full rounded-md px-3 py-2 text-sm"
                style={{
                  background: 'var(--background-base)',
                  color: 'var(--text-strong)',
                  border: '1px solid var(--border-base)',
                }}
              />
            </label>
            <label class="flex-1 space-y-1">
              <span class="text-xs font-medium" style={{ color: 'var(--text-weak)' }}>Auth cookie</span>
              <input
                type="password"
                value={goAuthCookie()}
                onInput={(e) => setGoAuthCookie(e.currentTarget.value)}
                placeholder="auth cookie value"
                class="w-full rounded-md px-3 py-2 text-sm font-mono"
                style={{
                  background: 'var(--background-base)',
                  color: 'var(--text-strong)',
                  border: '1px solid var(--border-base)',
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleSaveGoConfig}
              disabled={goSaving()}
              class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-base)',
                color: 'var(--text-strong)',
              }}
            >
              {goSaving() ? 'Saving…' : 'Save & refresh'}
            </button>
          </div>
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

        <Show when={providers().length > 0}>
          <div
            class="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
            style={{
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-base)',
            }}
          >
            <span class="pr-1 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-weak)' }}>
              Fetch
            </span>
            <For each={QUOTA_PROVIDER_CATALOG}>
              {(provider) => {
                const isDisabled = () => disabledProviders().includes(provider.id)
                return (
                  <button
                    type="button"
                    onClick={() => toggleProvider(provider.id)}
                    class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: isDisabled() ? 'var(--background-base)' : 'var(--interactive-base)',
                      color: isDisabled() ? 'var(--text-weak)' : 'white',
                      border: '1px solid var(--border-base)',
                    }}
                    aria-pressed={!isDisabled()}
                  >
                    <span
                      class="inline-block w-2 h-2 rounded-full"
                      style={{ background: isDisabled() ? 'var(--status-warning-text)' : 'var(--icon-success-base)' }}
                    />
                    {provider.name}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

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
