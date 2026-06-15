import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { AnthropicProvider } from "./anthropic"
import { __clearAnthropicQuotaCacheForTests } from "../../anthropic-quota"

const env = {
  HOME: process.env.HOME,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
}

function clearEnv() {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = ""
}

clearEnv()

beforeEach(() => {
  clearEnv()
  __clearAnthropicQuotaCacheForTests()
})

function mockCliStatus(payload: unknown) {
  return async (args: string[]) => {
    if (args.join(" ") !== "auth status --json") return null
    return { code: 0, stdout: JSON.stringify(payload), stderr: "" }
  }
}

describe("AnthropicProvider", () => {
  it("parses quota windows from CLI status json", async () => {
    clearEnv()
    const provider = new AnthropicProvider({
      run: mockCliStatus({
        quota: {
          five_hour: { used_percentage: 12, resets_at: "2026-05-15T10:00:00.000Z" },
          seven_day: { used_percentage: 34, resets_at: "2026-05-20T10:00:00.000Z" },
        },
      }),
    })

    const result = await provider.fetch({})

    expect(result.status).toBe("ok")
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]?.label).toContain("Claude")
    expect(result.entries[0]?.resetTimeIso).toBe("2026-05-15T10:00:00.000Z")
  })

  it("falls back to oauth usage and warns for remote targets", async () => {
    clearEnv()
    const anthropicFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (!url.includes("api.anthropic.com/api/oauth/usage")) return new Response("not found", { status: 404 })
      expect(init?.headers && new Headers(init.headers).get("anthropic-beta")).toBe("oauth-2025-04-20")
      return new Response(JSON.stringify({
        quota: {
          five_hour: { used_percent: 20, reset_at: 1768471200 },
          seven_day: { used_percent: 40, reset_at: 1768972800 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    const provider = new AnthropicProvider({
      run: mockCliStatus({ authenticated: true, oauth: { accessToken: "tok_123" } }),
      fetch: anthropicFetch,
    })

    const result = await provider.fetch({ targetUrl: "https://example.com" })

    expect(result.status).toBe("ok")
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]?.resetTimeIso).toBe("2026-01-15T10:00:00.000Z")
    expect(result.warning).toContain("remote target")
  })

  it("exposes account identity from claude auth status", async () => {
    clearEnv()
    const provider = new AnthropicProvider({
      run: mockCliStatus({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email: "consult@secstrike.ai",
        orgId: "871cd9b8-8707-4a9a-87fa-1154327c38a7",
        orgName: "Secstrike Team",
        subscriptionType: "team",
        quota: {
          five_hour: { used_percentage: 12, resets_at: "2026-05-15T10:00:00.000Z" },
        },
      }),
    })

    const result = await provider.fetch({})

    expect(result.status).toBe("ok")
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts?.[0].label).toBe("Secstrike Team")
    expect(result.accounts?.[0].email).toBe("consult@secstrike.ai")
  })

  it("warns when Claude CLI is missing", async () => {
    clearEnv()
    const home = `/tmp/anthropic-home-${crypto.randomUUID()}`
    process.env.HOME = home
    const provider = new AnthropicProvider({
      run: async () => null,
    })

    const result = await provider.fetch({})

    expect(result.status).toBe("unavailable")
    expect(result.available).toBe(false)
    expect(result.entries).toHaveLength(0)
    expect(result.warning).toContain("Claude CLI not found")
  })

  it("retries after an unavailable probe", async () => {
    clearEnv()
    let calls = 0
    const provider = new AnthropicProvider({
      run: async () => {
        calls += 1
        if (calls === 1) return null
        return { code: 0, stdout: JSON.stringify({ quota: { five_hour: { used_percentage: 12, resets_at: "2026-05-15T10:00:00.000Z" } } }), stderr: "" }
      },
    })

    const first = await provider.fetch({})
    const second = await provider.fetch({})

    expect(first.status).toBe("unavailable")
    expect(second.status).toBe("ok")
    expect(second.entries).toHaveLength(1)
  })

  it("cools down after oauth 429 and avoids another Anthropic call", async () => {
    clearEnv()
    let calls = 0
    const provider = new AnthropicProvider({
      run: mockCliStatus({ authenticated: true, oauth: { accessToken: "tok_123" } }),
      fetch: async () => {
        calls += 1
        return new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "Rate limited. Please try again later." } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        })
      },
      now: () => 1_000,
    })

    const first = await provider.fetch({})
    const second = await provider.fetch({ refresh: true })

    expect(first.status).toBe("unavailable")
    expect(first.cooldownUntil).toBe("1970-01-01T00:01:01.000Z")
    expect(second.cooldownUntil).toBe(first.cooldownUntil)
    expect(calls).toBe(1)
  })
})

afterAll(() => {
  process.env.HOME = env.HOME
  process.env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN
})
