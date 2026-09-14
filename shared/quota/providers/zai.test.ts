import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ZaiProvider } from "./zai"

const env = { HOME: process.env.HOME }
let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pkui-zai-"))
  process.env.HOME = home
})

afterEach(() => {
  process.env.HOME = env.HOME
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = ""
  }
})

function writeAuthFile(id: string, key: string) {
  const dir = join(home, ".local", "share", "opencode")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ [id]: { type: "api", key } }))
}

function quotaPayload(limits: unknown[], level = "lite") {
  return JSON.stringify({ code: 200, msg: "Operation successful", success: true, data: { limits, level } })
}

const LIVE_LIMITS = [
  { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 407, remaining: 1592, percentage: 20, nextResetTime: 1789382297080 },
  { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 407, remaining: 9592, percentage: 4, nextResetTime: 1789968751978 },
]

function mockFetch(body: string, status = 200, captured?: { headers: Headers }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (!url.includes("/api/monitor/usage/quota/limit")) return new Response("not found", { status: 404 })
    if (captured) captured.headers = new Headers(init?.headers)
    return new Response(body, { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

describe("ZaiProvider", () => {
  it("has correct id and name", () => {
    const provider = new ZaiProvider()
    expect(provider.id).toBe("zai-coding-plan")
    expect(provider.name).toBe("z.ai Coding Plan")
  })

  it("maps credit limit windows from the live response shape", async () => {
    const provider = new ZaiProvider(mockFetch(quotaPayload(LIVE_LIMITS)))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.status).toBe("ok")
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]?.label).toBe("5-hour window")
    expect(result.entries[0]?.window).toBe("hourly")
    expect(result.entries[0]?.percentUsed).toBe(20)
    expect(result.entries[0]?.used).toBe(407)
    expect(result.entries[0]?.total).toBe(2000)
    expect(result.entries[0]?.resetTimeIso).toBe("2026-09-14T10:38:17.080Z")
    expect(result.entries[0]?.subtitle).toBe("lite plan")
    expect(result.entries[1]?.label).toBe("Weekly window")
    expect(result.entries[1]?.window).toBe("weekly")
  })

  it("resolves auth from the session first and calls api.z.ai", async () => {
    const captured = { headers: new Headers() }
    writeAuthFile("zai-coding-plan", "file-key")
    const provider = new ZaiProvider(mockFetch(quotaPayload(LIVE_LIMITS), 200, captured))

    const available = await provider.isAvailable({ resolveProviderAuthHeader: () => "Bearer session-key" })
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer session-key" })

    expect(available).toBe(true)
    expect(result.status).toBe("ok")
    expect(captured.headers.get("Authorization")).toBe("Bearer session-key")
  })

  it("falls back to the OpenCode auth file when no session auth exists", async () => {
    const captured = { headers: new Headers() }
    writeAuthFile("zai-coding-plan", "083bfekey")
    const provider = new ZaiProvider(mockFetch(quotaPayload(LIVE_LIMITS), 200, captured))

    const result = await provider.fetch({})

    expect(result.status).toBe("ok")
    expect(captured.headers.get("Authorization")).toBe("Bearer 083bfekey")
  })

  it("falls back to zhipu-coding-plan auth and open.bigmodel.cn", async () => {
    let requestedUrl = ""
    const doFetch = (async (input: RequestInfo | URL) => {
      requestedUrl = typeof input === "string" ? input : input.toString()
      return new Response(quotaPayload(LIVE_LIMITS), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    writeAuthFile("zhipu-coding-plan", "zhipu-key")
    const provider = new ZaiProvider(doFetch)

    const result = await provider.fetch({})

    expect(result.status).toBe("ok")
    expect(requestedUrl).toContain("https://open.bigmodel.cn/api/monitor/usage/quota/limit")
  })

  it("reports unavailable without any auth", async () => {
    const provider = new ZaiProvider(mockFetch(quotaPayload(LIVE_LIMITS)))
    const available = await provider.isAvailable({})
    const result = await provider.fetch({})

    expect(available).toBe(false)
    expect(result.status).toBe("unavailable")
    expect(result.warning).toContain("No z.ai auth")
  })

  it("surfaces API error envelopes even when HTTP is 200", async () => {
    const provider = new ZaiProvider(mockFetch(JSON.stringify({ code: 401, msg: "token expired or incorrect", success: false })))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.status).toBe("error")
    expect(result.error).toContain("token expired or incorrect")
  })

  it("errors when the response has no usable limits", async () => {
    const provider = new ZaiProvider(mockFetch(quotaPayload([])))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.status).toBe("error")
    expect(result.error).toContain("did not include quota limits")
  })

  it("maps legacy TOKENS_LIMIT and TIME_LIMIT types", async () => {
    const limits = [
      { type: "TOKENS_LIMIT", percentage: 30 },
      { type: "TIME_LIMIT", percentage: 10, currentValue: 2, usage: 100 },
    ]
    const provider = new ZaiProvider(mockFetch(quotaPayload(limits)))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.status).toBe("ok")
    expect(result.entries.map((entry) => entry.window)).toEqual(["hourly", "monthly"])
    expect(result.entries[0]?.percentUsed).toBe(30)
  })

  it("labels unknown unit and number combinations", async () => {
    const limits = [{ type: "CREDIT_LIMIT", unit: 9, number: 2, usage: 100, currentValue: 10, percentage: 10 }]
    const provider = new ZaiProvider(mockFetch(quotaPayload(limits)))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.entries[0]?.label).toBe("Usage window (unit 9 x 2)")
    expect(result.entries[0]?.window).toBe("unknown")
  })

  it("treats HTTP errors as provider errors", async () => {
    const provider = new ZaiProvider(mockFetch("server exploded", 500))
    const result = await provider.fetch({ resolveProviderAuthHeader: () => "Bearer test" })

    expect(result.status).toBe("error")
    expect(result.error).toContain("HTTP 500")
  })
})
