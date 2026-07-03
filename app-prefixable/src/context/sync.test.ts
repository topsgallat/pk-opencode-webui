import { describe, expect, test } from "bun:test"
import { shouldBumpMessageVersionForEvent } from "./sync"

describe("shouldBumpMessageVersionForEvent", () => {
  test("does not invalidate message readers for raw part deltas", () => {
    expect(shouldBumpMessageVersionForEvent("message.part.delta")).toBe(false)
  })

  test("keeps non-delta message events reactive", () => {
    expect(shouldBumpMessageVersionForEvent("message.created")).toBe(true)
    expect(shouldBumpMessageVersionForEvent("message.updated")).toBe(true)
    expect(shouldBumpMessageVersionForEvent("message.part.updated")).toBe(true)
    expect(shouldBumpMessageVersionForEvent("message.part.removed")).toBe(true)
  })

  test("ignores non-message events", () => {
    expect(shouldBumpMessageVersionForEvent("session.updated")).toBe(false)
    expect(shouldBumpMessageVersionForEvent("provider.updated")).toBe(false)
  })
})
