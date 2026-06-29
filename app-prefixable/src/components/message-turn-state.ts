export function getRealTurnDefaultExpanded(options: {
  savedExpanded: boolean | undefined
  processing: boolean
  isActiveRealTurn: boolean
  isLastRealTurn: boolean
}) {
  if (options.processing && options.isActiveRealTurn) return true
  if (options.savedExpanded !== undefined) return options.savedExpanded
  return !options.processing && options.isLastRealTurn
}

export function shouldReopenExpandedState(options: {
  prevTurnId: string | undefined
  prevStreaming: boolean
  prevDefaultExpanded: boolean
  turnId: string
  streaming: boolean
  defaultExpanded: boolean
}) {
  if (!options.streaming || !options.defaultExpanded) return false
  return (
    options.turnId !== options.prevTurnId ||
    !options.prevStreaming ||
    !options.prevDefaultExpanded
  )
}

export function shouldRestoreExpandedState(options: {
  prevTurnId: string | undefined
  prevStreaming: boolean
  turnId: string
  streaming: boolean
  savedExpanded: boolean | undefined
}) {
  if (options.savedExpanded === undefined) return false
  if (options.turnId !== options.prevTurnId) return false
  if (!options.prevStreaming || options.streaming) return false
  return true
}
