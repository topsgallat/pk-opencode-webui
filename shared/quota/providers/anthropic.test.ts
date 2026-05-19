import { afterAll, describe, expect, it } from "bun:test"
import { AnthropicProvider } from "./anthropic"

const env = {
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
}

function clearEnv() {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = ""
}

clearEnv()

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
})

afterAll(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN
})
