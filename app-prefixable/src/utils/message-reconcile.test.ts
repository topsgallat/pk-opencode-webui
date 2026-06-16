import { describe, expect, test } from "bun:test"
import type { Part } from "../sdk/client"
import { findOptimisticMessageEcho, mergeOptimisticMessage, projectDisplayMessages, reconcileTurns, type OptimisticQueueMessage, type SyncMessageLike } from "./message-reconcile"

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
  function optimistic(id: string, text: string, expectedUserMessageIndex: number): OptimisticQueueMessage {
    return {
      id,
      expectedUserMessageIndex,
      message: {
        id,
        role: "user",
        parts: [textPart(`${id}-part`, text)],
        time: { created: expectedUserMessageIndex },
      },
    }
  }

  test("keeps multiple optimistic queue items stable until backend echoes arrive", () => {
    const sync = projectDisplayMessages([], [userMessage("u1", "hello")])
    const optimisticItems = [
      optimistic("temp-1", "pending one", 2),
      optimistic("temp-2", "pending two", 3),
    ]

    const first = mergeOptimisticMessage(sync, sync, optimisticItems)
    const second = mergeOptimisticMessage(first, sync, optimisticItems)

    expect(first.slice(-2).map((message) => message.id)).toEqual(["temp-1", "temp-2"])
    expect(second).toBe(first)
  })

  test("drops only the echoed optimistic item when queued prompts share duplicate text", () => {
    const optimisticItems = [
      optimistic("temp-1", "duplicate", 1),
      optimistic("temp-2", "duplicate", 2),
    ]
    const firstSync = projectDisplayMessages([], [userMessage("u1", "duplicate")])
    const merged = mergeOptimisticMessage([], firstSync, optimisticItems)

    expect(merged).toHaveLength(2)
    expect(merged[0].id).toBe("u1")
    expect(merged[1].id).toBe("temp-2")
  })

  test("drops dequeued optimistic items that are no longer pending", () => {
    const sync = projectDisplayMessages([], [userMessage("u1", "hello")])
    const optimisticItems = [
      optimistic("temp-1", "pending one", 2),
      optimistic("temp-2", "pending two", 3),
    ]
    const first = mergeOptimisticMessage(sync, sync, optimisticItems)
    const second = mergeOptimisticMessage(first, sync, [optimisticItems[1]])

    expect(first.slice(-2).map((message) => message.id)).toEqual(["temp-1", "temp-2"])
    expect(second).toHaveLength(2)
    expect(second[1].id).toBe("temp-2")
  })

  test("finds the backend echo for the accepted optimistic item", () => {
    const optimisticItem = optimistic("temp-1", "pending one", 2)
    const sync = projectDisplayMessages([], [
      userMessage("u1", "hello"),
      userMessage("u2", "pending one"),
    ])

    const echoed = findOptimisticMessageEcho(sync, optimisticItem)

    expect(echoed?.id).toBe("u2")
  })

  test("does not match the wrong duplicate-text user turn", () => {
    const optimisticItem = optimistic("temp-2", "duplicate", 2)
    const sync = projectDisplayMessages([], [
      userMessage("u1", "duplicate"),
    ])

    const echoed = findOptimisticMessageEcho(sync, optimisticItem)

    expect(echoed).toBeNull()
  })
})

describe("reconcileTurns", () => {
  test("preserves all older turns when only the active streamed turn changes", () => {
    const messages = projectDisplayMessages([], [
      userMessage("u1", "first"),
      assistantMessage("a1", "done", 5),
      userMessage("u2", "second"),
      assistantMessage("a2", "done", 8),
      userMessage("u3", "third"),
      assistantMessage("a3", "stream"),
    ])

    const first = reconcileTurns([], messages)
    const second = reconcileTurns(first, [
      messages[0],
      messages[1],
      messages[2],
      messages[3],
      messages[4],
      { ...messages[5], parts: [textPart("a3-part", "stream more")] },
    ])

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).not.toBe(first[2])
  })

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
