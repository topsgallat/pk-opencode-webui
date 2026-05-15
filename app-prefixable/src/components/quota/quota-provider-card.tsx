import { QuotaProviderView } from '../../types/quota'
import { QuotaEntryBar } from './quota-entry-bar'

interface QuotaProviderCardProps {
  provider: QuotaProviderView
}

export function QuotaProviderCard(props: QuotaProviderCardProps) {
  const statusColor = () => {
    switch (props.provider.status) {
      case 'ok': return 'text-green-600'
      case 'error': return 'text-red-600'
      case 'unavailable': return 'text-yellow-600'
      default: return 'text-gray-600'
    }
  }

  const statusText = () => {
    switch (props.provider.status) {
      case 'ok': return 'Available'
      case 'error': return 'Error'
      case 'unavailable': return 'Unavailable'
      default: return 'Unknown'
    }
  }

  return (
    <div class="border rounded-lg p-4 space-y-4">
      {/* Provider Header */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <h3 class="font-semibold text-lg">{props.provider.name}</h3>
          <span class={`text-sm font-medium ${statusColor()}`}>
            {statusText()}
          </span>
          {props.provider.matchedCurrentModel && (
            <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
              Current Model
            </span>
          )}
        </div>
        {props.provider.fetchedAt && (
          <span class="text-sm text-gray-500">
            Updated {new Date(props.provider.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error/Warning Messages */}
      {props.provider.error && (
        <div class="bg-red-50 border border-red-200 rounded p-3">
          <p class="text-red-800 text-sm">{props.provider.error}</p>
        </div>
      )}

      {props.provider.warning && (
        <div class="bg-yellow-50 border border-yellow-200 rounded p-3">
          <p class="text-yellow-800 text-sm">{props.provider.warning}</p>
        </div>
      )}

      {/* Quota Entries */}
      <div class="space-y-3">
        {props.provider.entries.map(entry => (
          <QuotaEntryBar entry={entry} />
        ))}
      </div>

      {/* Accounts Section */}
      {props.provider.accounts && props.provider.accounts.length > 0 && (
        <div class="border-t pt-4">
          <h4 class="font-medium mb-3">Accounts</h4>
          <div class="space-y-3">
            {props.provider.accounts.map(account => (
              <div class="bg-gray-50 dark:bg-gray-800 rounded p-3">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-medium">{account.label}</span>
                  {account.email && (
                    <span class="text-sm text-gray-600">{account.email}</span>
                  )}
                </div>
                <div class="space-y-2">
                  {account.entries.map(entry => (
                    <QuotaEntryBar entry={entry} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}