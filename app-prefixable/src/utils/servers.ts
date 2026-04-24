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
<<<<<<< HEAD
 * Get the default server
 */
export function getDefaultServer(): ServerConfig | undefined {
  const servers = getServers()
  return servers.find((s) => s.isDefault) ?? servers[0]
}

/**
 * Get a server by ID
 */
export function getServer(id: string): ServerConfig | undefined {
  return getServers().find((s) => s.id === id)
}

/**
 * Save servers to localStorage
 */
export function saveServers(servers: ServerConfig[]): void {
=======
 * Save servers to localStorage
 */
export function saveServers(servers: ServerConfig[]) {
>>>>>>> 22654d0 (fix: add ServerProvider to app.tsx for useServer hook)
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers))
}

/**
<<<<<<< HEAD
 * Add or update a server
 */
export function saveServer(server: ServerConfig): void {
  const servers = getServers()
  const existing = servers.findIndex((s) => s.id === server.id)

  if (server.isDefault) {
    // Clear default from others, set this as default
    servers.forEach((s) => (s.isDefault = false))
  }

=======
 * Add a new server
 */
export function addServer(server: ServerConfig) {
  const servers = getServers()
  const existing = servers.findIndex(s => s.id === server.id)
>>>>>>> 22654d0 (fix: add ServerProvider to app.tsx for useServer hook)
  if (existing >= 0) {
    servers[existing] = server
  } else {
    servers.push(server)
  }
<<<<<<< HEAD

=======
>>>>>>> 22654d0 (fix: add ServerProvider to app.tsx for useServer hook)
  saveServers(servers)
}

/**
 * Remove a server
 */
<<<<<<< HEAD
export function removeServer(id: string): void {
  const servers = getServers().filter((s) => s.id !== id)
=======
export function removeServer(id: string) {
  const servers = getServers().filter(s => s.id !== id)
>>>>>>> 22654d0 (fix: add ServerProvider to app.tsx for useServer hook)
  saveServers(servers)
}

/**
<<<<<<< HEAD
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
  return getServers().map((s) => ({
    label: s.name || s.url,
    value: s.id,
  }))
=======
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
>>>>>>> 22654d0 (fix: add ServerProvider to app.tsx for useServer hook)
}