import type { Part, AssistantMessage } from "../sdk/client"
import type { DisplayMessage, Turn } from "../types/message"
import { sameProjectedParts } from "./part-compare"

export interface SyncMessageLike {
  info: {
    id: string
    role: DisplayMessage["role"]
    time: { created: number; completed?: number }
    error?: AssistantMessage["error"]
    tokens?: AssistantMessage["tokens"]
    modelID?: string
    providerID?: string
    agent?: string
  }
  parts: Part[]
}

export interface OptimisticQueueMessage {
  id: string
  expectedUserMessageIndex: number
  message: DisplayMessage
}

function sameTime(a: DisplayMessage["time"], b: SyncMessageLike["info"]["time"]) {
  return a?.created === b.created && a?.completed === b.completed
}

function sameAssistantMeta(prev: DisplayMessage, next: SyncMessageLike["info"]) {
  return (
    prev.error === next.error &&
    prev.modelID === next.modelID &&
    prev.providerID === next.providerID &&
    prev.agent === next.agent &&
    prev.tokens === next.tokens
  )
}

function cloneParts(parts: Part[]) {
  return parts.map((part) => ({ ...part }))
}

export function projectDisplayMessages(prev: DisplayMessage[], messages: SyncMessageLike[]) {
  const prevById = new Map(prev.map((message) => [message.id, message]))

  const next = messages.map((message) => {
    const info = message.info
    const existing = prevById.get(info.id)

    if (
      existing &&
      existing.role === info.role &&
      sameProjectedParts(existing.parts, message.parts) &&
      sameTime(existing.time, info.time) &&
      (info.role !== "assistant" || sameAssistantMeta(existing, info))
    ) {
      return existing
    }

    if (info.role === "assistant") {
      return {
        id: info.id,
        role: info.role,
        parts: cloneParts(message.parts),
        error: info.error,
        time: { created: info.time.created, completed: info.time.completed },
        modelID: info.modelID,
        providerID: info.providerID,
        agent: info.agent,
        tokens: info.tokens,
      } satisfies DisplayMessage
    }

    return {
      id: info.id,
      role: info.role,
      parts: cloneParts(message.parts),
      time: { created: info.time.created },
    } satisfies DisplayMessage
  })

  if (next.length === prev.length && next.every((message, index) => message === prev[index])) return prev
  return next
}

function countUserMessages(messages: DisplayMessage[]) {
  return messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0)
}

function getUserMessageAt(messages: DisplayMessage[], index: number) {
  if (index < 1) return null

  let count = 0
  for (const message of messages) {
    if (message.role !== "user") continue
    count += 1
    if (count === index) return message
  }

  return null
}

function sameUserParts(a: DisplayMessage, b: DisplayMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  return sameProjectedParts(a.parts, b.parts)
}

export function findOptimisticMessageEcho(
  syncMessages: DisplayMessage[],
  optimistic: OptimisticQueueMessage,
) {
  const userCount = countUserMessages(syncMessages)
  if (userCount < optimistic.expectedUserMessageIndex) return null

  const echoed = getUserMessageAt(syncMessages, optimistic.expectedUserMessageIndex)
  if (!echoed) return null
  return sameUserParts(echoed, optimistic.message) ? echoed : null
}

function hasQueuedMessageEcho(syncMessages: DisplayMessage[], optimistic: OptimisticQueueMessage) {
  return !!findOptimisticMessageEcho(syncMessages, optimistic)
}

function detachedAssistantInsertIndex(messages: DisplayMessage[], optimisticCreatedAt: number | undefined) {
  if (optimisticCreatedAt == null || !Number.isFinite(optimisticCreatedAt)) return messages.length
  let index = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") break
    const created = message.time?.created
    if (created == null || !Number.isFinite(created) || created < optimisticCreatedAt) break
    index = i
  }
  return index
}

export function mergeOptimisticMessage(
  prev: DisplayMessage[],
  syncMessages: DisplayMessage[],
  optimisticMessages: OptimisticQueueMessage[],
) {
  const unresolved = optimisticMessages
    .filter((message) => !hasQueuedMessageEcho(syncMessages, message))

  if (unresolved.length === 0) return syncMessages

  const merged = [...syncMessages]
  const detachedIndex = detachedAssistantInsertIndex(syncMessages, unresolved[0].message.time?.created)
  for (const [index, optimistic] of unresolved.entries()) {
    const insertAt = index === 0 ? detachedIndex : merged.length
    merged.splice(insertAt, 0, optimistic.message)
  }

  if (merged.length === prev.length && merged.every((message, index) => prev[index] === message)) return prev
  return merged
}

function computeTurnTime(user: DisplayMessage, assistants: DisplayMessage[]): Turn["time"] {
  const started = user.time?.created
  if (started == null || !Number.isFinite(started)) return undefined

  const completed = assistants.reduce<number | undefined>((latest, message) => {
    const current = message.time?.completed
    if (current == null || !Number.isFinite(current)) return latest
    if (latest == null) return current
    return current > latest ? current : latest
  }, undefined)

  const duration = completed != null && Number.isFinite(completed) ? completed - started : undefined
  return { started, completed, duration }
}

function sameAssistantMessages(prev: DisplayMessage[], next: DisplayMessage[]) {
  return prev.length === next.length && prev.every((message, index) => message === next[index])
}

export function reconcileTurns(prev: Turn[], messages: DisplayMessage[]) {
  const prevById = new Map(prev.map((turn) => [turn.id, turn]))
  const next: Turn[] = []

  let currentUser: DisplayMessage | null = null
  let assistants: DisplayMessage[] = []

  const pushTurn = () => {
    if (!currentUser) return
    const existing = prevById.get(currentUser.id)

    if (
      existing &&
      existing.userMessage === currentUser &&
      sameAssistantMessages(existing.assistantMessages, assistants)
    ) {
      next.push(existing)
      return
    }

    next.push({
      id: currentUser.id,
      userMessage: currentUser,
      assistantMessages: assistants,
      time: computeTurnTime(currentUser, assistants),
    })
  }

  for (const message of messages) {
    if (message.role === "user") {
      pushTurn()
      currentUser = message
      assistants = []
      continue
    }

    if (!currentUser) continue
    assistants = [...assistants, message]
  }

  pushTurn()

  if (next.length === prev.length && next.every((turn, index) => turn === prev[index])) return prev
  return next
}
