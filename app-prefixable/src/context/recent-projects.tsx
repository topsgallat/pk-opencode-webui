import { createContext, useContext, createSignal, createEffect, on, type ParentProps } from "solid-js"
import { useServer } from "./server"
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

const MAX_RECENT = 10
const SETTINGS_NAMESPACE = "recent-projects"

const RecentProjectsContext = createContext<RecentProjectsContextValue>()

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return typeof item.path === "string" && typeof item.name === "string" && typeof item.lastOpened === "number"
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
  const [projects, setProjects] = createSignal<RecentProject[]>([])
  let loadSeq = 0

  createEffect(on(serverKey, (key) => {
    setProjects([])

    const seq = ++loadSeq
    void loadFromSettings(key).then((db) => {
      if (seq !== loadSeq) return

      if (db !== null) {
        setProjects(db)
        return
      }

      setProjects([])
    })
  }))

  function add(path: string) {
    const normalized = path.replace(/\/+$/, "")
    setProjects((prev) => {
      // Remove existing entry for this path
      const filtered = prev.filter((p) => p.path !== normalized)
      // Add to front with current timestamp
      const updated = [{ path: normalized, name: getProjectName(normalized), lastOpened: Date.now() }, ...filtered]
      // Limit to MAX_RECENT
      const limited = updated.slice(0, MAX_RECENT)
      saveToSettings(serverKey(), limited)
      return limited
    })
  }

  function remove(path: string) {
    const normalized = path.replace(/\/+$/, "")
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.path !== normalized)
      saveToSettings(serverKey(), filtered)
      return filtered
    })
  }

  function clear() {
    setProjects([])
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
