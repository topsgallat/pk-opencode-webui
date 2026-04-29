import { beforeEach, describe, expect, test } from "bun:test"
import { getServerAuth, getServerAuthMap, setServerAuth } from "../src/utils/server-auth"
import { getServers, removeServer, saveServer, saveServers, type ServerConfig } from "../src/utils/servers"

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length() {
    return this.map.size
  }

  clear() {
    this.map.clear()
  }

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.map.delete(key)
  }

  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

function readServerList(): Array<Record<string, unknown>> {
  const raw = localStorage.getItem("opencode.servers")
  return raw ? JSON.parse(raw) : []
}

describe("server auth storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    })
  })

  test("keeps auth by server id across url edits", () => {
    const server: ServerConfig = {
      id: "server-1",
      name: "Remote",
      url: "http://example.test:4096",
      isDefault: true,
    }
    saveServers([server])
    setServerAuth(server.id, { username: "opencode", password: "secret" })

    saveServer({ ...server, url: "http://example.test:5000/new-path" })

    const auth = getServerAuth(server.id)
    expect(auth?.password).toBe("secret")
    expect(auth?.needsRevalidation).toBe(true)
    const storedServer = readServerList()[0]
    expect(storedServer.password).toBeUndefined()
    expect(storedServer.username).toBeUndefined()
    expect(Object.keys(getServerAuthMap())).toEqual([server.id])
  })

  test("deleting server clears only its auth entry", () => {
    const a: ServerConfig = { id: "a", name: "A", url: "http://a.test:4096", isDefault: true }
    const b: ServerConfig = { id: "b", name: "B", url: "http://b.test:4096", isDefault: false }
    saveServers([a, b])
    setServerAuth(a.id, { password: "pa" })
    setServerAuth(b.id, { password: "pb" })

    removeServer(a.id)

    const map = getServerAuthMap()
    expect(map[a.id]).toBeUndefined()
    expect(map[b.id]?.password).toBe("pb")
  })

  test("startup is safe when auth storage is missing", () => {
    saveServers([{ id: "safe", name: "Safe", url: "http://safe.test:4096", isDefault: true }])
    localStorage.removeItem("opencode.serverAuth")

    const list = getServers()

    expect(list.length).toBe(1)
    expect(list[0]?.id).toBe("safe")
    expect(getServerAuth("safe")).toBeUndefined()
  })

  test("migrates legacy password fields out of server list", () => {
    localStorage.setItem("opencode.servers", JSON.stringify([
      {
        id: "legacy",
        name: "Legacy",
        url: "http://legacy.test:4096",
        isDefault: true,
        username: "opencode",
        password: "legacy-secret",
      },
    ]))

    const list = getServers()

    expect(list[0]?.id).toBe("legacy")
    const auth = getServerAuth("legacy")
    expect(auth?.password).toBe("legacy-secret")
    expect(auth?.username).toBe("opencode")
    expect(auth?.needsRevalidation).toBe(true)
    const storedServer = readServerList()[0]
    expect(storedServer.password).toBeUndefined()
    expect(storedServer.username).toBeUndefined()
  })

  test("migration keeps existing auth map entry for same server id", () => {
    setServerAuth("legacy", { username: "new-user", password: "new-secret" })
    localStorage.setItem("opencode.servers", JSON.stringify([
      {
        id: "legacy",
        name: "Legacy",
        url: "http://legacy.test:4096",
        isDefault: true,
        username: "old-user",
        password: "old-secret",
      },
    ]))

    const list = getServers()

    expect(list[0]?.id).toBe("legacy")
    const auth = getServerAuth("legacy")
    expect(auth?.username).toBe("new-user")
    expect(auth?.password).toBe("new-secret")
    expect(auth?.needsRevalidation).toBeUndefined()
    const storedServer = readServerList()[0]
    expect(storedServer.password).toBeUndefined()
    expect(storedServer.username).toBeUndefined()
  })

  test("invalid auth entries in storage are ignored during startup", () => {
    localStorage.setItem("opencode.servers", JSON.stringify([
      {
        id: "safe",
        name: "Safe",
        url: "http://safe.test:4096",
        isDefault: true,
      },
    ]))
    localStorage.setItem("opencode.serverAuth", JSON.stringify({
      safe: { username: "ok", password: "pw" },
      brokenA: { username: "x", password: "" },
      brokenB: { username: "y" },
      brokenC: "not-an-object",
    }))

    const list = getServers()

    expect(list[0]?.id).toBe("safe")
    expect(getServerAuth("safe")?.password).toBe("pw")
    expect(getServerAuth("brokenA")).toBeUndefined()
    expect(getServerAuth("brokenB")).toBeUndefined()
    expect(getServerAuth("brokenC")).toBeUndefined()
    expect(Object.keys(getServerAuthMap())).toEqual(["safe"])
  })
})
