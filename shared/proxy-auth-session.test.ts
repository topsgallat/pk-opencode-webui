import { beforeEach, describe, expect, test } from "bun:test"
import { handleExtendedEndpoint } from "./extended-api"
import {
  __resetProxyAuthSessionsForTests,
  canonicalizeTarget,
  resolveProxyAuthHeader,
} from "./proxy-auth-session"

describe("proxy auth session", () => {
  beforeEach(() => {
    __resetProxyAuthSessionsForTests()
  })

  test("canonicalizes target with path+search, strips hash, validates protocol", () => {
    expect(canonicalizeTarget("https://example.com/a/b/?x=1&z=2#hash")).toBe("https://example.com/a/b?x=1&z=2")
    expect(canonicalizeTarget("http://localhost:4096/session/")).toBe("http://localhost:4096/session")
    expect(canonicalizeTarget("ftp://example.com")).toBeUndefined()
  })

  test("issues HttpOnly cookie on initial sync and does not echo password", async () => {
    const req = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "http://127.0.0.1:4096/path", password: "secret-1" }),
    })

    const res = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)
    const setCookie = res!.headers.get("set-cookie") || ""
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")

    const payload = await res!.json() as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.target).toBe("http://127.0.0.1:4096/path")
    expect(JSON.stringify(payload)).not.toContain("secret-1")
  })

  test("auth-session rejects invalid target/password payloads", async () => {
    const badTargetReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "ftp://invalid.test", password: "pw" }),
    })
    const badTargetRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(badTargetReq.url), badTargetReq)
    expect(badTargetRes?.status).toBe(400)

    const missingPasswordReq = new Request("http://localhost/api/ext/auth-session", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://valid.test/base", password: "" }),
    })
    const missingPasswordRes = await handleExtendedEndpoint("/api/ext/auth-session", "PUT", new URL(missingPasswordReq.url), missingPasswordReq)
    expect(missingPasswordRes?.status).toBe(400)

    const badDeleteReq = new Request("http://localhost/api/ext/auth-session", { method: "DELETE" })
    const badDeleteRes = await handleExtendedEndpoint("/api/ext/auth-session", "DELETE", new URL(badDeleteReq.url), badDeleteReq)
    expect(badDeleteRes?.status).toBe(400)
  })

  test("resolves credentials for deeper child paths under stored base path", async () => {
    const syncReq = new Request("http://localhost/api/ext/auth-session", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "https://api.example.test/base",
        username: "alice",
        password: "pw-2",
      }),
    })
    const syncRes = await handleExtendedEndpoint("/api/ext/auth-session", "PUT", new URL(syncReq.url), syncReq)
    const cookie = syncRes?.headers.get("set-cookie") || ""
    const sid = cookie.split(";")[0]
    expect(sid.length).toBeGreaterThan(0)

    const lookupReq = new Request("http://localhost/session", {
      headers: { cookie: sid },
    })
    const auth = resolveProxyAuthHeader(lookupReq, "https://api.example.test/base/event?stream=1")
    expect(auth).toBe(`Basic ${Buffer.from("alice:pw-2").toString("base64")}`)
  })

  test("same origin different base paths do not collide", async () => {
    const syncA = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://host.test/a", username: "u1", password: "pw-a" }),
    })
    const resA = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(syncA.url), syncA)
    const sid = (resA?.headers.get("set-cookie") || "").split(";")[0]

    const syncB = new Request("http://localhost/api/ext/auth-session", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: sid },
      body: JSON.stringify({ target: "https://host.test/b", username: "u2", password: "pw-b" }),
    })
    await handleExtendedEndpoint("/api/ext/auth-session", "PUT", new URL(syncB.url), syncB)

    const reqWithCookie = new Request("http://localhost/any", { headers: { cookie: sid } })
    const authA = resolveProxyAuthHeader(reqWithCookie, "https://host.test/a/session")
    const authB = resolveProxyAuthHeader(reqWithCookie, "https://host.test/b/session")
    expect(authA).toBe(`Basic ${Buffer.from("u1:pw-a").toString("base64")}`)
    expect(authB).toBe(`Basic ${Buffer.from("u2:pw-b").toString("base64")}`)
  })

  test("defaults username to opencode and clear removes target credentials", async () => {
    const syncReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://svc.example.test/base", password: "pw-3" }),
    })
    const syncRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(syncReq.url), syncReq)
    const sid = (syncRes?.headers.get("set-cookie") || "").split(";")[0]
    const reqWithCookie = new Request("http://localhost/any", { headers: { cookie: sid } })

    const beforeClear = resolveProxyAuthHeader(reqWithCookie, "https://svc.example.test/base/pty/abc/connect")
    expect(beforeClear).toBe(`Basic ${Buffer.from("opencode:pw-3").toString("base64")}`)

    const clearReq = new Request("http://localhost/api/ext/auth-session?target=https%3A%2F%2Fsvc.example.test%2Fbase", {
      method: "DELETE",
      headers: { cookie: sid },
    })
    const clearRes = await handleExtendedEndpoint("/api/ext/auth-session", "DELETE", new URL(clearReq.url), clearReq)
    expect(clearRes?.status).toBe(200)

    const afterClear = resolveProxyAuthHeader(reqWithCookie, "https://svc.example.test/base")
    expect(afterClear).toBeUndefined()
  })

  test("existing session id is reused and follow-up sync does not set cookie again", async () => {
    const firstReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://cookie.example.test/base", username: "a", password: "pw-a" }),
    })
    const firstRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(firstReq.url), firstReq)
    const sid = (firstRes?.headers.get("set-cookie") || "").split(";")[0]
    expect(sid.length).toBeGreaterThan(0)

    const secondReq = new Request("http://localhost/api/ext/auth-session", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: sid },
      body: JSON.stringify({ target: "https://cookie.example.test/base/sub", username: "b", password: "pw-b" }),
    })
    const secondRes = await handleExtendedEndpoint("/api/ext/auth-session", "PUT", new URL(secondReq.url), secondReq)
    expect(secondRes?.headers.get("set-cookie")).toBeNull()

    const reqWithCookie = new Request("http://localhost/any", { headers: { cookie: sid } })
    expect(resolveProxyAuthHeader(reqWithCookie, "https://cookie.example.test/base")).toBe(`Basic ${Buffer.from("a:pw-a").toString("base64")}`)
    expect(resolveProxyAuthHeader(reqWithCookie, "https://cookie.example.test/base/sub/event")).toBe(`Basic ${Buffer.from("b:pw-b").toString("base64")}`)
  })

  test("resolves synced auth for default protected upstream across HTTP/SSE/WS/probe paths", async () => {
    const syncReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://protected.example.test/base", username: "op", password: "pw-4" }),
    })
    const syncRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(syncReq.url), syncReq)
    const sid = (syncRes?.headers.get("set-cookie") || "").split(";")[0]
    const reqWithCookie = new Request("http://localhost/any", { headers: { cookie: sid } })
    const auth = `Basic ${Buffer.from("op:pw-4").toString("base64")}`

    expect(resolveProxyAuthHeader(reqWithCookie, "https://protected.example.test/base/session")).toBe(auth)
    expect(resolveProxyAuthHeader(reqWithCookie, "https://protected.example.test/base/event")).toBe(auth)
    expect(resolveProxyAuthHeader(reqWithCookie, "https://protected.example.test/base/pty/abc/connect")).toBe(auth)
    expect(resolveProxyAuthHeader(reqWithCookie, "https://protected.example.test/base/health?probe=1")).toBe(auth)
  })

  test("target-selected protected upstream does not leak auth to unprotected/default upstream", async () => {
    const syncReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://targeted.example.test/api", username: "sel", password: "pw-5" }),
    })
    const syncRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(syncReq.url), syncReq)
    const sid = (syncRes?.headers.get("set-cookie") || "").split(";")[0]
    const reqWithCookie = new Request("http://localhost/any", { headers: { cookie: sid } })

    const selected = resolveProxyAuthHeader(reqWithCookie, "https://targeted.example.test/api/session")
    const other = resolveProxyAuthHeader(reqWithCookie, "https://unprotected.example.test/session")

    expect(selected).toBe(`Basic ${Buffer.from("sel:pw-5").toString("base64")}`)
    expect(other).toBeUndefined()
    expect(resolveProxyAuthHeader(new Request("http://localhost/any"), "https://targeted.example.test/api/session")).toBeUndefined()
  })

  test("probe-server uses full target path/search and classifies 401 as reachable auth-required", async () => {
    const syncReq = new Request("http://localhost/api/ext/auth-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "https://probe.example.test/base?x=1", username: "probe", password: "pw-6" }),
    })
    const syncRes = await handleExtendedEndpoint("/api/ext/auth-session", "POST", new URL(syncReq.url), syncReq)
    const sid = (syncRes?.headers.get("set-cookie") || "").split(";")[0]

    const calls: { url: string; auth: string | null }[] = []
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url: u, auth: headers.get("authorization") })
      return new Response("unauthorized", { status: 401 })
    }) as typeof fetch

    try {
      const req = new Request("http://localhost/api/ext/probe-server?url=https%3A%2F%2Fprobe.example.test%2Fbase%3Fx%3D1", {
        method: "GET",
        headers: { cookie: sid },
      })
      const res = await handleExtendedEndpoint("/api/ext/probe-server", "GET", new URL(req.url), req, {
        resolveUpstreamAuthHeader: (target) => resolveProxyAuthHeader(req, target),
      })

      expect(res).toBeDefined()
      const payload = await res!.json() as Record<string, unknown>
      expect(payload.ok).toBe(true)
      expect(payload.reachable).toBe(true)
      expect(payload.authRequired).toBe(true)
      expect(payload.status).toBe(401)
      expect(payload.url).toBe("https://probe.example.test/base/health?x=1")

      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe("https://probe.example.test/base/health?x=1")
      expect(calls[0]?.auth).toBe(`Basic ${Buffer.from("probe:pw-6").toString("base64")}`)
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  test("probe-server reports reachable non-auth failure and network failure deterministically", async () => {
    const prevFetch = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes("offline.example.test")) throw new Error("connect ECONNREFUSED")
      return new Response("forbidden", { status: 403 })
    }) as typeof fetch

    try {
      const forbiddenReq = new Request("http://localhost/api/ext/probe-server?url=https%3A%2F%2Fforbidden.example.test%2Fsvc")
      const forbiddenRes = await handleExtendedEndpoint("/api/ext/probe-server", "GET", new URL(forbiddenReq.url), forbiddenReq)
      const forbidden = await forbiddenRes!.json() as Record<string, unknown>
      expect(forbidden.ok).toBe(false)
      expect(forbidden.reachable).toBe(true)
      expect(forbidden.authRequired).toBe(false)
      expect(forbidden.status).toBe(403)
      expect(forbidden.url).toBe("https://forbidden.example.test/svc/health")

      const offlineReq = new Request("http://localhost/api/ext/probe-server?url=https%3A%2F%2Foffline.example.test%2Fsvc")
      const offlineRes = await handleExtendedEndpoint("/api/ext/probe-server", "GET", new URL(offlineReq.url), offlineReq)
      const offline = await offlineRes!.json() as Record<string, unknown>
      expect(offline.ok).toBe(false)
      expect(offline.reachable).toBe(false)
      expect(offline.authRequired).toBe(false)
      expect(String(offline.error)).toContain("ECONNREFUSED")
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})
