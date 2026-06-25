import { createContext, useContext, createEffect, createSignal, onCleanup, onMount, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { useServer } from "./server"
import { useEvents } from "./events"
import { mkdir } from "../utils/extended-api"
import { getServerCapabilities } from "../utils/server-capabilities"
import { useClientAuth } from "./client-auth"
import { loadSettings, saveSetting } from "../utils/settings-api"
import { base64Encode } from "../utils/path"
import { generateUUID } from "../utils/uuid"

interface PTYSession {
  id: string
  title: string
}

interface TerminalTabRecord {
  ptyID: string
  title: string
}

interface TerminalSessionRecord {
  tabs: TerminalTabRecord[]
  version: number
  updatedAt: number
}

interface TerminalUIState {
  active: string | null
  opened: boolean
  height: number
}

interface TerminalContextValue {
  sessions: () => PTYSession[]
  active: () => string | null
  opened: () => boolean
  height: () => number
  error: () => string | null
  creating: () => boolean
  create: (cwd?: string) => Promise<string | null>
  close: (id: string) => Promise<void>
  setActive: (id: string | null) => void
  toggle: (cwd?: string) => void
  open: (cwd?: string) => void
  setHeight: (h: number) => void
  clearError: () => void
}

const TerminalContext = createContext<TerminalContextValue>()
const TERMINAL_NAMESPACE_PREFIX = "terminal.server"
const TERMINAL_UI_KEY_PREFIX = "opencode.terminal.ui"
const TERMINAL_TAB_ID_KEY = "opencode.terminal.tabId"

function terminalNamespace(serverKey: string) {
  return `${TERMINAL_NAMESPACE_PREFIX}.${base64Encode(serverKey)}`
}

function terminalSessionKey(directory: string, sessionID: string) {
  return `session:${base64Encode(directory)}:${sessionID}`
}

function terminalUIKey(serverKey: string, directory: string, sessionID: string) {
  return `${TERMINAL_UI_KEY_PREFIX}.${base64Encode(serverKey)}.${base64Encode(directory)}.${sessionID}`
}

function normalizeTab(value: unknown, fallbackTitle: string): TerminalTabRecord | null {
  if (!value || typeof value !== "object") return null
  const tab = value as Record<string, unknown>
  const ptyID = typeof tab.ptyID === "string" ? tab.ptyID : typeof tab.id === "string" ? tab.id : null
  if (!ptyID) return null
  const title = typeof tab.title === "string" && tab.title.trim() ? tab.title : fallbackTitle
  return { ptyID, title }
}

function normalizeSessionRecord(value: unknown): TerminalSessionRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.flatMap((tab, index) => {
        const normalized = normalizeTab(tab, `Terminal ${index + 1}`)
        return normalized ? [normalized] : []
      })
    : []
  const version = typeof record.version === "number" ? record.version : 1
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
  return { tabs, version, updatedAt }
}

function readUIState(key: string): TerminalUIState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      active: typeof value.active === "string" ? value.active : null,
      opened: value.opened === true,
      height: typeof value.height === "number" && Number.isFinite(value.height) ? value.height : 280,
    }
  } catch {
    return null
  }
}

function writeUIState(key: string, state: TerminalUIState) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(state))
  } catch {
    return
  }
}

function readTabID() {
  if (typeof window === "undefined") return generateUUID()
  try {
    const existing = window.sessionStorage.getItem(TERMINAL_TAB_ID_KEY)
    if (existing) return existing
    const next = generateUUID()
    window.sessionStorage.setItem(TERMINAL_TAB_ID_KEY, next)
    return next
  } catch {
    return generateUUID()
  }
}

