export function shouldResetTimelineState(options: {
  previous: { sessionKey: string | undefined; turnIds: readonly string[] }
  current: { sessionKey: string | undefined; turnIds: readonly string[] }
}) {
  if (options.previous.sessionKey === undefined) return false
  return options.current.sessionKey !== options.previous.sessionKey
}
