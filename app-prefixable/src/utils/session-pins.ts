import { base64Encode } from "./path"
import { loadSettings, saveSetting } from "./settings-api"

export const MAX_PINNED = 10

const SETTINGS_NAMESPACE_PREFIX = "session-pins.server"
const LEGACY_STORAGE_PREFIX = "opencode.pinnedSessions."
const PINS_KEY_PREFIX = "pins:"

function pinsNamespace(serverKey: string) {
  return `${SETTINGS_NAMESPACE_PREFIX}.${base64Encode(serverKey)}`
}

function pinsKey(directory: string | undefined) {
  return `${PINS_KEY_PREFIX}${base64Encode(directory ?? "global")}`
}

function legacyPinnedSessionsKey(serverKey: string, directory: string | undefined) {
  return `${LEGACY_STORAGE_PREFIX}${serverKey}.${directory ?? "global"}`
}

export function normalizePinnedSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || !item || ids.includes(item)) continue
    ids.push(item)
    if (ids.length >= MAX_PINNED) break
  }

  return ids
}

function readLegacyPinnedSessionIds(serverKey: string, directory: string | undefined) {
  if (typeof window === "undefined") return []

  try {
    const raw = window.localStorage.getItem(legacyPinnedSessionsKey(serverKey, directory))
    if (!raw) return []
    return normalizePinnedSessionIds(JSON.parse(raw))
  } catch {
    return []
  }
}

export async function loadPinnedSessionIds(serverUrl: string, serverKey: string, directory: string | undefined): Promise<string[]> {
  const key = pinsKey(directory)

  try {
    const data = await loadSettings(serverUrl, pinsNamespace(serverKey))
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return normalizePinnedSessionIds(data[key])
    }
  } catch {
    // Fall through to legacy browser storage migration.
  }

  const legacy = readLegacyPinnedSessionIds(serverKey, directory)
  if (!legacy.length) return []

  void savePinnedSessionIds(serverUrl, serverKey, directory, legacy).catch(() => undefined)
  return legacy
}

export async function savePinnedSessionIds(serverUrl: string, serverKey: string, directory: string | undefined, ids: string[]): Promise<void> {
  await saveSetting(serverUrl, pinsNamespace(serverKey), pinsKey(directory), normalizePinnedSessionIds(ids))
}
