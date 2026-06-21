import {
  createContext,
  createEffect,
  createSignal,
  onMount,
  useContext,
  onCleanup,
  type ParentProps,
} from "solid-js"
import { getServerUrl } from "../utils/path"
import { loadSettings, saveSetting } from "../utils/settings-api"

type ThemePreference = "light" | "dark" | "system"

const STORAGE_KEY = "opencode.theme"
const SETTINGS_NAMESPACE = "ui"
const SETTINGS_KEY = "theme"

function loadPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") return stored
  } catch {
    // localStorage may be unavailable (e.g. privacy mode)
  }
  return "system"
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system"
}

function persistPreference(v: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    // Ignore persistence errors (e.g. storage disabled or quota exceeded)
  }
  void saveSetting(getServerUrl(), SETTINGS_NAMESPACE, SETTINGS_KEY, v).catch(() => undefined)
}

function resolve(pref: ThemePreference, systemDark: boolean) {
  if (pref === "system") return systemDark ? "dark" : "light"
  return pref
}

interface ThemeContextValue {
  theme: () => ThemePreference
  setTheme: (v: ThemePreference) => void
  resolved: () => "light" | "dark"
}

const ThemeContext = createContext<ThemeContextValue>()

export function ThemeProvider(props: ParentProps) {
  const [theme, setThemeRaw] = createSignal<ThemePreference>(loadPreference())

  const query = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined

  const [systemDark, setSystemDark] = createSignal(query?.matches ?? false)

  if (query) {
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    // Narrow to EventTarget-compatible for addEventListener
    if (typeof (query as MediaQueryList).addEventListener === "function") {
      ;(query as MediaQueryList).addEventListener("change", handler)
      onCleanup(() => (query as MediaQueryList).removeEventListener("change", handler))
    } else if (typeof (query as any).addListener === "function") {
      // Legacy API - narrow and call
      ;(query as any).addListener(handler)
      onCleanup(() => (query as any).removeListener(handler))
    }
  }

  onMount(() => {
    const initial = theme()

    function handleStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      setThemeRaw(loadPreference())
    }

    window.addEventListener("storage", handleStorage)
    onCleanup(() => window.removeEventListener("storage", handleStorage))

    void (async () => {
      const settings = await loadSettings(getServerUrl(), SETTINGS_NAMESPACE).catch(() => null)
      const stored = settings ? settings[SETTINGS_KEY] : undefined
      if (isThemePreference(stored)) {
        if (theme() !== initial) return
        setThemeRaw(stored)
        try {
          localStorage.setItem(STORAGE_KEY, stored)
        } catch {
          // Ignore persistence errors (e.g. storage disabled or quota exceeded)
        }
        return
      }

      if (theme() !== initial) return
      persistPreference(initial)
    })()
  })

  const setTheme = (v: ThemePreference) => {
    setThemeRaw(v)
    persistPreference(v)
  }

  const resolved = () => resolve(theme(), systemDark())

  createEffect(() => {
    if (typeof document === "undefined") return
    const dark = resolved() === "dark"
    document.documentElement.classList.toggle("dark", dark)
  })

  const value: ThemeContextValue = { theme, setTheme, resolved }

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
