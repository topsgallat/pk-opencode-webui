import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { handleExtendedEndpoint, handleSkillEndpoint } from "./extended-api"
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

test("discovers local skills alongside upstream skills", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-skills-"))
  process.env.HOME = root

  const config = nodePath.join(root, ".config", "opencode", "skills", "local-skill")
  await fs.mkdir(config, { recursive: true })
  await fs.writeFile(
    nodePath.join(config, "SKILL.md"),
    `---\ndescription: Local skill description\n---\n# Local Skill\n`,
    "utf-8",
  )

  const req = new Request("http://localhost/skill?directory=/project")
  const res = await handleSkillEndpoint("/skill", "GET", new URL(req.url), {
    fetchUpstreamSkills: async () => new Response(JSON.stringify([
      { name: "builtin", description: "Built-in", location: "<built-in>", content: "" },
    ]), { headers: { "Content-Type": "application/json" } }),
  })

  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const skills = await res!.json() as Array<{ name: string; description: string; location: string; content: string }>
  expect(skills.map((skill) => skill.name)).toContain("builtin")
  const local = skills.find((skill) => skill.name === "local-skill")
  expect(local?.description).toBe("Local skill description")
  expect(local?.location).toBe(nodePath.join(config, "SKILL.md"))
})

test("includes disabled skills discovered from hidden manifests", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-disabled-skills-"))
  process.env.HOME = root

  const hidden = nodePath.join(root, ".config", "opencode", "skills", ".prokube-disabled-skills", "demo-abc")
  await fs.mkdir(hidden, { recursive: true })
  await fs.writeFile(nodePath.join(hidden, "SKILL.md"), "---\ndescription: Disabled skill\n---\n# Disabled\n", "utf-8")
  await fs.writeFile(nodePath.join(hidden, ".prokube-skill.json"), JSON.stringify({
    version: 1,
    originalPath: nodePath.join(root, ".config", "opencode", "skills", "demo"),
    scope: "global",
  }), "utf-8")

  const req = new Request("http://localhost/skill")
  const res = await handleSkillEndpoint("/skill", "GET", new URL(req.url), {
    fetchUpstreamSkills: async () => new Response("[]", { headers: { "Content-Type": "application/json" } }),
  })

  const skills = await res!.json() as Array<{ name: string; state?: string; hiddenPath?: string; sourcePath?: string; location: string }>
  const disabled = skills.find((skill) => skill.state === "disabled")
  expect(disabled?.name).toBe("demo")
  expect(disabled?.sourcePath).toBe(nodePath.join(root, ".config", "opencode", "skills", "demo"))
  expect(disabled?.hiddenPath).toBe(hidden)
  expect(disabled?.location).toBe(nodePath.join(root, ".config", "opencode", "skills", "demo", "SKILL.md"))
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

test("deletes a global custom provider from merged config files", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-global-provider-"))
  process.env.HOME = root

  const dir = nodePath.join(root, ".config", "opencode")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    nodePath.join(dir, "opencode.json"),
    JSON.stringify({ provider: { foo: { name: "Foo", npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://example.com/v1" } } } }, null, 2),
    "utf-8",
  )
  await fs.writeFile(
    nodePath.join(dir, "config.json"),
    JSON.stringify({ provider: { foo: { name: "Foo copy", npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://example.com/v1" } }, bar: { name: "Bar" } } }, null, 2),
    "utf-8",
  )

  const req = new Request("http://localhost/api/ext/global-provider?providerID=foo", {
    method: "DELETE",
  })

  const res = await handleExtendedEndpoint("/api/ext/global-provider", "DELETE", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)

  const savedConfig = JSON.parse(await fs.readFile(nodePath.join(dir, "config.json"), "utf-8")) as { provider?: Record<string, unknown> }
  const savedProvider = JSON.parse(await fs.readFile(nodePath.join(dir, "opencode.json"), "utf-8")) as { provider?: Record<string, unknown> }
  expect(savedConfig.provider?.foo).toBeUndefined()
  expect(savedConfig.provider?.bar).toBeDefined()
  expect(savedProvider.provider?.foo).toBeUndefined()
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

test("replays oauth callback urls to the backend listener host", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init })
    expect(String(input)).toBe("http://127.0.0.1:1455/auth/callback?code=abc123&state=xyz")
    return new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })
  }) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/provider-oauth/replay?target=http://127.0.0.1:4096", {
      method: "POST",
      body: JSON.stringify({
        providerID: "openai",
        callbackUrl: "http://localhost:1455/auth/callback#code=abc123&state=xyz",
      }),
    })

    const res = await handleExtendedEndpoint("/api/ext/provider-oauth/replay", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)

    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.providerID).toBe("openai")
    expect(data.status).toBe(200)
    expect(calls).toHaveLength(1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("accepts replay providerID from query for compatibility", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("http://127.0.0.1:1455/auth/callback?code=abc123&state=xyz")
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/provider-oauth/replay?providerID=openai&target=http://127.0.0.1:4096", {
      method: "POST",
      body: JSON.stringify({
        callbackUrl: "http://localhost:1455/auth/callback#code=abc123&state=xyz",
      }),
    })

    const res = await handleExtendedEndpoint("/api/ext/provider-oauth/replay", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("rejects remote targets for opencode restart", async () => {
  const req = new Request("http://localhost/api/ext/opencode/restart?target=http://127.0.0.1:4096", {
    method: "POST",
  })

  const res = await handleExtendedEndpoint("/api/ext/opencode/restart", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(400)
  const data = await res!.json()
  expect(data.ok).toBe(false)
  expect(data.error).toBe("restart is local-only")
})

test("restarts the local opencode service", async () => {
  const originalSpawn = Bun.spawn
  let called = false
  Bun.spawn = ((command: string[], options?: Parameters<typeof Bun.spawn>[1]) => {
    called = true
    expect(command).toEqual(["/package/admin/s6/command/s6-svc", "-r", "/run/service/opencode/"])
    expect(options?.stdout).toBe("ignore")
    expect(options?.stderr).toBe("ignore")
    return {
      stdout: new ReadableStream({ start(controller) { controller.close() } }),
      stderr: new ReadableStream({ start(controller) { controller.close() } }),
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>
  }) as typeof Bun.spawn

  try {
    const req = new Request("http://localhost/api/ext/opencode/restart", {
      method: "POST",
    })

    const res = await handleExtendedEndpoint("/api/ext/opencode/restart", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(202)
    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.message).toBe("Restart scheduled")
    await new Promise((resolve) => setTimeout(resolve, 1600))
    expect(called).toBe(true)
  } finally {
    Bun.spawn = originalSpawn
  }
})

test("still returns accepted when restart spawn later fails", async () => {
  const originalSpawn = Bun.spawn
  Bun.spawn = (() => {
    throw new Error("ENOENT: command not found")
  }) as typeof Bun.spawn

  try {
    const req = new Request("http://localhost/api/ext/opencode/restart", {
      method: "POST",
    })

    const res = await handleExtendedEndpoint("/api/ext/opencode/restart", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(202)
    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.message).toBe("Restart scheduled")
  } finally {
    Bun.spawn = originalSpawn
  }
})

test("probes local opencode health", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/opencode/health")
    const res = await handleExtendedEndpoint("/api/ext/opencode/health", "GET", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)
    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.healthy).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("rejects remote targets for opencode health", async () => {
  const req = new Request("http://localhost/api/ext/opencode/health?target=http://127.0.0.1:4096")
  const res = await handleExtendedEndpoint("/api/ext/opencode/health", "GET", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(400)
  const data = await res!.json()
  expect(data.ok).toBe(false)
  expect(data.error).toBe("health is local-only")
})

test("retries replay through host.docker.internal after loopback connection failure", async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (calls.length === 1) {
      throw new Error("Unable to connect. Is the computer able to access the url?")
    }
    expect(url).toBe("http://host.docker.internal:1455/auth/callback?code=abc123&state=xyz")
    return new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })
  }) as unknown as typeof fetch

  try {
    const req = new Request("http://localhost/api/ext/provider-oauth/replay?providerID=openai&target=http://127.0.0.1:4096", {
      method: "POST",
      body: JSON.stringify({
        providerID: "openai",
        callbackUrl: "http://localhost:1455/auth/callback#code=abc123&state=xyz",
      }),
    })

    const res = await handleExtendedEndpoint("/api/ext/provider-oauth/replay", "POST", new URL(req.url), req)
    expect(res).toBeDefined()
    expect(res!.status).toBe(200)

    const data = await res!.json()
    expect(data.ok).toBe(true)
    expect(data.providerID).toBe("openai")
    expect(data.status).toBe(200)
    expect(calls).toHaveLength(2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("rejects invalid oauth callback urls for replay", async () => {
  const req = new Request("http://localhost/api/ext/provider-oauth/replay?target=http://127.0.0.1:4096", {
    method: "POST",
    body: JSON.stringify({
      providerID: "openai",
      callbackUrl: "https://example.com/auth/callback?code=abc123&state=xyz",
    }),
  })

  const res = await handleExtendedEndpoint("/api/ext/provider-oauth/replay", "POST", new URL(req.url), req)
  expect(res).toBeDefined()
  expect(res!.status).toBe(400)
  const data = await res!.json()
  expect(data.ok).toBe(false)
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
