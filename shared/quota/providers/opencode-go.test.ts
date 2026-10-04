import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { parseOpenCodeGoUsage, OpenCodeGoProvider } from "./opencode-go"
import { __resetSettingsStoreForTests } from "../../settings-store"

const TMP_DB = `/tmp/opencode-go-test-${Date.now()}.db`

function usageBody(offsetsMs: { rolling?: number; weekly?: number; monthly?: number }) {
  const window = (offsetMs?: number) => {
    if (offsetMs === undefined) return undefined
    return { status: "ok", percent: 42.5, resetsAt: new Date(Date.now() + offsetMs).toISOString() }
  }
  return {
    usage: {
      rolling: window(offsetsMs.rolling),
      weekly: window(offsetsMs.weekly),
      monthly: window(offsetsMs.monthly),
    },
  }
}

beforeEach(() => {
  __resetSettingsStoreForTests(TMP_DB)
})

afterEach(() => {
  __resetSettingsStoreForTests(TMP_DB)
})

describe("parseOpenCodeGoUsage — zen usage API", () => {
  it("parses rolling/weekly/monthly windows from the usage payload", () => {
    const result = parseOpenCodeGoUsage(usageBody({ rolling: 3_600_000, weekly: 86_400_000, monthly: 2_592_000_000 }))

    expect(result).not.toBeNull()
    expect(result).toHaveProperty("success", true)
    if (result && result.success) {
      expect(result.rolling?.usagePercent).toBe(42.5)
      expect(result.rolling?.percentRemaining).toBe(57.5)
      expect(result.rolling?.resetInSec).toBeGreaterThan(3_590)
      expect(result.rolling?.resetInSec).toBeLessThanOrEqual(3_600)
      expect(result.rolling?.resetTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      expect(result.weekly?.usagePercent).toBe(42.5)
      expect(result.monthly?.usagePercent).toBe(42.5)
    }
  })

  it("returns success with partial windows", () => {
    const body = usageBody({ rolling: 100_000 })
    const result = parseOpenCodeGoUsage(body)

    expect(result).not.toBeNull()
    if (result && result.success) {
      expect(result.rolling).toBeDefined()
      expect(result.weekly).toBeUndefined()
      expect(result.monthly).toBeUndefined()
    }
  })

  it("clamps negative reset windows to zero", () => {
    const body = { usage: { rolling: { status: "ok", percent: 100, resetsAt: new Date(Date.now() - 60_000).toISOString() } } }

    const result = parseOpenCodeGoUsage(body)

    if (result && result.success) {
      expect(result.rolling?.resetInSec).toBe(0)
      expect(result.rolling?.percentRemaining).toBe(0)
    }
  })

  it("tolerates a missing resetsAt", () => {
    const body = { usage: { rolling: { percent: 5 } } }

    const result = parseOpenCodeGoUsage(body)

    if (result && result.success) {
      expect(result.rolling?.usagePercent).toBe(5)
      expect(result.rolling?.resetInSec).toBe(0)
    }
  })
})

describe("parseOpenCodeGoUsage — edge cases", () => {
  it("rejects non-object bodies", () => {
    const result = parseOpenCodeGoUsage("nope")

    expect(result).not.toBeNull()
    if (result && !result.success) {
      expect(result.error).toContain("JSON object")
    }
  })

  it("rejects a body without a usage object", () => {
    const result = parseOpenCodeGoUsage({ type: "error" })

    expect(result).not.toBeNull()
    if (result && !result.success) {
      expect(result.error).toContain("usage object")
    }
  })

  it("rejects a usage object without any recognizable window", () => {
    const result = parseOpenCodeGoUsage({ usage: { rolling: { percent: "fast" } } })

    expect(result).not.toBeNull()
    if (result && !result.success) {
      expect(result.error).toContain("usage windows")
    }
  })
})

describe("OpenCodeGoProvider", () => {
  it("reports unavailable when no config in settings store", async () => {
    const provider = new OpenCodeGoProvider()

    expect(await provider.isAvailable()).toBe(false)

    const view = await provider.fetch({})

    expect(view.status).toBe("unavailable")
    expect(view.available).toBe(false)
    expect(view.warning).toContain("not configured")
  })

  it("asks for an API key when only legacy credentials are present", async () => {
    __resetSettingsStoreForTests(TMP_DB).save("opencode-go", "workspaceId", "wk_test")
    __resetSettingsStoreForTests(TMP_DB).save("opencode-go", "authCookie", "cookie123")

    const provider = new OpenCodeGoProvider()
    const view = await provider.fetch({})

    expect(await provider.isAvailable()).toBe(false)
    expect(view.status).toBe("unavailable")
    expect(view.warning).toContain("API key")
  })

  it("reports available when an API key is saved in settings store", async () => {
    __resetSettingsStoreForTests(TMP_DB).save("opencode-go", "apiKey", "oc_test_key")

    const provider = new OpenCodeGoProvider()

    expect(await provider.isAvailable()).toBe(true)
  })
})
