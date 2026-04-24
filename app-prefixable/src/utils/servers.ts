/**
 * Multi-server management for OpenCode instances
 *
 * Allows connecting to multiple OpenCode servers and switching between them.
 */

const SERVERS_KEY = "opencode.servers"

/**
 * Server configuration
 */
export interface ServerConfig {
  id: string
  name: string // user-friendly name, e.g., "Production", "Dev"
  url: string // base URL, e.g., "http://localhost:4096"
  isDefault: boolean
}

/**
 * Get all stored servers
 */
export function getServers(): ServerConfig[] {
  try {
    const stored = localStorage.getItem(SERVERS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Save servers to localStorage
 */
export function saveServers(servers: ServerConfig[]) {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers))
}

/**
 * Add a new server
 */
export function addServer(server: ServerConfig) {
  const servers = getServers()
  const existing = servers.findIndex(s => s.id === server.id)
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
export function removeServer(id: string) {
  const servers = getServers().filter(s => s.id !== id)
  saveServers(servers)
}

/**
 * Get a specific server by ID
 */
export function getServer(id: string): ServerConfig | undefined {
  return getServers().find(s => s.id === id)
}

/**
 * Get the default server (first one marked as default, or first one if none)
 */
export function getDefaultServer(): ServerConfig | undefined {
  const servers = getServers()
  return servers.find(s => s.isDefault) || servers[0]
}
