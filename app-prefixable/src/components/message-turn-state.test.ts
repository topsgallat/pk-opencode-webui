import { describe, expect, test } from "bun:test"
import {
  getRealTurnDefaultExpanded,
  shouldReopenExpandedState,
  shouldRestoreExpandedState,
} from "./message-turn-state"

describe("getRealTurnDefaultExpanded", () => {
  test("forces the active real turn open while processing even if it was manually collapsed earlier", () => {
    expect(getRealTurnDefaultExpanded({
      savedExpanded: false,
      processing: true,
      isActiveRealTurn: true,
      isLastRealTurn: true,
    })).toBe(true)
  })

  test("preserves manual collapse for non-streaming turns", () => {
    expect(getRealTurnDefaultExpanded({
      savedExpanded: false,
      processing: false,
      isActiveRealTurn: false,
      isLastRealTurn: true,
    })).toBe(false)
  })

  test("defaults the last completed real turn open when no saved state exists", () => {
    expect(getRealTurnDefaultExpanded({
      savedExpanded: undefined,
      processing: false,
      isActiveRealTurn: false,
      isLastRealTurn: true,
    })).toBe(true)
  })
})

describe("shouldReopenExpandedState", () => {
  test("reopens when the same turn transitions into the active streaming open state", () => {
    expect(shouldReopenExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: false,
      prevDefaultExpanded: false,
      turnId: "turn-1",
      streaming: true,
      defaultExpanded: true,
    })).toBe(true)
  })

  test("does not keep overriding manual collapse after the streaming-open state is already established", () => {
    expect(shouldReopenExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: true,
      prevDefaultExpanded: true,
      turnId: "turn-1",
      streaming: true,
      defaultExpanded: true,
    })).toBe(false)
  })

  test("does not reopen non-streaming turns", () => {
    expect(shouldReopenExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: false,
      prevDefaultExpanded: false,
      turnId: "turn-1",
      streaming: false,
      defaultExpanded: true,
    })).toBe(false)
  })
})

describe("shouldRestoreExpandedState", () => {
  test("restores saved collapsed state when the same turn stops streaming", () => {
    expect(shouldRestoreExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: true,
      turnId: "turn-1",
      streaming: false,
      savedExpanded: false,
    })).toBe(true)
  })

  test("does not restore when there is no saved parent state", () => {
    expect(shouldRestoreExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: true,
      turnId: "turn-1",
      streaming: false,
      savedExpanded: undefined,
    })).toBe(false)
  })

  test("does not restore while the turn is still streaming", () => {
    expect(shouldRestoreExpandedState({
      prevTurnId: "turn-1",
      prevStreaming: true,
      turnId: "turn-1",
      streaming: true,
      savedExpanded: false,
    })).toBe(false)
  })
})