export function TerminalProvider(props: ParentProps) {
  const { client, url: serverUrl, targetUrl, directory } = useSDK()
  const server = useServer()
  const events = useEvents()
  const auth = useClientAuth()
  const params = useParams<{ id?: string }>()
  const capabilities = () => getServerCapabilities(server.selectedServer())
  const [sessions, setSessions] = createSignal<PTYSession[]>([])
  const [active, setActive] = createSignal<string | null>(null)
  const [opened, setOpened] = createSignal(false)
  const [height, setHeight] = createSignal(280)
  const [error, setError] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  const [boundSessionID, setBoundSessionID] = createSignal<string | null>(params.id ?? null)
  const [restoredSessionID, setRestoredSessionID] = createSignal<string | null>(null)
  const [hasStoredRecord, setHasStoredRecord] = createSignal(false)
  const tabID = readTabID()
  const restoreState = { version: 0 }

  function currentSessionID() {
    return params.id ?? boundSessionID()
  }

  function sessionNamespace() {
    return terminalNamespace(server.serverKey())
  }

  function sessionRecordKey(sessionID: string) {
    if (!directory) return null
    return terminalSessionKey(directory, sessionID)
  }

  function sessionUIKey(sessionID: string) {
    if (!directory) return null
    return terminalUIKey(server.serverKey(), directory, sessionID)
  }

  async function loadSessionRecord(sessionID: string) {
    const key = sessionRecordKey(sessionID)
    if (!key) return null
    const data = await loadSettings(serverUrl, sessionNamespace()).catch(() => null)
    if (!data) return null
    return normalizeSessionRecord(data[key])
  }

  async function saveSessionRecord(sessionID: string, tabs: PTYSession[]) {
    const key = sessionRecordKey(sessionID)
    if (!key) return
    const record: TerminalSessionRecord = {
      tabs: tabs.map((tab) => ({ ptyID: tab.id, title: tab.title })),
      version: 1,
      updatedAt: Date.now(),
    }
    await saveSetting(serverUrl, sessionNamespace(), key, record)
    setHasStoredRecord(true)
  }

  function persistUIState(sessionID: string) {
    const key = sessionUIKey(sessionID)
    if (!key) return
    writeUIState(key, {
      active: active(),
      opened: opened(),
      height: height(),
    })
  }

  async function restore(sessionID: string) {
    if (!directory) return
    const version = ++restoreState.version
    setError(null)
    setCreating(false)
    setRestoredSessionID(null)

    try {
      const [record, ptys] = await Promise.all([
        loadSessionRecord(sessionID),
        client.pty.list({ directory }),
      ])

      if (version !== restoreState.version) return

      const live = Array.isArray(ptys.data) ? ptys.data : []
      const liveMap = new Map(live.map((pty) => [pty.id, pty]))
      const nextTabs: PTYSession[] = []
      const storedTabs = record?.tabs ?? []

      for (const tab of storedTabs) {
        const livePty = liveMap.get(tab.ptyID)
        if (!livePty) continue
        nextTabs.push({
          id: livePty.id,
          title: livePty.title || tab.title || `Terminal ${nextTabs.length + 1}`,
        })
      }

      setHasStoredRecord(!!record)
      setSessions(nextTabs)

      const ui = readUIState(keyForUI(sessionID))
      const nextActive = ui?.active && nextTabs.some((tab) => tab.id === ui.active)
        ? ui.active
        : nextTabs[0]?.id ?? null

      setActive(nextActive)
      setOpened(ui?.opened ?? false)
      setHeight(ui?.height ?? 280)
      setRestoredSessionID(sessionID)

      const shouldPersist = !!record && nextTabs.length !== storedTabs.length
      const titlesChanged = !!record && nextTabs.some((tab, index) => storedTabs[index]?.ptyID !== tab.id || storedTabs[index]?.title !== tab.title)
      if (shouldPersist || titlesChanged) {
        void saveSessionRecord(sessionID, nextTabs).catch(() => undefined)
      }
    } catch (e) {
      console.error("[Terminal] Failed to restore session:", e)
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Failed to restore terminal session: ${msg}`)
      setSessions([])
      setActive(null)
      setOpened(false)
      setHeight(280)
      setRestoredSessionID(sessionID)
    }
  }

  function keyForUI(sessionID: string) {
    const key = sessionUIKey(sessionID)
    return key ?? `opencode.terminal.ui.${tabID}`
  }

  function activeSessionID() {
    return currentSessionID()
  }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    setBoundSessionID(sessionID)
    void restore(sessionID)
  })

  createEffect(() => {
    const sessionID = activeSessionID()
    const restored = restoredSessionID()
    if (!sessionID || restored !== sessionID) return
    persistUIState(sessionID)
  })

  createEffect(() => {
    const sessionID = activeSessionID()
    const restored = restoredSessionID()
    if (!sessionID || restored !== sessionID) return
    const tabs = sessions()
    if (!hasStoredRecord() && tabs.length === 0) return
    void saveSessionRecord(sessionID, tabs).catch(() => undefined)
  })

  onMount(() => {
    const unsub = events.subscribe((event) => {
      if (event.type !== "pty.created" && event.type !== "pty.exited" && event.type !== "pty.deleted") return
      const sessionID = activeSessionID()
      if (!sessionID) return
      if (restoredSessionID() !== sessionID) return
      void restore(sessionID)
    })

    onCleanup(unsub)
  })

  async function create(cwd?: string): Promise<string | null> {
    const sessionID = currentSessionID()
    if (!sessionID) {
      setError("Open a session before creating a terminal")
      return null
    }
    if (!auth.canReconnect()) {
      setError("Authentication required for selected server")
      return null
    }
    setCreating(true)
    setError(null)
    try {
      // Ensure the directory exists before creating the PTY
      if (cwd && capabilities().canCreateDirectories) {
        console.log("[Terminal] Ensuring directory exists:", cwd)
        await mkdir(serverUrl, cwd, targetUrl)
      }

      console.log("[Terminal] Creating PTY session, cwd:", cwd)
      const title = `Terminal ${sessions().length + 1}`
      const res = await client.pty.create({ cwd, title })
      console.log("[Terminal] PTY create response:", res)
      if (res.data) {
        const session: PTYSession = {
          id: res.data.id,
          title: res.data.title || title,
        }
        setSessions((prev) => [...prev, session])
        setActive(session.id)
        setOpened(true)
        setRestoredSessionID(sessionID)
        setHasStoredRecord(true)
        return session.id
      }
      setError("Failed to create terminal: No data in response")
    } catch (e) {
      console.error("[Terminal] Failed to create PTY:", e)
      const result = auth.classifyAuthFailure(e)
      if (result.auth) auth.markFailure({ scope: "pty-create", status: result.status, message: result.message })
      const msg = typeof e === "object" && e && "message" in e && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : typeof e === "string"
          ? e
          : "Unknown error"
      setError(`Failed to create terminal: ${msg}`)
    } finally {
      setCreating(false)
    }
    return null
  }

  async function close(id: string): Promise<void> {
    const sessionID = currentSessionID()
    try {
      await client.pty.remove({ ptyID: id })
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (active() === id) {
        const remaining = sessions().filter((s) => s.id !== id)
        setActive(remaining.length > 0 ? remaining[0].id : null)
        if (remaining.length === 0) {
          setOpened(false)
        }
      }
      if (sessionID) setRestoredSessionID(sessionID)
    } catch (e) {
      console.error("Failed to close PTY:", e)
    }
  }

  function toggle(cwd?: string) {
    if (opened()) {
      setOpened(false)
      return
    }
    if (sessions().length === 0) {
      void create(cwd)
      return
    }
    setOpened(true)
  }

  function open(cwd?: string) {
    if (sessions().length === 0) {
      void create(cwd)
      return
    }
    setOpened(true)
  }

  return (
    <TerminalContext.Provider
      value={{
        sessions,
        active,
        opened,
        height,
        error,
        creating,
        create,
        close,
        setActive,
        toggle,
        open,
        setHeight,
        clearError: () => setError(null),
      }}
    >
      {props.children}
    </TerminalContext.Provider>
  )
}

export function useTerminal() {
  const ctx = useContext(TerminalContext)
  if (!ctx) throw new Error("useTerminal must be used within TerminalProvider")
  return ctx
}
