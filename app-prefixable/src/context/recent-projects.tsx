import { createContext, useContext, createSignal, createEffect, on, onCleanup, type ParentProps } from "solid-js"
import { useServer } from "./server"
import { dispatchStorageEvent } from "../utils/storage"

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

const RecentProjectsContext = createContext<RecentProjectsContextValue>()

function storageKey(serverKey: string) {
  return `${STORAGE_KEY}.${serverKey}`
}

function loadFromStorage(serverKey: string): RecentProject[] {
  try {
    const stored = localStorage.getItem(storageKey(serverKey))
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is RecentProject =>
        typeof p.path === "string" && typeof p.name === "string" && typeof p.lastOpened === "number",
    )
  } catch {
    return []
  }
}

function saveToStorage(serverKey: string, projects: RecentProject[]) {
  try {
    const value = JSON.stringify(projects)
    const key = storageKey(serverKey)
    localStorage.setItem(key, value)
    dispatchStorageEvent(key, value)
  } catch {
    // Ignore storage errors
  }
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

  createEffect(on(serverKey, (key) => {
    setProjects([])
    setProjects(loadFromStorage(key))
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
      saveToStorage(serverKey(), limited)
      return limited
    })
  }

  function remove(path: string) {
    const normalized = path.replace(/\/+$/, "")
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.path !== normalized)
      saveToStorage(serverKey(), filtered)
      return filtered
    })
  }

  function clear() {
    setProjects([])
    saveToStorage(serverKey(), [])
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
