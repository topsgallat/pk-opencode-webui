import { describe, expect, test } from "bun:test"
import { resolveActiveTurnId, shouldResetTimelineState } from "./message-timeline-state"

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

describe("resolveActiveTurnId", () => {
  test("picks the freshly-echoed turn even though it has no assistant message yet", () => {
    // Regression: this used to fall through to the *previous* turn (turn-1)
    // here, which starved turn-2's badge/placeholder of the "thinking" state
    // and left it stuck on the plain "pending" fallback.
    expect(resolveActiveTurnId({
      turns: [
        { id: "turn-1", hasIncompleteAssistant: false },
        { id: "turn-2", hasIncompleteAssistant: false },
      ],
      activeTurnId: "turn-2",
      processing: true,
    })).toBe("turn-2")
  })

  test("falls back to a turn with an incomplete assistant message when activeTurnId is stale", () => {
    expect(resolveActiveTurnId({
      turns: [
        { id: "turn-1", hasIncompleteAssistant: true },
        { id: "turn-2", hasIncompleteAssistant: false },
      ],
      activeTurnId: undefined,
      processing: true,
    })).toBe("turn-1")
  })

  test("returns undefined instead of guessing when nothing matches", () => {
    expect(resolveActiveTurnId({
      turns: [
        { id: "turn-1", hasIncompleteAssistant: false },
      ],
      activeTurnId: undefined,
      processing: true,
    })).toBeUndefined()
  })

  test("ignores activeTurnId once processing has stopped if it never resolved", () => {
    expect(resolveActiveTurnId({
      turns: [{ id: "turn-1", hasIncompleteAssistant: false }],
      activeTurnId: "temp-client-id",
      processing: false,
    })).toBeUndefined()
  })

  test("returns activeTurnId as-is when there are no turns yet", () => {
    expect(resolveActiveTurnId({
      turns: [],
      activeTurnId: "temp-client-id",
      processing: true,
    })).toBe("temp-client-id")
  })
})
