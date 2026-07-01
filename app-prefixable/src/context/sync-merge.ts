import type { Part } from "../sdk/client"
import { projectedPartsWeight, sameProjectedParts } from "../utils/part-compare"

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

function comparePartPayloadSize(message: MergeMessage) {
  return projectedPartsWeight(message.parts)
}

function sameComparableParts(a: MergeMessage, b: MergeMessage) {
  return sameProjectedParts(a.parts, b.parts)
}

export function choosePreferredMessageForSyncMerge<T extends MergeMessage>(synced: T, existing: T) {
  const syncedCompleted = synced.info.time.completed
  const existingCompleted = existing.info.time.completed

  if (syncedCompleted != null && existingCompleted == null) return synced
  if (syncedCompleted == null && existingCompleted != null) return existing

  if (synced.info.role === "assistant" && existing.info.role === "assistant" && syncedCompleted != null && existingCompleted != null && syncedCompleted !== existingCompleted) {
    return syncedCompleted > existingCompleted ? synced : existing
  }

  const syncedRank = messageStatusRank(synced)
  const existingRank = messageStatusRank(existing)
  if (syncedRank !== existingRank) return syncedRank > existingRank ? synced : existing

  if (sameComparableParts(synced, existing)) return existing

  if (existing.parts.length !== synced.parts.length) return existing.parts.length > synced.parts.length ? existing : synced

  return comparePartPayloadSize(existing) >= comparePartPayloadSize(synced) ? existing : synced
}
