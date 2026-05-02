import { Router, Route, useNavigate, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, onCleanup } from "solid-js"
import { BasePathProvider, useBasePath } from "./context/base-path"
import { BrandingProvider } from "./context/branding"
import { DeviceProvider } from "./context/device"
import { ThemeProvider } from "./context/theme"
import { CommandProvider } from "./context/command"
import { RecentProjectsProvider } from "./context/recent-projects"
import { SavedPromptsProvider } from "./context/saved-prompts"
import { GlobalEventsProvider } from "./context/global-events"
import { ServerAuthUIProvider } from "./context/server-auth-ui"
import { ClientAuthProvider } from "./context/client-auth"
import { ServerAuthPromptManager } from "./components/server-auth-prompt"
import { ServerProvider, useServer } from "./context/server"
import { DirectoryLayout } from "./pages/directory-layout"
import { HomeLayout } from "./pages/home-layout"
import { Session } from "./pages/session"
import { Settings } from "./pages/settings"
import { Logs } from "./pages/logs"
import { ProjectPicker } from "./pages/project-picker"
import { base64Decode, deriveDirectoryFromPathname } from "./utils/path"
import type { Project } from "./components/shared"

const PROJECTS_STORAGE_KEY = "opencode.projects"

function projectsStorageKey(serverKey: string) {
  return `${PROJECTS_STORAGE_KEY}.${serverKey}`
}

function getLastSessionHref(encodedDir: string, serverId: string, fallbackToRecent = false): string {
  try {
    const dir = base64Decode(encodedDir)
    const last = typeof window !== "undefined"
      ? window.localStorage.getItem(`opencode.lastSession.${serverId}.${dir}`)
      : null
    if (!last || last.includes("..") || /[\/\\]/.test(last)) return fallbackToRecent ? "/" : "session"
    return `session/${last}`
  } catch {
    return fallbackToRecent ? "/" : "session"
  }
}

function shouldFallbackToRecent() {
  return typeof window !== "undefined" && new URL(window.location.href).searchParams.get("server-switch") === "1"
}

function DirectoryIndex() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  const server = useServer()
  onMount(() => navigate(getLastSessionHref(params.dir, server.serverKey(), shouldFallbackToRecent()), { replace: true }))
  return null
}

function SessionIndex() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  const server = useServer()
  const href = getLastSessionHref(params.dir, server.serverKey(), shouldFallbackToRecent())
  if (href === "/") return <ProjectPicker />
  if (href === "session") return <Session />
  const id = href.replace(/^session\//, "")
  onMount(() => navigate(id, { replace: true }))
  return null
}

function AppRoutes() {
  const { basePath } = useBasePath()
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath

  return (
    <Router base={base}>
      {/* Root: Show project picker with sidebar */}
      <Route path="/" component={HomeLayout}>
        <Route path="/" component={ProjectPicker} />
        <Route path="/settings" component={Settings} />
      </Route>

      {/* Directory-scoped routes */}
      <Route path="/:dir" component={DirectoryLayout}>
        <Route path="/" component={DirectoryIndex} />
        <Route path="/session" component={SessionIndex} />
        <Route path="/session/:id" component={Session} />
        <Route path="/settings" component={Settings} />
        <Route path="/logs" component={Logs} />
      </Route>
    </Router>
  )
}

/**
 * Reads the active directory from window.location (outside Router context).
 * Re-evaluates on popstate and on history.pushState/history.replaceState navigation.
 */
function useActiveDirectory() {
  const [dir, setDir] = createSignal<string | undefined>(
    typeof window === "undefined" ? undefined : deriveDirectoryFromPathname(),
  )

  onMount(() => {
    // Ensure correct value once mounted (covers SSR hydration)
    setDir(deriveDirectoryFromPathname())

    function update() { setDir(deriveDirectoryFromPathname()) }

    // Patch pushState/replaceState to detect SolidJS Router navigations
    // instead of polling with setInterval
    const origPushState = history.pushState.bind(history)
    const origReplaceState = history.replaceState.bind(history)
    history.pushState = (...args) => { origPushState(...args); update() }
    history.replaceState = (...args) => { origReplaceState(...args); update() }
    window.addEventListener("popstate", update)

    onCleanup(() => {
      history.pushState = origPushState
      history.replaceState = origReplaceState
      window.removeEventListener("popstate", update)
    })
  })

  return dir
}

function useProjectsList(serverKey: string) {
  const [projects, setProjects] = createSignal<Project[]>([])

  function load() {
    try {
      const stored = localStorage.getItem(projectsStorageKey(serverKey))
      if (stored) {
        const parsed = JSON.parse(stored)
        setProjects(Array.isArray(parsed) ? parsed : [])
      } else {
        setProjects([])
      }
    } catch {
      setProjects([])
    }
  }

  onMount(() => {
    load()
    function onStorage(e: StorageEvent) {
      if (e.key === projectsStorageKey(serverKey)) load()
    }
    window.addEventListener("storage", onStorage)
    onCleanup(() => window.removeEventListener("storage", onStorage))
  })

  return projects
}

function ServerScopedApp(props: { serverKey: string }) {
  const projects = useProjectsList(props.serverKey)
  const activeDirectory = useActiveDirectory()

  return (
    <RecentProjectsProvider>
      <SavedPromptsProvider directory={activeDirectory}>
        <ServerAuthUIProvider>
          <ClientAuthProvider>
            <GlobalEventsProvider projects={projects} activeDirectory={activeDirectory}>
              <CommandProvider>
                <AppRoutes />
                <ServerAuthPromptManager />
              </CommandProvider>
            </GlobalEventsProvider>
          </ClientAuthProvider>
        </ServerAuthUIProvider>
      </SavedPromptsProvider>
    </RecentProjectsProvider>
  )
}

function ServerBoundary() {
  const server = useServer()
  const serverKey = createMemo(() => server.serverKey())

  return (
    <For each={[serverKey()]}>
      {(key) => <ServerScopedApp serverKey={key} />}
    </For>
  )
}

export function App() {
  return (
    <BasePathProvider>
      <DeviceProvider>
        <ThemeProvider>
          <BrandingProvider>
            <ServerProvider>
              <ServerBoundary />
            </ServerProvider>
          </BrandingProvider>
        </ThemeProvider>
      </DeviceProvider>
    </BasePathProvider>
  )
}
