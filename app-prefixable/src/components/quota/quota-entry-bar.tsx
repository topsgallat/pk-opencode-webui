import { Show } from 'solid-js'
import { QuotaEntryView } from '../../types/quota'

interface QuotaEntryBarProps {
  entry: QuotaEntryView
}

export function QuotaEntryBar(props: QuotaEntryBarProps) {
  const formatNumber = (num?: number) => {
    if (num === undefined) return '—'
    return num.toLocaleString()
  }

  const percentUsed = () => {
    if (props.entry.percentUsed !== undefined) return Math.max(0, Math.min(100, props.entry.percentUsed))
    if (props.entry.used !== undefined && props.entry.total !== undefined && props.entry.total > 0) {
      return Math.max(0, Math.min(100, (props.entry.used / props.entry.total) * 100))
    }
    return null
  }

  const percentLabel = () => {
    const percent = percentUsed()
    if (percent === null) return null
    return `${percent.toFixed(0)}% used`
  }

  const progressWidth = () => {
    const percent = percentUsed()
    if (percent === null) return '0%'
    return `${percent}%`
  }

  const progressColor = () => {
    const percent = percentUsed()
    if (percent === null) return 'var(--text-weak)'
    if (percent >= 90) return 'var(--text-critical-base)'
    if (percent >= 75) return 'var(--status-warning-text)'
    return 'var(--icon-success-base)'
  }

  const resetTime = () => {
    if (!props.entry.resetTimeIso) return null
    const date = new Date(props.entry.resetTimeIso)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()

    if (diffMs <= 0) return 'Reset pending'

    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) return `Resets in ${hours}h ${minutes}m`
    if (minutes > 0) return `Resets in ${minutes}m`
    return 'Resets soon'
  }

  const windowLabel = () => {
    switch (props.entry.window) {
      case 'hourly': return 'Hourly'
      case 'daily': return 'Daily'
      case 'weekly': return 'Weekly'
      case 'monthly': return 'Monthly'
      default: return props.entry.window || ''
    }
  }

  return (
    <div
      class="rounded-md px-3 py-2.5 space-y-2"
      style={{
        background: 'var(--background-base)',
        border: '1px solid var(--border-base)',
      }}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
              {props.entry.label}
            </span>

            <Show when={windowLabel()}>
              {(label) => (
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    background: 'var(--surface-inset)',
                    color: 'var(--text-weak)',
                    border: '1px solid var(--border-base)',
                  }}
                >
                  {label()}
                </span>
              )}
            </Show>

            <Show when={props.entry.group && props.entry.group !== 'usage'}>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  background: 'var(--surface-inset)',
                  color: 'var(--text-weak)',
                  border: '1px solid var(--border-base)',
                }}
              >
                {props.entry.group}
              </span>
            </Show>
          </div>

          <Show when={props.entry.subtitle}>
            {(subtitle) => (
              <div class="text-xs" style={{ color: 'var(--text-weak)' }}>
                {subtitle()}
              </div>
            )}
          </Show>
        </div>

        <div class="shrink-0 text-right space-y-0.5">
          <Show
            when={props.entry.unlimited}
            fallback={
              <>
                <Show when={props.entry.used !== undefined && props.entry.total !== undefined}>
                  <div class="text-sm font-medium" style={{ color: 'var(--text-base)' }}>
                    {formatNumber(props.entry.used)} / {formatNumber(props.entry.total)}
                  </div>
                </Show>
                <Show when={props.entry.used === undefined || props.entry.total === undefined}>
                  <Show when={props.entry.remaining !== undefined}>
                    <div class="text-sm font-medium" style={{ color: 'var(--text-base)' }}>
                      {formatNumber(props.entry.remaining)} remaining
                    </div>
                  </Show>
                </Show>
                <Show when={percentLabel()}>
                  {(label) => (
                    <div class="text-xs" style={{ color: 'var(--text-weak)' }}>
                      {label()}
                    </div>
                  )}
                </Show>
                <Show when={resetTime()}>
                  {(label) => (
                    <div class="text-xs" style={{ color: 'var(--text-weak)' }}>
                      {label()}
                    </div>
                  )}
                </Show>
              </>
            }
          >
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: 'var(--surface-inset)',
                color: 'var(--icon-success-base)',
                border: '1px solid var(--border-base)',
              }}
            >
              Unlimited
            </span>
          </Show>
        </div>
      </div>

      <Show when={!props.entry.unlimited && percentUsed() !== null}>
        <div class="space-y-1.5">
          <div class="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-inset)' }}>
            <div
              class="h-full rounded-full transition-all duration-300"
              style={{
                width: progressWidth(),
                background: progressColor(),
              }}
            />
          </div>
        </div>
      </Show>

      <Show when={props.entry.rightText}>
        {(text) => (
          <div class="text-xs" style={{ color: 'var(--text-weak)' }}>
            {text()}
          </div>
        )}
      </Show>
    </div>
  )
}
