import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { handleExtendedEndpoint } from "./extended-api"
import { __resetProviderAuthSessionsForTests, resolveProviderAuthHeader } from "./provider-auth-session"

const env = {
  HOME: process.env.HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

afterEach(() => {
  process.env.HOME = env.HOME
  process.env.XDG_DATA_HOME = env.XDG_DATA_HOME
  __resetProviderAuthSessionsForTests()
})

test("syncs oauth provider auth from backend auth file", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-auth-"))
  process.env.XDG_DATA_HOME = root

  const dir = nodePath.join(root, "opencode")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(nodePath.join(dir, "auth.json"), JSON.stringify({ openai: { type: "oauth", access: "oauth-access-token" } }), "utf-8")

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
