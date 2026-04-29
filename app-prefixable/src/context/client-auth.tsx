import { createContext, useContext, createSignal, createEffect, onMount, onCleanup, type ParentProps } from "solid-js"
import { useBasePath } from "./base-path"
import { useServer } from "./server"
import { useServerAuthUI } from "./server-auth-ui"
import { getServerAuth } from "../utils/server-auth"
import { getDefaultServerUrl } from "../utils/servers"

export type ClientAuthState = "unknown" | "syncing" | "valid" | "invalid"

type AuthFailureScope = "sdk" | "events" | "global-events" | "sync" | "pty-create" | "pty-connect"

type AuthFailure = {
  scope: AuthFailureScope
  status?: number
  message?: string
}

interface ClientAuthContextValue {
  state: () => ClientAuthState
  canReconnect: () => boolean
  markFailure: (failure: AuthFailure) => void
  classifyAuthFailure: (error: unknown) => { auth: boolean; status?: number; message?: string }
  syncNow: () => Promise<boolean>
}

const ClientAuthContext = createContext<ClientAuthContextValue>()

function classifyAuthFailure(error: unknown): { auth: boolean; status?: number; message?: string } {
  const message = typeof error === "string"
    ? error
    : typeof error === "object" && error && "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : undefined
  const status = typeof error === "object" && error && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined

  if (status === 401 || status === 403) return { auth: true, status, message }

  const bodyStatus = typeof error === "object" && error && "data" in error
    ? (error as { data?: { status?: number } }).data?.status
    : undefined
  if (bodyStatus === 401 || bodyStatus === 403) return { auth: true, status: bodyStatus, message }

  const lower = message?.toLowerCase() ?? ""
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("authentication") ||
    lower.includes("invalid credential") ||
    lower.includes("auth failed")
  ) {
    return { auth: true, status, message }
  }

  return { auth: false, status, message }
}

export function ClientAuthProvider(props: ParentProps) {
  const { serverUrl } = useBasePath()
  const server = useServer()
  const authUI = useServerAuthUI()
  const [state, setState] = createSignal<ClientAuthState>("unknown")

  const selected = () => server.selectedServer()
  const selectedServerID = () => selected()?.id
  const selectedTarget = () => selected()?.isDefault ? getDefaultServerUrl() : selected()?.url
  const canReconnect = () => state() !== "invalid"

  async function syncNow() {
    const serverId = selectedServerID()
    if (!serverId) return true
    const saved = getServerAuth(serverId)
    if (!saved) {
      setState("unknown")
      return true
    }

    setState("syncing")
    const headers = new Headers({ "Content-Type": "application/json" })
    const ok = await fetch(`${serverUrl}/api/ext/auth-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        target: selectedTarget(),
        username: saved.username,
        password: saved.password,
      }),
    }).then((r) => r.ok).catch(() => false)

    if (ok) {
      setState("valid")
      return true
    }

    setState("invalid")
    authUI.requestAuth(serverId)
    return false
  }

  function markFailure(failure: AuthFailure) {
    const serverId = selectedServerID()
    if (!serverId) {
      console.warn("[ClientAuth] markFailure ignored, no serverId");
      return
    }
    console.warn("[ClientAuth] Auth failure", failure.scope, failure.status, failure.message)
    setState("invalid")
    authUI.requestAuth(serverId)
  }

  createEffect(() => {
    selectedServerID()
    setState("unknown")
    void syncNow()
  })

  onMount(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "opencode.serverAuth") return
      void syncNow()
    }
    window.addEventListener("storage", onStorage)
    onCleanup(() => window.removeEventListener("storage", onStorage))
  })

  const value: ClientAuthContextValue = {
    state,
    canReconnect,
    markFailure,
    classifyAuthFailure,
    syncNow,
  }

  return <ClientAuthContext.Provider value={value}>{props.children}</ClientAuthContext.Provider>
}

export function useClientAuth() {
  const ctx = useContext(ClientAuthContext)
  if (!ctx) throw new Error("useClientAuth must be used within ClientAuthProvider")
  return ctx
}
