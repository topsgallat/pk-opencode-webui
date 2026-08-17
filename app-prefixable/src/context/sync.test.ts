import { describe, expect, test } from "bun:test"
import { compareMessagesByTime, shouldBumpMessageVersionForEvent } from "./sync"

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

describe("compareMessagesByTime", () => {
  const msg = (id: string, created: number) => ({
    info: { id, time: { created } },
    parts: [],
  })

  test("orders newer messages last even when their IDs sort earlier", () => {
    const older = msg("msg_ffffc0595001VHFI8EqbHSI2Np", 1_000)
    const newer = msg("msg_00dc6dbf0001NdT0MwwSSmOull", 2_000)
    const sorted = [older, newer].sort(compareMessagesByTime)
    expect(sorted.map((m) => m.info.id)).toEqual([older.info.id, newer.info.id])
  })

  test("falls back to ID comparison when timestamps are missing", () => {
    const a = { info: { id: "msg_a" }, parts: [] }
    const b = { info: { id: "msg_b" }, parts: [] }
    expect([b, a].sort(compareMessagesByTime).map((m) => m.info.id)).toEqual(["msg_a", "msg_b"])
  })

  test("falls back to stable ID ordering when timestamps tie", () => {
    const a = msg("msg_a", 100)
    const b = msg("msg_b", 100)
    expect([b, a].sort(compareMessagesByTime).map((m) => m.info.id)).toEqual(["msg_a", "msg_b"])
  })
})
