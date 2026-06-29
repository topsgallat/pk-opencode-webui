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
})
