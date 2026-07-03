import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { parseOpenCodeGoUsage, OpenCodeGoProvider } from "./opencode-go"
import { __resetSettingsStoreForTests } from "../../settings-store"

const TMP_DB = `/tmp/opencode-go-test-${Date.now()}.db`

beforeEach(() => {
  __resetSettingsStoreForTests(TMP_DB)
})

afterEach(() => {
  __resetSettingsStoreForTests(TMP_DB)
})

describe("parseOpenCodeGoUsage — SSR hydration", () => {
  it("parses rolling/weekly/monthly windows from hydration script", () => {
    const html = `
      <script>
      rollingUsage:$R[0]={usagePercent:42.5,resetInSec:3600}
      weeklyUsage:$R[1]={usagePercent:60,resetInSec:302400}
      monthlyUsage:$R[2]={usagePercent:10,resetInSec:2592000}
      </script>
    `

    const result = parseOpenCodeGoUsage(html)

    expect(result).not.toBeNull()
    expect(result).toHaveProperty("success", true)
    if (result && result.success) {
      expect(result.rolling?.usagePercent).toBe(42.5)
      expect(result.rolling?.resetInSec).toBe(3600)
      expect(result.rolling?.percentRemaining).toBe(57.5)
      expect(result.rolling?.resetTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      expect(result.weekly?.usagePercent).toBe(60)
      expect(result.monthly?.usagePercent).toBe(10)
    }
  })

  it("parses resetInSec before usagePercent order", () => {
    const html = `<script>rollingUsage:$R[3]={resetInSec:7200,usagePercent:15}</script>`

    const result = parseOpenCodeGoUsage(html)

    expect(result).not.toBeNull()
    if (result && result.success) {
      expect(result.rolling?.usagePercent).toBe(15)
      expect(result.rolling?.resetInSec).toBe(7200)
    }
  })

  it("returns success with partial windows", () => {
    const html = `<script>rollingUsage:$R[0]={usagePercent:5,resetInSec:100}</script>`

    const result = parseOpenCodeGoUsage(html)

    if (result && result.success) {
      expect(result.rolling).toBeDefined()
      expect(result.weekly).toBeUndefined()
      expect(result.monthly).toBeUndefined()
    }
  })
})

describe("parseOpenCodeGoUsage — HTML fallback", () => {
  it("parses data-slot usage-item blocks", () => {
    const html = `
      <div data-slot="usage-item">
        <div data-slot="usage-label">Rolling 5h</div>
        <div data-slot="usage-value">42%</div>
        <div data-slot="reset-time">1 hour 56 minutes</div>
      </div>
      <div data-slot="usage-item">
        <div data-slot="usage-label">Weekly</div>
        <div data-slot="usage-value">10%</div>
        <div data-slot="reset-time">3 days</div>
      </div>
    `

    const result = parseOpenCodeGoUsage(html)

    if (result && result.success) {
      expect(result.rolling?.usagePercent).toBe(42)
      expect(result.rolling?.resetInSec).toBe(6960)
      expect(result.weekly?.usagePercent).toBe(10)
      expect(result.weekly?.resetInSec).toBe(259200)
    }
  })

  it("handles reset now as zero seconds", () => {
    const html = `
      <div data-slot="usage-item">
        <div data-slot="usage-label">Rolling 5h</div>
        <div data-slot="usage-value">100%</div>
        <div data-slot="reset-time">reset now</div>
      </div>
    `

    const result = parseOpenCodeGoUsage(html)

    if (result && result.success) {
      expect(result.rolling?.resetInSec).toBe(0)
    }
  })
})

describe("parseOpenCodeGoUsage — edge cases", () => {
  it("returns null for empty input", () => {
    expect(parseOpenCodeGoUsage("")).toBeNull()
  })

  it("returns failure for unparseable html", () => {
    const result = parseOpenCodeGoUsage("<html><body>nothing here</body></html>")

    expect(result).not.toBeNull()
    if (result && !result.success) {
      expect(result.error).toContain("Could not find usage data")
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

  it("reports available when config is saved in settings store", async () => {
    __resetSettingsStoreForTests(TMP_DB).save("opencode-go", "workspaceId", "wk_test")
    __resetSettingsStoreForTests(TMP_DB).save("opencode-go", "authCookie", "cookie123")

    const provider = new OpenCodeGoProvider()

    expect(await provider.isAvailable()).toBe(true)
  })
})