import type { Part, AssistantMessage } from "../sdk/client"
import type { DisplayMessage, Turn } from "../types/message"

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

export function projectDisplayMessages(prev: DisplayMessage[], messages: SyncMessageLike[]) {
  const prevById = new Map(prev.map((message) => [message.id, message]))

  const next = messages.map((message) => {
    const info = message.info
    const existing = prevById.get(info.id)

    if (
      existing &&
      existing.role === info.role &&
      existing.parts === message.parts &&
      sameTime(existing.time, info.time) &&
      (info.role !== "assistant" || sameAssistantMeta(existing, info))
    ) {
      return existing
    }

    if (info.role === "assistant") {
      return {
        id: info.id,
        role: info.role,
        parts: message.parts,
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
      parts: message.parts,
      time: { created: info.time.created },
    } satisfies DisplayMessage
  })

  if (next.length === prev.length && next.every((message, index) => message === prev[index])) return prev
  return next
}

function hasPendingTextMatch(messages: DisplayMessage[], pendingText: string) {
  return messages.some((message) => {
    if (message.role !== "user") return false
    return message.parts
      .filter((part) => part.type === "text")
      .some((part) => part.text?.trim() === pendingText.trim())
  })
}

export function mergeOptimisticMessage(
  prev: DisplayMessage[],
  syncMessages: DisplayMessage[],
  optimisticMessage: DisplayMessage | null,
  pendingText: string | null,
) {
  if (!optimisticMessage || !pendingText) return syncMessages
  if (hasPendingTextMatch(syncMessages, pendingText)) return syncMessages

  if (
    prev.length === syncMessages.length + 1 &&
    prev[prev.length - 1] === optimisticMessage &&
    syncMessages.every((message, index) => prev[index] === message)
  ) {
    return prev
  }

  return [...syncMessages, optimisticMessage]
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
