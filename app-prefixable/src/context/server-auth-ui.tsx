import { createContext, useContext, createSignal, JSX } from "solid-js"

interface ServerAuthUIContextState {
  promptingServers: () => string[]
  requestAuth: (serverId: string) => void
  cancelAuth: (serverId: string) => void
  resolveAuth: (serverId: string) => void
}

const ServerAuthUIContext = createContext<ServerAuthUIContextState>()

export function ServerAuthUIProvider(props: { children: JSX.Element }) {
  const [promptingServers, setPromptingServers] = createSignal<string[]>([])

  const requestAuth = (serverId: string) => {
    setPromptingServers((prev) => {
      if (prev.includes(serverId)) return prev
      return [...prev, serverId]
    })
  }

  const cancelAuth = (serverId: string) => {
    setPromptingServers((prev) => prev.filter((id) => id !== serverId))
  }

  const resolveAuth = (serverId: string) => {
    setPromptingServers((prev) => prev.filter((id) => id !== serverId))
  }

  return (
    <ServerAuthUIContext.Provider
      value={{
        promptingServers,
        requestAuth,
        cancelAuth,
        resolveAuth,
      }}
    >
      {props.children}
    </ServerAuthUIContext.Provider>
  )
}

export function useServerAuthUI() {
  const context = useContext(ServerAuthUIContext)
  if (!context) {
    throw new Error("useServerAuthUI must be used within a ServerAuthUIProvider")
  }
  return context
}
