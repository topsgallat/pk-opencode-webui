import { For, Show } from 'solid-js'
import { QuotaProviderView } from '../../types/quota'
import { QuotaEntryBar } from './quota-entry-bar'

interface QuotaProviderCardProps {
  provider: QuotaProviderView
}

export function QuotaProviderCard(props: QuotaProviderCardProps) {
  const hasAccounts = () => Boolean(props.provider.accounts?.length)

  const statusTheme = () => {
    switch (props.provider.status) {
      case 'ok':
        return {
          label: 'Available',
          background: 'var(--surface-inset)',
          color: 'var(--icon-success-base)',
          border: '1px solid var(--border-base)',
        }
      case 'error':
        return {
          label: 'Error',
          background: 'var(--surface-critical-subtle)',
          color: 'var(--text-critical-base)',
          border: '1px solid var(--border-critical-base)',
        }
      case 'unavailable':
        return {
          label: 'Unavailable',
          background: 'var(--status-warning-dim)',
          color: 'var(--status-warning-text)',
          border: '1px solid var(--status-warning-border)',
        }
      default:
        return {
          label: 'Unknown',
          background: 'var(--surface-inset)',
          color: 'var(--text-weak)',
          border: '1px solid var(--border-base)',
        }
    }
  }

  const alertTheme = (kind: 'error' | 'warning') => {
    if (kind === 'error') {
      return {
        background: 'var(--surface-critical-subtle)',
        border: '1px solid var(--border-critical-base)',
        accent: '3px solid var(--text-critical-base)',
        color: 'var(--text-critical-base)',
      }
    }

    return {
      background: 'var(--status-warning-dim)',
      border: '1px solid var(--status-warning-border)',
      accent: '3px solid var(--status-warning-text)',
      color: 'var(--status-warning-text)',
    }
  }

  const updatedAt = () => {
    if (!props.provider.fetchedAt) return null
    return new Date(props.provider.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <section
      class="rounded-lg overflow-hidden"
      style={{
        background: 'var(--background-base)',
        border: '1px solid var(--border-base)',
      }}
      aria-label={`${props.provider.name} quota`}
    >
      <div class="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div class="min-w-0 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
              {props.provider.name}
            </h3>
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: statusTheme().background,
                color: statusTheme().color,
                border: statusTheme().border,
              }}
            >
              {statusTheme().label}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-weak)' }}>
            <Show when={!hasAccounts()}>
              <span>{props.provider.entries.length} provider entr{props.provider.entries.length === 1 ? 'y' : 'ies'}</span>
            </Show>
            <Show when={hasAccounts()}>
              <span>{props.provider.accounts?.length} account{props.provider.accounts?.length === 1 ? '' : 's'}</span>
            </Show>
          </div>
        </div>

        <Show when={updatedAt()}>
          {(label) => (
            <div class="shrink-0 text-xs text-left md:text-right" style={{ color: 'var(--text-weak)' }}>
              <div>Updated</div>
              <div style={{ color: 'var(--text-base)' }}>{label()}</div>
            </div>
          )}
        </Show>
      </div>

      <div class="px-4 pb-4 space-y-3">
        <Show when={props.provider.error}>
          {(message) => (
            <div
              class="rounded-md px-3 py-2 text-sm"
              style={{
                background: alertTheme('error').background,
                border: alertTheme('error').border,
                'border-left': alertTheme('error').accent,
                color: alertTheme('error').color,
              }}
            >
              {message()}
            </div>
          )}
        </Show>

        <Show when={props.provider.warning}>
          {(message) => (
            <div
              class="rounded-md px-3 py-2 text-sm"
              style={{
                background: alertTheme('warning').background,
                border: alertTheme('warning').border,
                'border-left': alertTheme('warning').accent,
                color: alertTheme('warning').color,
              }}
            >
              {message()}
            </div>
          )}
        </Show>

        <Show when={!hasAccounts()}>
          <div
            class="rounded-lg px-3 py-3 space-y-2.5"
            style={{
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-base)',
            }}
          >
            <div class="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-weak)' }}>
              Provider limits
            </div>
            <Show
              when={props.provider.entries.length > 0}
              fallback={
                <p class="text-sm" style={{ color: 'var(--text-weak)' }}>
                  No provider-level quota details reported.
                </p>
              }
            >
              <div class="space-y-2.5">
                <For each={props.provider.entries}>
                  {(entry) => <QuotaEntryBar entry={entry} />}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.provider.accounts && props.provider.accounts.length > 0}>
          <div class="space-y-3" style={{ 'border-top': '1px solid var(--border-base)', padding: '0.75rem 0 0' }}>
            <div class="flex items-center justify-between gap-3">
              <h4 class="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-weak)' }}>
                Accounts
              </h4>
              <span class="text-xs" style={{ color: 'var(--text-weak)' }}>
                {props.provider.accounts!.length} connected
              </span>
            </div>

            <div class="space-y-3">
              <For each={props.provider.accounts}>
                {(account) => (
                  <div
                    class="rounded-lg px-3 py-3 space-y-2.5"
                    style={{
                      background: 'var(--surface-inset)',
                      border: '1px solid var(--border-base)',
                    }}
                  >
                    <div class="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                      <div class="min-w-0">
                        <div class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                          {account.label}
                        </div>
                        <Show when={account.email}>
                          {(email) => (
                            <div class="text-xs truncate" style={{ color: 'var(--text-weak)' }}>
                              {email()}
                            </div>
                          )}
                        </Show>
                      </div>
                      <div class="text-xs" style={{ color: 'var(--text-weak)' }}>
                        {account.entries.length} entr{account.entries.length === 1 ? 'y' : 'ies'}
                      </div>
                    </div>

                    <div class="space-y-2.5">
                      <For each={account.entries}>
                        {(entry) => <QuotaEntryBar entry={entry} />}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </section>
  )
}
