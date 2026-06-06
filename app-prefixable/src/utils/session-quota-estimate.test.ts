import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { clearSessionQuotaEstimate, getSessionQuotaEstimate } from "./session-quota-estimate"

const key = "opencode.sessionQuotaBaselines"

describe("getSessionQuotaEstimate", () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    const values = new Map<string, string>()
    globalThis.window = {
      sessionStorage: {
        getItem(key: string) {
          return values.has(key) ? values.get(key)! : null
        },
        setItem(key: string, value: string) {
          values.set(key, value)
        },
        removeItem(key: string) {
          values.delete(key)
        },
        clear() {
          values.clear()
        },
        key(index: number) {
          return Array.from(values.keys())[index] ?? null
        },
        get length() {
          return values.size
        },
      },
    } as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  it("anchors the first snapshot and then reports the delta", () => {
    expect(getSessionQuotaEstimate("s1", "openai", null, {
      id: "primary",
      percentUsed: 12.1,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBeNull()

    expect(getSessionQuotaEstimate("s1", "openai", null, {
      id: "primary",
      percentUsed: 15.4,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBe(3.3)
  })

  it("re-anchors when the reset window changes", () => {
    getSessionQuotaEstimate("s1", "anthropic", null, {
      id: "five_hour",
      percentUsed: 44,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })

    expect(getSessionQuotaEstimate("s1", "anthropic", null, {
      id: "five_hour",
      percentUsed: 3,
      resetTimeIso: "2026-01-01T05:00:00.000Z",
    })).toBeNull()

    expect(getSessionQuotaEstimate("s1", "anthropic", null, {
      id: "five_hour",
      percentUsed: 8,
      resetTimeIso: "2026-01-01T05:00:00.000Z",
    })).toBe(5)
  })

  it("re-anchors when usage drops below the stored baseline", () => {
    getSessionQuotaEstimate("s1", "copilot", null, {
      id: "monthly",
      percentUsed: 50,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })

    expect(getSessionQuotaEstimate("s1", "copilot", null, {
      id: "monthly",
      percentUsed: 20,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBeNull()

    expect(getSessionQuotaEstimate("s1", "copilot", null, {
      id: "monthly",
      percentUsed: 24,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBe(4)
  })

  it("clears malformed baseline storage and re-anchors defensively", () => {
    window.sessionStorage.setItem(key, "not-json")

    expect(getSessionQuotaEstimate("s1", "gemini", null, {
      id: "daily",
      percentUsed: 9,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBeNull()

    expect(JSON.parse(window.sessionStorage.getItem(key) || "{}")).toEqual({
      s1: {
        providerID: "gemini",
        accountID: null,
        entryID: "daily",
        resetTimeIso: "2026-01-01T00:00:00.000Z",
        percentUsed: 9,
      },
    })
  })

  it("can clear a stored session baseline", () => {
    getSessionQuotaEstimate("s1", "openai", null, {
      id: "primary",
      percentUsed: 12,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })

    clearSessionQuotaEstimate("s1")

    expect(window.sessionStorage.getItem(key)).toBe("{}")
  })

  it("re-anchors when the active account changes", () => {
    expect(getSessionQuotaEstimate("s1", "anthropic", "account-a", {
      id: "five_hour",
      percentUsed: 12,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBeNull()

    expect(getSessionQuotaEstimate("s1", "anthropic", "account-b", {
      id: "five_hour",
      percentUsed: 14,
      resetTimeIso: "2026-01-01T00:00:00.000Z",
    })).toBeNull()
  })
})
