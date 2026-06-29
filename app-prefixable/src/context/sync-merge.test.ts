import { describe, expect, test } from "bun:test"
import type { Part } from "../sdk/client"
import { choosePreferredMessageForSyncMerge } from "./sync-merge"

type MessageLike = Parameters<typeof choosePreferredMessageForSyncMerge>[0]

function textPart(id: string, text: string): Part {
  return { id, type: "text", text } as Part
}

function assistantMessage(id: string, text: string): MessageLike {
  return {
    info: {
      id,
      role: "assistant",
      sessionID: "s1",
      time: { created: 1 },
    },
    parts: [textPart(`${id}-text`, text)],
  }
}

function reasoningPart(id: string, text: string): Part {
  return { id, type: "reasoning", text } as Part
}

function toolPart(id: string, tool: string, status: string, completed?: boolean): Part {
  return {
    id,
    type: "tool",
    tool,
    state: {
      status,
      ...(completed ? { time: { start: 1, end: 2 } } : {}),
    },
  } as Part
}

describe("choosePreferredMessageForSyncMerge", () => {
  test("keeps the existing assistant row when fetched and existing have equal part counts but existing text is longer", () => {
    const existing = assistantMessage("a1", "TOKEN_LONGER")
    const fetched = assistantMessage("a1", "TOKEN")

    expect(choosePreferredMessageForSyncMerge(fetched, existing)).toBe(existing)
  })

  test("keeps the fetched assistant row when it is completed", () => {
    const existing = assistantMessage("a1", "TOKEN_LONGER")
    const fetched = {
      ...assistantMessage("a1", "TOKEN"),
      info: { ...assistantMessage("a1", "TOKEN").info, time: { created: 1, completed: 2 } },
    }

    expect(choosePreferredMessageForSyncMerge(fetched, existing)).toBe(fetched)
  })

  test("keeps the newer completed assistant row when stale fetched reasoning text differs but size is equal", () => {
    const existing = {
      ...assistantMessage("a1", "TOKEN"),
      info: { ...assistantMessage("a1", "TOKEN").info, time: { created: 1, completed: 10 } },
      parts: [reasoningPart("a1-reasoning", "abc"), textPart("a1-text", "TOKEN")],
    }
    const fetched = {
      ...assistantMessage("a1", "TOKEN"),
      info: { ...assistantMessage("a1", "TOKEN").info, time: { created: 1, completed: 5 } },
      parts: [reasoningPart("a1-reasoning", "xyz"), textPart("a1-text", "TOKEN")],
    }

    expect(choosePreferredMessageForSyncMerge(fetched, existing)).toBe(existing)
  })

  test("prefers the later completed tool snapshot when both snapshots have tool updates", () => {
    const existing = {
      ...assistantMessage("a1", "TOKEN"),
      info: { ...assistantMessage("a1", "TOKEN").info, time: { created: 1, completed: 10 } },
      parts: [toolPart("a1-tool", "search", "running")],
    }
    const fetched = {
      ...assistantMessage("a1", "TOKEN"),
      info: { ...assistantMessage("a1", "TOKEN").info, time: { created: 1, completed: 12 } },
      parts: [toolPart("a1-tool", "search", "completed", true)],
    }

    expect(choosePreferredMessageForSyncMerge(fetched, existing)).toBe(fetched)
  })
})
