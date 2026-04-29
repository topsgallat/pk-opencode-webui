import { createSignal, Show, For } from "solid-js"
import { useServerAuthUI } from "../context/server-auth-ui"
import { getServers, type ServerConfig } from "../utils/servers"
import { getServerAuth, setServerAuth, clearServerAuthRevalidation } from "../utils/server-auth"
import { Button } from "./ui/button"
import { Portal } from "solid-js/web"

function AuthPromptDialog(props: { serverId: string }) {
  const { resolveAuth, cancelAuth } = useServerAuthUI()
  const servers = getServers()
  const server = servers.find((s) => s.id === props.serverId)
  
  const auth = getServerAuth(props.serverId)
  const [username, setUsername] = createSignal(auth?.username || "")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)

  if (!server) {
    // If the server doesn't exist anymore, just resolve to close it
    resolveAuth(props.serverId)
    return null
  }

  const handleSubmit = () => {
    if (!password()) {
      setError("Password is required")
      return
    }
    setServerAuth(props.serverId, {
      username: username().trim() || "opencode",
      password: password(),
      needsRevalidation: false,
    })
    clearServerAuthRevalidation(props.serverId)
    resolveAuth(props.serverId)
  }

  return (
    <Portal>
      <div
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) cancelAuth(props.serverId)
        }}
      >
        <div
          class="w-full max-w-sm rounded-lg p-6"
          style={{
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.15)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class="text-lg font-medium mb-1" style={{ color: "var(--text-strong)" }}>
            Authentication Required
          </h2>
          <p class="text-sm mb-4" style={{ color: "var(--text-weak)" }}>
            Please enter credentials for <strong>{server.name}</strong> ({server.url})
          </p>

          <Show when={error()}>
            <div
              class="mb-4 p-3 rounded-md text-sm"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-base)",
                "border-left": "3px solid var(--interactive-critical)",
                color: "var(--interactive-critical)",
              }}
            >
              {error()}
            </div>
          </Show>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                Username (optional)
              </label>
              <input
                type="text"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                placeholder="opencode"
                class="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                }}
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1" style={{ color: "var(--text-base)" }}>
                Password
              </label>
              <input
                type="password"
                value={password()}
                onInput={(e) => {
                  setPassword(e.currentTarget.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                  if (e.key === "Escape") cancelAuth(props.serverId)
                }}
                class="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  color: "var(--text-base)",
                }}
                autofocus
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <Button onClick={() => cancelAuth(props.serverId)} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleSubmit} variant="primary">
              Authenticate
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export function ServerAuthPromptManager() {
  const { promptingServers } = useServerAuthUI()

  return (
    <For each={promptingServers()}>
      {(serverId) => <AuthPromptDialog serverId={serverId} />}
    </For>
  )
}
