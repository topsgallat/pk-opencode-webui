import type { ServerConfig } from "./servers"
import { dispatchStorageEvent } from "./storage"

const SERVER_AUTH_KEY = "opencode.serverAuth"

export interface ServerAuth {
  username?: string
  password: string
  needsRevalidation?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeServerAuth(value: unknown): ServerAuth | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.password !== "string" || !value.password) return undefined
  const username = typeof value.username === "string" && value.username ? value.username : undefined
  const needsRevalidation = value.needsRevalidation === true ? true : undefined
  return {
    username,
    password: value.password,
    needsRevalidation,
  }
}

export function getServerAuthMap(): Record<string, ServerAuth> {
  try {
    const raw = localStorage.getItem(SERVER_AUTH_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const next: Record<string, ServerAuth> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!id) continue
      const auth = normalizeServerAuth(value)
      if (!auth) continue
      next[id] = auth
    }
    return next
  } catch {
    return {}
  }
}

export function saveServerAuthMap(map: Record<string, ServerAuth>): void {
  const value = JSON.stringify(map)
  localStorage.setItem(SERVER_AUTH_KEY, value)
  dispatchStorageEvent(SERVER_AUTH_KEY, value)
}

export function getServerAuth(id: string): ServerAuth | undefined {
  return getServerAuthMap()[id]
}

export function setServerAuth(id: string, auth: ServerAuth): void {
  if (!id) return
  if (!auth.password) return
  const map = getServerAuthMap()
  map[id] = {
    username: auth.username,
    password: auth.password,
    needsRevalidation: auth.needsRevalidation === true ? true : undefined,
  }
  saveServerAuthMap(map)
}

export function updateServerAuth(id: string, fn: (auth: ServerAuth | undefined) => ServerAuth | undefined): void {
  if (!id) return
  const map = getServerAuthMap()
  const next = fn(map[id])
  if (!next) {
    delete map[id]
    saveServerAuthMap(map)
    return
  }
  if (!next.password) return
  map[id] = next
  saveServerAuthMap(map)
}

export function removeServerAuth(id: string): void {
  if (!id) return
  const map = getServerAuthMap()
  if (!(id in map)) return
  delete map[id]
  saveServerAuthMap(map)
}

export function markServerAuthForRevalidation(id: string): void {
  updateServerAuth(id, (auth) => {
    if (!auth) return undefined
    return { ...auth, needsRevalidation: true }
  })
}

export function clearServerAuthRevalidation(id: string): void {
  updateServerAuth(id, (auth) => {
    if (!auth) return undefined
    return { ...auth, needsRevalidation: undefined }
  })
}

export function cleanupServerAuth(servers: ServerConfig[]): void {
  const ids = new Set(servers.map((s) => s.id))
  const map = getServerAuthMap()
  const next: Record<string, ServerAuth> = {}
  for (const [id, auth] of Object.entries(map)) {
    if (!ids.has(id)) continue
    next[id] = auth
  }
  saveServerAuthMap(next)
}

export function migrateLegacyServerAuth(servers: ServerConfig[]): boolean {
  const map = getServerAuthMap()
  let changed = false
  for (const server of servers) {
    const legacy = server as ServerConfig & { password?: string; username?: string }
    if (map[server.id]) continue
    if (typeof legacy.password !== "string" || !legacy.password) continue
    map[server.id] = {
      username: typeof legacy.username === "string" && legacy.username ? legacy.username : undefined,
      password: legacy.password,
      needsRevalidation: true,
    }
    changed = true
  }
  if (changed) saveServerAuthMap(map)
  return changed
}
