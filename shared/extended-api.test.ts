import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { handleExtendedEndpoint } from "./extended-api"
import { __resetProviderAuthSessionsForTests, resolveProviderAuthAccountId, resolveProviderAuthHeader } from "./provider-auth-session"

const env = {
  HOME: process.env.HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  OPENCODE_WORKSPACE_ROOT: process.env.OPENCODE_WORKSPACE_ROOT,
}

afterEach(() => {
  process.env.HOME = env.HOME
  process.env.XDG_DATA_HOME = env.XDG_DATA_HOME
  process.env.OPENCODE_WORKSPACE_ROOT = env.OPENCODE_WORKSPACE_ROOT
  __resetProviderAuthSessionsForTests()
})

test("validates provider connection without saving", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://example.com/v1/models")
    expect(init?.headers instanceof Headers ? init.headers.get("Authorization") : new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
    return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/provider-validate", {
      method: "POST",
      body: JSON.stringify({
        providerID: "openai-compatible",
        baseURL: "https://example.com/v1",
        apiKey: "test-key",
        models: [{ id: "gpt-4o", name: "GPT-4o" }],
      }),
    })

    const res = await handleExtendedEndpoint("/api/ext/provider-validate", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)

    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.reachable).toBe(true)
    expect(data.message).toBe("Connection succeeded")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("surfaces provider validation errors", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/provider-validate", {
      method: "POST",
      body: JSON.stringify({
        baseURL: "https://example.com/v1",
        apiKey: "bad-key",
      }),
    })

    const res = await handleExtendedEndpoint("/api/ext/provider-validate", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)

    const data = await res!.json()
    expect(data.ok).toBe(false)
    expect(data.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("deletes a global custom provider from config file", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-global-provider-"))
  process.env.HOME = root

  const dir = nodePath.join(root, ".config", "opencode")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    nodePath.join(dir, "opencode.json"),
    JSON.stringify({ provider: { foo: { name: "Foo", npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://example.com/v1" } }, bar: { name: "Bar" } } }, null, 2),
    "utf-8",
  )

  const req = new Request("http://localhost/api/ext/global-provider?providerID=foo", {
    method: "DELETE",
  })

  const res = await handleExtendedEndpoint("/api/ext/global-provider", "DELETE", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const saved = JSON.parse(await fs.readFile(nodePath.join(dir, "opencode.json"), "utf-8")) as { provider?: Record<string, unknown> }
  expect(saved.provider?.foo).toBeUndefined()
  expect(saved.provider?.bar).toBeDefined()
})

test("syncs oauth provider auth from backend auth file", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-auth-"))
  process.env.XDG_DATA_HOME = root

  const dir = nodePath.join(root, "opencode")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(nodePath.join(dir, "auth.json"), JSON.stringify({ openai: { type: "oauth", access: "oauth-access-token", accountId: "acct_openai" } }), "utf-8")

  const target = "http://127.0.0.1:4096"
  const req = new Request(`http://localhost/api/ext/provider-auth/from-backend?providerID=openai&target=${encodeURIComponent(target)}`, {
    method: "POST",
  })

  const res = await handleExtendedEndpoint("/api/ext/provider-auth/from-backend", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const cookie = res!.headers.get("Set-Cookie") || ""
  expect(cookie).toContain("opencode_proxy_session=")

  const match = cookie.match(/opencode_proxy_session=([^;]+)/)
  expect(match?.[1]).toBeTruthy()

  const lookup = new Request("http://localhost/", {
    headers: { cookie: `opencode_proxy_session=${match![1]}` },
  })

  expect(resolveProviderAuthHeader(lookup, target, "openai")).toBe("Bearer oauth-access-token")
  expect(resolveProviderAuthAccountId(lookup, target, "openai")).toBe("acct_openai")
})

test("syncs copilot auth from backend auth file using github alias", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-auth-"))
  process.env.XDG_DATA_HOME = root

  const dir = nodePath.join(root, "opencode")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(nodePath.join(dir, "auth.json"), JSON.stringify({ "github-copilot": { type: "oauth", access: "copilot-access-token" } }), "utf-8")

  const target = "http://127.0.0.1:4096"
  const req = new Request(`http://localhost/api/ext/provider-auth/from-backend?providerID=copilot&target=${encodeURIComponent(target)}`, {
    method: "POST",
  })

  const res = await handleExtendedEndpoint("/api/ext/provider-auth/from-backend", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const cookie = res!.headers.get("Set-Cookie") || ""
  const match = cookie.match(/opencode_proxy_session=([^;]+)/)
  expect(match?.[1]).toBeTruthy()

  const lookup = new Request("http://localhost/", {
    headers: { cookie: `opencode_proxy_session=${match![1]}` },
  })

  expect(resolveProviderAuthHeader(lookup, target, "copilot")).toBe("Bearer copilot-access-token")
  expect(resolveProviderAuthHeader(lookup, target, "github-copilot")).toBe("Bearer copilot-access-token")
})

test("uploads text files through the extended API", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-upload-"))
  process.env.OPENCODE_WORKSPACE_ROOT = root

  const form = new FormData()
  form.set("path", "notes/demo.txt")
  form.set("file", new File(["hello world"], "demo.txt", { type: "text/plain" }))

  const req = new Request("http://localhost/api/ext/file", {
    method: "POST",
    body: form,
  })

  const res = await handleExtendedEndpoint("/api/ext/file", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const saved = await fs.readFile(nodePath.join(root, "notes", "demo.txt"), "utf-8")
  expect(saved).toBe("hello world")
})

test("uploads nested binary files through the extended API", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-upload-"))
  process.env.OPENCODE_WORKSPACE_ROOT = root

  const bytes = new Uint8Array([0, 1, 2, 3, 255])
  const form = new FormData()
  form.set("path", "a/b/c.bin")
  form.set("file", new File([bytes], "c.bin", { type: "application/octet-stream" }))

  const req = new Request("http://localhost/api/ext/file", {
    method: "POST",
    body: form,
  })

  const res = await handleExtendedEndpoint("/api/ext/file", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const saved = await fs.readFile(nodePath.join(root, "a", "b", "c.bin"))
  expect(Array.from(saved)).toEqual(Array.from(bytes))
})
