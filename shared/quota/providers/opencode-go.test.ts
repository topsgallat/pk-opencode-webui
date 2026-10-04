import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseOpenCodeGoUsage, OpenCodeGoProvider, resolveOpenCodeGoApiKey, loadOpenCodeGoConfig } from "./opencode-go"
import { __resetSettingsStoreForTests, getSettingsStore } from "../../settings-store"

const env = { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME }
let home = ""

function writeCliAuth(id: string, key: string) {
  const dir = join(home, ".local", "share", "opencode")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "auth.json")
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  writeFileSync(path, JSON.stringify({ ...existing, [id]: { type: "api", key } }))
}

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
  home = mkdtempSync(join(tmpdir(), "pkui-ocgo-"))
  process.env.HOME = home
  delete process.env.XDG_DATA_HOME
  __resetSettingsStoreForTests(join(home, "settings.db"))
})

afterEach(() => {
  process.env.HOME = env.HOME
  if (env.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = env.XDG_DATA_HOME
  __resetSettingsStoreForTests(join(tmpdir(), `pkui-ocgo-closed-${Date.now()}.db`))
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = ""
  }
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

describe("OpenCodeGoProvider — key resolution", () => {
  it("resolves the key from the CLI auth store under the opencode-go provider id", async () => {
    writeCliAuth("opencode-go", "go_key")

    const provider = new OpenCodeGoProvider()

    expect(await provider.isAvailable()).toBe(true)
    expect(await resolveOpenCodeGoApiKey(loadOpenCodeGoConfig(), {})).toBe("go_key")
  })

  it("prefers the opencode-go id over the zen ids", async () => {
    writeCliAuth("opencode-go", "go_key")
    writeCliAuth("opencode", "zen_key")

    expect(await resolveOpenCodeGoApiKey(loadOpenCodeGoConfig(), {})).toBe("go_key")
  })

  it("resolves the key under the opencode-zen provider id", async () => {
    writeCliAuth("opencode-zen", "zen_key")

    expect(await resolveOpenCodeGoApiKey({})).toBe("zen_key")
  })

  it("prefers the settings key over the CLI auth store", async () => {
    writeCliAuth("opencode", "cli_key")
    getSettingsStore().save("opencode-go", "apiKey", "manual_key")

    expect(await resolveOpenCodeGoApiKey(loadOpenCodeGoConfig(), {})).toBe("manual_key")
  })

  it("strips the Bearer prefix from a session auth header", async () => {
    writeCliAuth("opencode", "cli_key")

    const key = await resolveOpenCodeGoApiKey({}, { resolveProviderAuthHeader: () => "Bearer session_key" })

    expect(key).toBe("session_key")
  })

  it("falls through to the CLI auth store when no session auth matches", async () => {
    writeCliAuth("opencode", "cli_key")

    const key = await resolveOpenCodeGoApiKey({}, { resolveProviderAuthHeader: () => undefined })

    expect(key).toBe("cli_key")
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
    getSettingsStore().save("opencode-go", "workspaceId", "wk_test")
    getSettingsStore().save("opencode-go", "authCookie", "cookie123")

    const provider = new OpenCodeGoProvider()
    const view = await provider.fetch({})

    expect(await provider.isAvailable()).toBe(false)
    expect(view.status).toBe("unavailable")
    expect(view.warning).toContain("/connect")
  })

  it("reports available when an API key is saved in settings store", async () => {
    getSettingsStore().save("opencode-go", "apiKey", "oc_test_key")

    const provider = new OpenCodeGoProvider()

    expect(await provider.isAvailable()).toBe(true)
  })
})
