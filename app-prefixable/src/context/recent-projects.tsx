import { createContext, useContext, createSignal, createEffect, on, onCleanup, type ParentProps } from "solid-js"
import { useServer } from "./server"
import { dispatchStorageEvent } from "../utils/storage"
import { getServerUrl } from "../utils/path"
import { loadSettings, saveSetting } from "../utils/settings-api"

interface RecentProject {
  path: string
  name: string
  lastOpened: number // timestamp
}

interface RecentProjectsContextValue {
  projects: () => RecentProject[]
  add: (path: string) => void
  remove: (path: string) => void
  clear: () => void
}

const STORAGE_KEY = "opencode-recent-projects"
const MAX_RECENT = 10
const SETTINGS_NAMESPACE = "recent-projects"

const RecentProjectsContext = createContext<RecentProjectsContextValue>()

function storageKey(serverKey: string) {
  return `${STORAGE_KEY}.${serverKey}`
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return typeof item.path === "string" && typeof item.name === "string" && typeof item.lastOpened === "number"
}

function loadFromStorage(serverKey: string): RecentProject[] {
  try {
    if (typeof window === "undefined") return []
    const stored = localStorage.getItem(storageKey(serverKey))
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentProject)
  } catch {
    return []
  }
}

function syncToStorage(serverKey: string, projects: RecentProject[]) {
  if (typeof window === "undefined") return

  try {
    const value = JSON.stringify(projects)
    const key = storageKey(serverKey)
    localStorage.setItem(key, value)
    dispatchStorageEvent(key, value)
  } catch {
    // Ignore storage errors
  }
}

async function loadFromSettings(serverKey: string): Promise<RecentProject[] | null> {
  const settings = await loadSettings(getServerUrl(), SETTINGS_NAMESPACE).catch(() => null)
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, serverKey)) return null

  const value = settings[serverKey]
  if (!Array.isArray(value)) return []
  return value.filter(isRecentProject)
}

function saveToSettings(serverKey: string, projects: RecentProject[]) {
  void saveSetting(getServerUrl(), SETTINGS_NAMESPACE, serverKey, projects).catch(() => undefined)
}

function getProjectName(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  const lastSlash = trimmed.lastIndexOf("/")
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

export function RecentProjectsProvider(props: ParentProps) {
  const server = useServer()
  const serverKey = () => server.serverKey()
  const [projects, setProjects] = createSignal<RecentProject[]>(loadFromStorage(serverKey()))
  let loadSeq = 0

  createEffect(on(serverKey, (key) => {
    setProjects([])
    setProjects(loadFromStorage(key))

    const seq = ++loadSeq
    void loadFromSettings(key).then((db) => {
      if (seq !== loadSeq) return

      if (db !== null) {
        setProjects(db)
        syncToStorage(key, db)
        return
      }

      const local = loadFromStorage(key)
      if (local.length > 0) {
        setProjects(local)
        saveToSettings(key, local)
        return
      }

      setProjects([])
    })
  }))

  createEffect(() => {
    const key = storageKey(serverKey())
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== key) return
      setProjects(loadFromStorage(serverKey()))
    }
    window.addEventListener("storage", handleStorage)
    onCleanup(() => window.removeEventListener("storage", handleStorage))
  })

  function add(path: string) {
    const normalized = path.replace(/\/+$/, "")
    setProjects((prev) => {
      // Remove existing entry for this path
      const filtered = prev.filter((p) => p.path !== normalized)
      // Add to front with current timestamp
      const updated = [{ path: normalized, name: getProjectName(normalized), lastOpened: Date.now() }, ...filtered]
      // Limit to MAX_RECENT
      const limited = updated.slice(0, MAX_RECENT)
      syncToStorage(serverKey(), limited)
      saveToSettings(serverKey(), limited)
      return limited
    })
  }

  function remove(path: string) {
    const normalized = path.replace(/\/+$/, "")
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.path !== normalized)
      syncToStorage(serverKey(), filtered)
      saveToSettings(serverKey(), filtered)
      return filtered
    })
  }

  function clear() {
    setProjects([])
    syncToStorage(serverKey(), [])
    saveToSettings(serverKey(), [])
  }

  return (
    <RecentProjectsContext.Provider value={{ projects, add, remove, clear }}>
      {props.children}
    </RecentProjectsContext.Provider>
  )
}

export function useRecentProjects() {
  const ctx = useContext(RecentProjectsContext)
  if (!ctx) throw new Error("useRecentProjects must be used within RecentProjectsProvider")
  return ctx
}
