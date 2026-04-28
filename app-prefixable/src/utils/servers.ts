/**
 * Multi-server management for OpenCode backends.
 *
 * Allows one web UI to connect to multiple `opencode serve` backends.
 */

import { dispatchStorageEvent } from "./storage"

const SERVERS_KEY = "opencode.servers"

export interface ServerConfig {
  id: string
  name: string
  url: string
  isDefault: boolean
}

const FALLBACK_SERVER_URL = "http://127.0.0.1:4096"

export function normalizeServerUrl(url: string): string {
  const value = url.trim()
  const parsed = new URL(value)
  const path = parsed.pathname.replace(/\/+$/, "")
  const search = parsed.search
  return `${parsed.origin}${path}${search}`
}

export function getServerKey(server: Pick<ServerConfig, "url">): string {
  return normalizeServerUrl(server.url)
}

export function getDefaultServerUrl(): string {
  const config = typeof window === "undefined"
    ? undefined
    : (window as Window & {
      __OPENCODE__?: {
        defaultServerUrl?: string
      }
    }).__OPENCODE__
  const url = typeof window === "undefined"
    ? undefined
    : config?.defaultServerUrl
  return normalizeServerUrl(url || FALLBACK_SERVER_URL)
}

export function getTargetServerUrl(server?: Pick<ServerConfig, "url">): string | undefined {
  if (!server) return undefined
  const url = getServerKey(server)
  if (url === getDefaultServerUrl()) return undefined
  return url
}

export function isLocalServer(server?: Pick<ServerConfig, "url">): boolean {
  if (!server) return true
  const hostname = new URL(getServerKey(server)).hostname
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1"
}

function builtinServer(): ServerConfig {
  const url = getDefaultServerUrl()
  return { id: "builtin", name: "Local", url, isDefault: true }
}

export function getServers(): ServerConfig[] {
  try {
    const stored = localStorage.getItem(SERVERS_KEY)
    const list: ServerConfig[] = stored ? JSON.parse(stored).map((server: ServerConfig) => ({
      ...server,
      url: normalizeServerUrl(server.url),
    })) : []
    return list.length > 0 ? list : [builtinServer()]
  } catch {
    return [builtinServer()]
  }
}

/**
 * Get the default server
 */
export function getDefaultServer(servers = getServers()): ServerConfig | undefined {
  return servers.find(s => s.isDefault) ?? servers[0]
}

export function resolveSelectedServer(id: string | null, servers = getServers()): ServerConfig | undefined {
  if (id) {
    const selected = servers.find((s) => s.id === id)
    if (selected) return selected
  }
  return getDefaultServer(servers)
}

/**
 * Get a server by ID
 */
export function getServer(id: string): ServerConfig | undefined {
  return getServers().find(s => s.id === id)
}

/**
 * Save servers to localStorage
 */
export function saveServers(servers: ServerConfig[]): void {
  const value = JSON.stringify(servers)
  localStorage.setItem(SERVERS_KEY, value)
  dispatchStorageEvent(SERVERS_KEY, value)
}

/**
 * Add or update a server
 */
export function saveServer(server: ServerConfig): void {
  const servers = getServers()
  const normalized = { ...server, url: normalizeServerUrl(server.url) }
  const existing = servers.findIndex(s => s.id === normalized.id)

  if (normalized.isDefault) {
    // Clear default from others, set this as default
    servers.forEach(s => s.isDefault = false)
    normalized.isDefault = true
  }

  if (existing >= 0) {
    servers[existing] = normalized
  } else {
    servers.push(normalized)
  }

  saveServers(servers)
}

/**
 * Remove a server
 */
export function removeServer(id: string): void {
  const servers = getServers().filter(s => s.id !== id)
  saveServers(servers)
}

/**
 * Generate a unique server ID
 */
export function generateServerId(): string {
  return `server_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Validate server URL
 */
export function isValidServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Get servers as options for dropdown
 */
export function getServerOptions(): { label: string; value: string }[] {
  return getServers().map(s => ({
    label: s.name || s.url,
    value: s.id,
  }))
}
