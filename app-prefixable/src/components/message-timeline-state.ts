export function shouldResetTimelineState(options: {
  previous: { sessionKey: string | undefined; turnIds: readonly string[] }
  current: { sessionKey: string | undefined; turnIds: readonly string[] }
}) {
  if (options.previous.sessionKey === undefined) return false
  return options.current.sessionKey !== options.previous.sessionKey
}

// Which real turn should be treated as "active" (i.e. gets the live queue
// state / spinner) while the session is processing.
export function resolveActiveTurnId(options: {
  turns: readonly { id: string; hasIncompleteAssistant: boolean }[]
  activeTurnId: string | undefined
  processing: boolean
}): string | undefined {
  const { turns, activeTurnId, processing } = options
  if (turns.length === 0) return activeTurnId

  const explicit = activeTurnId && turns.some((turn) => turn.id === activeTurnId) ? activeTurnId : undefined

  if (!processing) return explicit

  // A just-echoed turn (explicit) has no assistant message yet, so it must
  // win over the incomplete-assistant heuristic below -- otherwise it never
  // gets recognized as active until the backend starts streaming, which is
  // exactly the window where its "thinking" placeholder needs to show.
  if (explicit) return explicit

  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].hasIncompleteAssistant) return turns[i].id
  }
  return undefined
}
