/**
 * Multi-server management for OpenCode instances
 *
 * Allows connecting to multiple OpenCode servers and switching between them.
 */

const SERVERS_KEY = "opencode.servers"

export interface ServerConfig {
  id: string
  name: string
  url: string
  isDefault: boolean
}

declare global {
  interface Window {
    __OPENCODE__?: { defaultServerUrl?: string }
  }
}

function builtinServer(): ServerConfig {
  const url = window.__OPENCODE__?.defaultServerUrl || "http://127.0.0.1:4096"
  return { id: "builtin", name: "Local", url, isDefault: true }
}

export function getServers(): ServerConfig[] {
  try {
    const stored = localStorage.getItem(SERVERS_KEY)
    const list: ServerConfig[] = stored ? JSON.parse(stored) : []
    return list.length > 0 ? list : [builtinServer()]
  } catch {
    return [builtinServer()]
  }
}

/**
 * Get the default server
 */
export function getDefaultServer(): ServerConfig | undefined {
  const servers = getServers()
  return servers.find(s => s.isDefault) ?? servers[0]
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
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers))
}

/**
 * Add or update a server
 */
export function saveServer(server: ServerConfig): void {
  const servers = getServers()
  const existing = servers.findIndex(s => s.id === server.id)

  if (server.isDefault) {
    // Clear default from others, set this as default
    servers.forEach(s => s.isDefault = false)
    server.isDefault = true
  }

  if (existing >= 0) {
    servers[existing] = server
  } else {
    servers.push(server)
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
    const parsed = new URL(url)
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
