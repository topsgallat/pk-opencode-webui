import { QuotaEntryView } from '../../types/quota'

interface QuotaEntryBarProps {
  entry: QuotaEntryView
}

export function QuotaEntryBar(props: QuotaEntryBarProps) {
  const formatNumber = (num?: number) => {
    if (num === undefined) return '—'
    return num.toLocaleString()
  }

  const formatPercent = (percent?: number) => {
    if (percent === undefined) return ''
    return `${percent.toFixed(0)}%`
  }

  const progressWidth = () => {
    if (props.entry.percentUsed !== undefined) {
      return `${props.entry.percentUsed}%`
    }
    if (props.entry.used !== undefined && props.entry.total !== undefined) {
      return `${(props.entry.used / props.entry.total) * 100}%`
    }
    return '0%'
  }

  const resetTime = () => {
    if (!props.entry.resetTimeIso) return null
    const date = new Date(props.entry.resetTimeIso)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()

    if (diffMs <= 0) return 'Reset pending'

    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return `Resets in ${hours}h ${minutes}m`
    } else if (minutes > 0) {
      return `Resets in ${minutes}m`
    } else {
      return 'Resets soon'
    }
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
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium">{props.entry.label}</span>
            {props.entry.subtitle && (
              <span class="text-sm text-gray-600 dark:text-gray-400">
                {props.entry.subtitle}
              </span>
            )}
            {windowLabel() && (
              <span class="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                {windowLabel()}
              </span>
            )}
          </div>
          {props.entry.group && props.entry.group !== 'usage' && (
            <div class="text-sm text-gray-500">{props.entry.group}</div>
          )}
        </div>
        <div class="text-right text-sm">
          {props.entry.unlimited ? (
            <span class="text-green-600 font-medium">Unlimited</span>
          ) : (
            <>
              {props.entry.used !== undefined && props.entry.total !== undefined ? (
                <div>{formatNumber(props.entry.used)} / {formatNumber(props.entry.total)}</div>
              ) : props.entry.remaining !== undefined ? (
                <div>{formatNumber(props.entry.remaining)} remaining</div>
              ) : null}
              {resetTime() && (
                <div class="text-gray-500">{resetTime()}</div>
              )}
            </>
          )}
        </div>
      </div>

      {!props.entry.unlimited && (props.entry.percentUsed !== undefined || (props.entry.used && props.entry.total)) && (
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: progressWidth() }}
          />
        </div>
      )}

      {props.entry.rightText && (
        <div class="text-sm text-gray-600 dark:text-gray-400 text-right">
          {props.entry.rightText}
        </div>
      )}
    </div>
  )
}