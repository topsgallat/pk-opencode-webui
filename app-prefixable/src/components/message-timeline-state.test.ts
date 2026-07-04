import { describe, expect, test } from "bun:test"
import { shouldResetTimelineState } from "./message-timeline-state"

describe("shouldResetTimelineState", () => {
  test("does not reset on initial render", () => {
    expect(shouldResetTimelineState({
      previous: { sessionKey: undefined, turnIds: [] },
      current: { sessionKey: "session-1", turnIds: ["turn-1"] },
    })).toBe(false)
  })

  test("does not reset for same-session prompt and sync churn", () => {
    expect(shouldResetTimelineState({
      previous: { sessionKey: "session-1", turnIds: ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5", "turn-6"] },
      current: { sessionKey: "session-1", turnIds: ["turn-7"] },
    })).toBe(false)
  })

  test("resets when the user switches sessions", () => {
    expect(shouldResetTimelineState({
      previous: { sessionKey: "session-1", turnIds: ["turn-1", "turn-2"] },
      current: { sessionKey: "session-2", turnIds: ["turn-1", "turn-2"] },
    })).toBe(true)
  })
})
