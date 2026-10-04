import { Router, Route, useNavigate, useParams } from "@solidjs/router"
import { createMemo, createSignal, Show, onMount, onCleanup } from "solid-js"
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
import { ClaudeSession } from "./pages/claude-session"
import { Settings } from "./pages/settings"
import { Logs } from "./pages/logs"
import { ProjectPicker } from "./pages/project-picker"
import { deriveDirectoryFromPathname } from "./utils/path"
import { getLastSessionHref, projectsStorageKey, shouldFallbackToRecent } from "./utils/session-href"
import { hydrateSoundSettingsFromDb } from "./utils/sound"
import type { Project } from "./components/shared"

function DirectoryIndex() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  const server = useServer()
  // Deferred like the Session redirect (a synchronous navigate during the
  // route's first render re-enters the router mid-context-creation) and with
  // an absolute target so a late/racing invocation cannot double-append.
  onMount(() => {
    const href = getLastSessionHref(params.dir, server.serverKey(), shouldFallbackToRecent())
    const target = href === "session" ? `/${params.dir}/session` : href === "/" ? "/" : `/${params.dir}/${href}`
    setTimeout(() => navigate(target, { replace: true }), 0)
  })
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
        {/* Single optional-param route: /session and /session/:id share the
            Session component so navigating between them never remounts the
            route (a SessionIndex redirect transition used to tear the route
            context down mid-render and crash the router primitives). */}
        <Route path="/session/:id?" component={Session} />
        <Route path="/settings" component={Settings} />
        <Route path="/logs" component={Logs} />
      </Route>

      {/*
        Claude Code chat: deliberately outside DirectoryLayout so it doesn't
        instantiate the OpenCode SDK/event/sync providers, which assume an
        `opencode serve` backend. See shared/claude-api.ts for the backend.
      */}
      <Route path="/:dir/claude" component={ClaudeSession} />
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
    <Show when={serverKey()} keyed>
      {(key) => <ServerScopedApp serverKey={key} />}
    </Show>
  )
}

export function App() {
  onMount(() => {
    void hydrateSoundSettingsFromDb()
  })

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
