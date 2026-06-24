import { createContext, useContext, createSignal, createEffect, onMount, type ParentProps } from "solid-js"
import {
  getServers,
  getDefaultServer,
  resolveSelectedServer,
  getServerKey,
  hydrateServersFromDb,
  type ServerConfig,
} from "../utils/servers"
import { hydrateServerAuthFromDb } from "../utils/server-auth"
import { dispatchStorageEvent } from "../utils/storage"

const SERVERS_STORAGE_KEY = "opencode.selectedServer"
const PROJECTS_STORAGE_KEY = "opencode.projects"
const RECENT_PROJECTS_STORAGE_KEY = "opencode-recent-projects"
const MODELS_BY_AGENT_STORAGE_KEY = "opencode.modelsByAgent"
const SIDEBAR_EXPANDED_STORAGE_KEY = "opencode.sidebarExpanded"
const SHOW_ARCHIVED_STORAGE_KEY = "opencode.showArchived"
const PINNED_SESSIONS_STORAGE_PREFIX = "opencode.pinnedSessions."
const LAST_SESSION_STORAGE_PREFIX = "opencode.lastSession."
const PERMISSION_AUTO_ACCEPT_STORAGE_PREFIX = "prokube-permission-autoaccept-"

const migratedServerStorageKeys = new Set<string>()

function migrateStorageValue(targetKey: string, legacyKey: string) {
  if (targetKey === legacyKey) return
  try {
    if (localStorage.getItem(targetKey) !== null) return
    const legacy = localStorage.getItem(legacyKey)
    if (legacy === null) return
    localStorage.setItem(targetKey, legacy)
  } catch {
    return
  }
}

function migrateStoragePrefix(targetPrefix: string, legacyPrefix: string) {
  if (targetPrefix === legacyPrefix) return
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key?.startsWith(legacyPrefix)) keys.push(key)
    }
    for (const key of keys) {
      const targetKey = `${targetPrefix}${key.slice(legacyPrefix.length)}`
      if (localStorage.getItem(targetKey) !== null) continue
      const legacy = localStorage.getItem(key)
      if (legacy === null) continue
      localStorage.setItem(targetKey, legacy)
    }
  } catch {
    return
  }
}

function migrateServerScopedStorage(server: ServerConfig | undefined) {
  if (typeof window === "undefined") return
  const targetKey = server ? getServerKey(server) : "default"
  if (migratedServerStorageKeys.has(targetKey)) return

  const legacyKeys = server && server.id !== "builtin" ? [server.id] : ["default"]
  for (const legacyKey of legacyKeys) {
    migrateStorageValue(`${PROJECTS_STORAGE_KEY}.${targetKey}`, `${PROJECTS_STORAGE_KEY}.${legacyKey}`)
    migrateStorageValue(`${RECENT_PROJECTS_STORAGE_KEY}.${targetKey}`, `${RECENT_PROJECTS_STORAGE_KEY}.${legacyKey}`)
    migrateStorageValue(`${MODELS_BY_AGENT_STORAGE_KEY}.${targetKey}`, `${MODELS_BY_AGENT_STORAGE_KEY}.${legacyKey}`)
    migrateStorageValue(`${SIDEBAR_EXPANDED_STORAGE_KEY}.${targetKey}`, `${SIDEBAR_EXPANDED_STORAGE_KEY}.${legacyKey}`)
    migrateStorageValue(`${SHOW_ARCHIVED_STORAGE_KEY}.${targetKey}`, `${SHOW_ARCHIVED_STORAGE_KEY}.${legacyKey}`)
    migrateStoragePrefix(`${PINNED_SESSIONS_STORAGE_PREFIX}${targetKey}.`, `${PINNED_SESSIONS_STORAGE_PREFIX}${legacyKey}.`)
    migrateStoragePrefix(`${LAST_SESSION_STORAGE_PREFIX}${targetKey}.`, `${LAST_SESSION_STORAGE_PREFIX}${legacyKey}.`)
    migrateStoragePrefix(`${PERMISSION_AUTO_ACCEPT_STORAGE_PREFIX}${targetKey}-`, `${PERMISSION_AUTO_ACCEPT_STORAGE_PREFIX}${legacyKey}-`)
  }

  migratedServerStorageKeys.add(targetKey)
}

interface ServerContextValue {
  servers: () => ServerConfig[]
  selectedServerId: () => string | null
  selectedServer: () => ServerConfig | undefined
  serverKey: () => string
  setSelectedServer: (id: string | null) => void
}

const ServerContext = createContext<ServerContextValue>()

export function ServerProvider(props: ParentProps) {
  const [servers, setServers] = createSignal<ServerConfig[]>(getServers())
  const [selectedServerId, setSelectedServerId] = createSignal<string | null>(
    typeof window === "undefined" ? null : sessionStorage.getItem(SERVERS_STORAGE_KEY)
  )
  let hydrationDone = false

  const selectedServer = () => resolveSelectedServer(selectedServerId(), servers())

  onMount(() => {
    void Promise.all([
      hydrateServersFromDb(),
      hydrateServerAuthFromDb(),
    ]).then(() => {
      setServers(getServers())
      setSelectedServerId(typeof window === "undefined" ? null : sessionStorage.getItem(SERVERS_STORAGE_KEY))
      hydrationDone = true
    })
  })

  const serverKey = () => {
    const selected = selectedServer()
    if (!selected) return "default"
    return getServerKey(selected)
  }

  createEffect(() => {
    migrateServerScopedStorage(selectedServer())
  })

  const setSelectedServer = (id: string | null) => {
    setSelectedServerId(id)
    if (typeof window !== "undefined") {
      if (id) {
        sessionStorage.setItem(SERVERS_STORAGE_KEY, id)
      } else {
        sessionStorage.removeItem(SERVERS_STORAGE_KEY)
      }
    }
    dispatchStorageEvent(SERVERS_STORAGE_KEY, id)
  }

  createEffect(() => {
    const id = selectedServerId()
    if (!id) return
    if (!hydrationDone) return
    if (servers().some((server) => server.id === id)) return
    const fallback = getDefaultServer(servers())
    setSelectedServer(fallback && fallback.id !== "builtin" ? fallback.id : null)
  })

  createEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "opencode.servers") {
        setServers(getServers())
      }
      if (e.key === SERVERS_STORAGE_KEY) {
        setSelectedServerId(e.newValue)
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("storage", handleStorage)
      return () => window.removeEventListener("storage", handleStorage)
    }
  })

  return (
    <ServerContext.Provider
      value={{
        servers,
        selectedServerId,
        selectedServer,
        serverKey,
        setSelectedServer,
      }}
    >
      {props.children}
    </ServerContext.Provider>
  )
}

export function useServer() {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error("useServer must be used within ServerProvider")
  return ctx
}
