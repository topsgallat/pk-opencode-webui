import { describe, test, expect, beforeEach, afterEach, beforeAll } from "bun:test"
import {
  getServerAuth,
  setServerAuth,
  removeServerAuth,
  getServerAuthMap,
  markServerAuthForRevalidation,
  clearServerAuthRevalidation,
  cleanupServerAuth,
  migrateLegacyServerAuth
} from "./server-auth"
import type { ServerConfig } from "./servers"

describe("server-auth", () => {
  beforeAll(() => {
    let store: Record<string, string> = {}
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { store = {} },
      length: 0,
      key: () => null
    } as Storage
  })

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  test("can save and retrieve server credentials", () => {
    setServerAuth("server-1", { username: "admin", password: "password123" })
    
    const auth = getServerAuth("server-1")
    expect(auth).toBeDefined()
    expect(auth?.username).toBe("admin")
    expect(auth?.password).toBe("password123")
  })

  test("does not save empty passwords", () => {
    setServerAuth("server-1", { username: "admin", password: "" })
    const auth = getServerAuth("server-1")
    expect(auth).toBeUndefined()
  })

  test("can remove server credentials", () => {
    setServerAuth("server-1", { username: "admin", password: "password123" })
    removeServerAuth("server-1")
    const auth = getServerAuth("server-1")
    expect(auth).toBeUndefined()
  })

  test("can mark and clear revalidation", () => {
    setServerAuth("server-1", { username: "admin", password: "password123" })
    
    markServerAuthForRevalidation("server-1")
    expect(getServerAuth("server-1")?.needsRevalidation).toBe(true)
    
    clearServerAuthRevalidation("server-1")
    expect(getServerAuth("server-1")?.needsRevalidation).toBeUndefined()
  })

  test("cleanupServerAuth removes orphaned credentials", () => {
    setServerAuth("server-1", { username: "admin", password: "password123" })
    setServerAuth("server-2", { username: "user", password: "password456" })

    // server-2 is orphaned
    cleanupServerAuth([{ id: "server-1", name: "s1", url: "url1", isDefault: true }])

    expect(getServerAuth("server-1")).toBeDefined()
    expect(getServerAuth("server-2")).toBeUndefined()
  })

  test("migrateLegacyServerAuth moves credentials from old format", () => {
    // Legacy server entries in older storage formats included username/password
    // fields. Cast to unknown first to avoid a strict type mismatch in the test
    // environment — the runtime migration function handles moving these
    // credentials into the separate auth store.
    const servers = [
      { id: "server-1", name: "s1", url: "url1", isDefault: true, password: "legacy-password", username: "legacy-user" }
    ] as unknown as ServerConfig[]
    
    const changed = migrateLegacyServerAuth(servers)
    expect(changed).toBe(true)
    
    const auth = getServerAuth("server-1")
    expect(auth?.username).toBe("legacy-user")
    expect(auth?.password).toBe("legacy-password")
    expect(auth?.needsRevalidation).toBe(true)
  })
})
