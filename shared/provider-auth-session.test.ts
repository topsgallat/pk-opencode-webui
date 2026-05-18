import { afterEach, describe, expect, it } from "bun:test"
import { __resetProviderAuthSessionsForTests, clearProviderAuthSession, resolveProviderAuthAccountId, resolveProviderAuthHeader, syncProviderAuthSession } from "./provider-auth-session"

function makeRequest(cookie?: string) {
  return new Request("http://localhost/api/ext/provider-auth", {
    headers: cookie ? { cookie } : undefined,
  })
}

afterEach(() => {
  __resetProviderAuthSessionsForTests()
})

describe("provider-auth-session", () => {
  it("stores provider auth per target and provider", async () => {
    const res = syncProviderAuthSession(makeRequest(), "https://example.com", { providerID: "openai", authHeader: "Bearer abc", accountId: "acct_1" })
    expect(res.status).toBe(200)

    const cookie = res.headers.get("Set-Cookie")
    expect(cookie).toBeTruthy()

    const req = makeRequest(cookie || undefined)
    expect(resolveProviderAuthHeader(req, "https://example.com", "openai")).toBe("Bearer abc")
    expect(resolveProviderAuthAccountId(req, "https://example.com", "openai")).toBe("acct_1")
    expect(resolveProviderAuthHeader(req, "https://example.com", "copilot")).toBeUndefined()
  })

  it("aliases github copilot and copilot auth", async () => {
    const res = syncProviderAuthSession(makeRequest(), "https://example.com", { providerID: "github-copilot", authHeader: "Bearer copilot-token" })
    expect(res.status).toBe(200)

    const cookie = res.headers.get("Set-Cookie")
    const req = makeRequest(cookie || undefined)

    expect(resolveProviderAuthHeader(req, "https://example.com", "copilot")).toBe("Bearer copilot-token")
    expect(resolveProviderAuthHeader(req, "https://example.com", "github-copilot")).toBe("Bearer copilot-token")
  })

  it("clears provider auth", async () => {
    const sync = syncProviderAuthSession(makeRequest(), "https://example.com", { providerID: "openai", authHeader: "Bearer abc" })
    const cookie = sync.headers.get("Set-Cookie")
    const req = makeRequest(cookie || undefined)

    const clear = clearProviderAuthSession(req, "https://example.com", "openai")
    expect(clear.status).toBe(200)
    expect(resolveProviderAuthHeader(req, "https://example.com", "openai")).toBeUndefined()
  })
})
