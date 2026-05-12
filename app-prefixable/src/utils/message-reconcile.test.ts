import { describe, expect, test } from "bun:test"
import type { Part } from "../sdk/client"
import type { DisplayMessage, Turn } from "../types/message"
import { mergeOptimisticMessage, projectDisplayMessages, reconcileTurns, type SyncMessageLike } from "./message-reconcile"

function textPart(id: string, text: string): Part {
  return { id, type: "text", text } as Part
}

function userMessage(id: string, text: string): SyncMessageLike {
  return {
    info: { id, role: "user", time: { created: 1 } },
    parts: [textPart(`${id}-part`, text)],
  }
}

function assistantMessage(id: string, text: string, completed?: number): SyncMessageLike {
  return {
    info: { id, role: "assistant", time: { created: 2, completed } },
    parts: [textPart(`${id}-part`, text)],
  }
}

describe("projectDisplayMessages", () => {
  test("reuses unchanged projected messages by id", () => {
    const raw = [userMessage("u1", "hello"), assistantMessage("a1", "world")]
    const first = projectDisplayMessages([], raw)
    const second = projectDisplayMessages(first, raw)

    expect(second).toBe(first)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  test("replaces only the changed assistant row on stream update", () => {
    const user = userMessage("u1", "hello")
    const assistant = assistantMessage("a1", "world")
    const first = projectDisplayMessages([], [user, assistant])

    const updatedAssistant = { ...assistant, parts: [textPart("a1-part", "world!")] }
    const second = projectDisplayMessages(first, [user, updatedAssistant])

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
  })
})

describe("mergeOptimisticMessage", () => {
  test("keeps optimistic tail stable until backend echo arrives", () => {
    const sync = projectDisplayMessages([], [userMessage("u1", "hello")])
    const optimistic: DisplayMessage = {
      id: "temp-1",
      role: "user",
      parts: [textPart("temp-1-part", "pending")],
      time: { created: 3 },
    }

    const first = mergeOptimisticMessage(sync, sync, optimistic, "pending")
    const second = mergeOptimisticMessage(first, sync, optimistic, "pending")

    expect(first[first.length - 1]).toBe(optimistic)
    expect(second).toBe(first)
  })

  test("drops optimistic tail when backend echo matches pending text", () => {
    const optimistic: DisplayMessage = {
      id: "temp-1",
      role: "user",
      parts: [textPart("temp-1-part", "pending")],
      time: { created: 3 },
    }
    const sync = projectDisplayMessages([], [userMessage("u1", "pending")])
    const merged = mergeOptimisticMessage([optimistic], sync, optimistic, "pending")

    expect(merged).toBe(sync)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe("u1")
  })
})

describe("reconcileTurns", () => {
  test("reuses unchanged historical turns while streaming updates last turn", () => {
    const messages = projectDisplayMessages([], [
      userMessage("u1", "first"),
      assistantMessage("a1", "done", 5),
      userMessage("u2", "second"),
      assistantMessage("a2", "stream"),
    ])

    const first = reconcileTurns([], messages)

    const updatedMessages = [
      messages[0],
      messages[1],
      messages[2],
      {
        ...messages[3],
        parts: [textPart("a2-part", "stream more")],
      },
    ]

    const second = reconcileTurns(first, updatedMessages)

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
  })

  test("reuses full turn array when nothing changed", () => {
    const messages = projectDisplayMessages([], [userMessage("u1", "first"), assistantMessage("a1", "done", 5)])
    const first = reconcileTurns([], messages)
    const second = reconcileTurns(first, messages)

    expect(second).toBe(first)
    expect(second[0]).toBe(first[0])
  })
})
