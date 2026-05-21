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
