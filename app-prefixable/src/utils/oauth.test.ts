import { describe, expect, test } from "bun:test"
import { extractOAuthCode, normalizeOAuthCallbackUrl } from "./oauth"

describe("oauth", () => {
  test("extracts code from callback url query", () => {
    expect(
      extractOAuthCode("http://localhost:1455/auth/callback?code=abc123&state=xyz"),
    ).toBe("abc123")
  })

  test("extracts code from callback url hash", () => {
    expect(
      extractOAuthCode("http://localhost:1455/auth/callback#code=abc123&state=xyz"),
    ).toBe("abc123")
  })

  test("normalizes callback url and preserves state", () => {
    expect(
      normalizeOAuthCallbackUrl("http://localhost:1455/auth/callback#code=abc123&state=xyz"),
    ).toBe("http://localhost:1455/auth/callback?code=abc123&state=xyz")
  })

  test("rejects callback urls without state", () => {
    expect(normalizeOAuthCallbackUrl("http://localhost:1455/auth/callback?code=abc123")).toBeNull()
  })

  test("keeps raw code input", () => {
    expect(extractOAuthCode("abc123")).toBe("abc123")
  })

  test("returns null for empty input", () => {
    expect(extractOAuthCode("   ")).toBeNull()
  })
})
