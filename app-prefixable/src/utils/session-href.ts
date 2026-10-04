import { base64Decode } from "./path"

const PROJECTS_STORAGE_KEY = "opencode.projects"

export function projectsStorageKey(serverKey: string) {
  return `${PROJECTS_STORAGE_KEY}.${serverKey}`
}

/**
 * Where opening a chat should land for this server+directory: the last
 * visited session (`session/<id>`), the empty chat index (`session`), or the
 * home page (`/`) after a server switch with nothing to fall back to.
 */
export function getLastSessionHref(encodedDir: string, serverId: string, fallbackToRecent = false): string {
  try {
    const dir = base64Decode(encodedDir)
    const last = typeof window !== "undefined"
      ? window.localStorage.getItem(`opencode.lastSession.${serverId}.${dir}`)
      : null
    if (!last || last.includes("..") || last.includes("/") || last.includes("\\")) {
      return fallbackToRecent ? "/" : "session"
    }
    return `session/${last}`
  } catch {
    return fallbackToRecent ? "/" : "session"
  }
}

export function shouldFallbackToRecent() {
  return typeof window !== "undefined" && new URL(window.location.href).searchParams.get("server-switch") === "1"
}
