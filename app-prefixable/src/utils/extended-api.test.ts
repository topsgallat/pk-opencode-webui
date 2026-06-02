import { expect, test } from "bun:test"
import { replayProviderOAuthCallback, syncProviderAuthFromBackend } from "./extended-api"

test("preserves replay endpoint error details", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "invalid callbackUrl" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch

  try {
    const result = await replayProviderOAuthCallback("http://127.0.0.1:4096", "openai", "http://localhost:1455/auth/callback?code=abc123&state=xyz")
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toBe("invalid callbackUrl")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("reads nested replay endpoint error objects", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch

  try {
    const result = await replayProviderOAuthCallback("http://127.0.0.1:4096", "openai", "http://localhost:1455/auth/callback?code=abc123&state=xyz")
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.error).toBe("Unauthorized")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("preserves backend auth sync error details", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: { message: "callback timed out" } }), {
    status: 504,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch

  try {
    const result = await syncProviderAuthFromBackend("http://127.0.0.1:4096", "openai")
    expect(result.ok).toBe(false)
    expect(result.status).toBe(504)
    expect(result.error).toBe("callback timed out")
  } finally {
    globalThis.fetch = originalFetch
  }
})
