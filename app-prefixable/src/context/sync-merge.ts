import type { Part } from "../sdk/client"

export type MergeMessage = {
  info: {
    id: string
    role: string
    sessionID?: string
    time: { created: number; completed?: number }
  }
  parts: Part[]
}

function partStatusRank(part: Part) {
  const state = (part as { state?: { status?: string } }).state
  if (!state?.status) return 0
  if (state.status === "completed" || state.status === "error") return 2
  if (state.status === "running" || state.status === "pending") return 1
  return 0
}

function messageStatusRank(message: MergeMessage) {
  return message.parts.reduce((rank, part) => Math.max(rank, partStatusRank(part)), 0)
}

function comparableParts(parts: Part[]) {
  return parts.map((part) => {
    if (part.type === "text") return { type: part.type, text: part.text }
    if (part.type === "reasoning") return { type: part.type, text: part.text }
    if (part.type === "file") return { type: part.type, mime: part.mime, filename: part.filename, url: part.url }
    if (part.type === "tool") return { type: part.type, tool: part.tool, state: part.state }
    return { type: part.type }
  })
}

function comparePartPayloadSize(message: MergeMessage) {
  return JSON.stringify(comparableParts(message.parts)).length
}

export function choosePreferredMessageForSyncMerge<T extends MergeMessage>(synced: T, existing: T) {
  if (synced.info.role === "assistant" && synced.info.time.completed) return synced

  const syncedRank = messageStatusRank(synced)
  const existingRank = messageStatusRank(existing)
  if (syncedRank !== existingRank) return syncedRank > existingRank ? synced : existing

  if (existing.parts.length !== synced.parts.length) return existing.parts.length > synced.parts.length ? existing : synced

  return comparePartPayloadSize(existing) >= comparePartPayloadSize(synced) ? existing : synced
}
