import { createContext, useContext, createSignal, createEffect, type ParentProps } from "solid-js"
import {
  getServers,
  getDefaultServer,
  getServer,
  type ServerConfig,
} from "../utils/servers"

const SERVERS_STORAGE_KEY = "opencode.selectedServer"

interface ServerContextValue {
  servers: () => ServerConfig[]
  selectedServerId: () => string | null
  selectedServer: () => ServerConfig | undefined
  setSelectedServer: (id: string | null) => void
}

const ServerContext = createContext<ServerContextValue>()

export function ServerProvider(props: ParentProps) {
  const [servers, setServers] = createSignal<ServerConfig[]>(getServers())
  const [selectedServerId, setSelectedServerId] = createSignal<string | null>(
    typeof window === "undefined" ? null : localStorage.getItem(SERVERS_STORAGE_KEY)
  )

  const selectedServer = () => {
    const id = selectedServerId()
    if (id) return servers().find((s) => s.id === id)
    return getDefaultServer()
  }

  const setSelectedServer = (id: string | null) => {
    setSelectedServerId(id)
    if (typeof window !== "undefined") {
      if (id) {
        localStorage.setItem(SERVERS_STORAGE_KEY, id)
      } else {
        localStorage.removeItem(SERVERS_STORAGE_KEY)
      }
    }
  }

  createEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "opencode.servers") {
        setServers(getServers())
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