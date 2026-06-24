/** Shared helpers for browser notifications stored in localStorage */

import { dispatchStorageEvent } from "./storage"

export const NOTIFY_STORAGE_KEY = "opencode.browserNotifyEnabled";
const LEGACY_NOTIFY_STORAGE_KEY = "opencode.sessionNotify";
const GLOBAL_NOTIFY_KEY = "global";

export interface BrowserNotifySettings {
  global: boolean
  sessions: Record<string, boolean>
}

export type BrowserNotificationStatus = "unsupported" | NotificationPermission;

export interface BrowserNotificationPayload {
  title: string
  body: string
  tag: string
  icon?: string
  requireInteraction?: boolean
  onClick?: () => void
}

export function browserNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window
}

export function browserNotificationStatus(): BrowserNotificationStatus {
  if (!browserNotificationSupported()) return "unsupported"
  return Notification.permission
}

export function fireBrowserNotification(payload: BrowserNotificationPayload) {
  if (!browserNotificationSupported()) return false
  if (Notification.permission !== "granted") return false

  const n = new Notification(payload.title, {
    body: payload.body,
    requireInteraction: payload.requireInteraction ?? true,
    tag: payload.tag,
    icon: payload.icon,
  })

  n.onclick = () => {
    payload.onClick?.()
    n.close()
  }

  return true
}

/** Read the per-session notification toggle map from localStorage */
function normalizeSettings(value: unknown): BrowserNotifySettings | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const global = typeof raw.global === "boolean" ? raw.global : false
  const sessions: Record<string, boolean> = {}

  const nested = raw.sessions
  if (nested && typeof nested === "object") {
    for (const [id, enabled] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof enabled === "boolean") sessions[id] = enabled
    }
    return { global, sessions }
  }

  for (const [id, enabled] of Object.entries(raw)) {
    if (id === GLOBAL_NOTIFY_KEY) continue
    if (typeof enabled === "boolean") sessions[id] = enabled
  }

  return { global, sessions }
}

export function readNotifyMap(): BrowserNotifySettings {
  if (typeof window === "undefined") return { global: false, sessions: {} };
  try {
    const raw = window.localStorage.getItem(NOTIFY_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeSettings(JSON.parse(raw));
      if (!parsed) {
        window.localStorage.removeItem(NOTIFY_STORAGE_KEY);
        return { global: false, sessions: {} };
      }
      return parsed;
    }

    const legacy = window.localStorage.getItem(LEGACY_NOTIFY_STORAGE_KEY);
    if (!legacy) return { global: false, sessions: {} };

    const parsed = normalizeSettings(JSON.parse(legacy));
    if (!parsed) {
      window.localStorage.removeItem(LEGACY_NOTIFY_STORAGE_KEY);
      return { global: false, sessions: {} };
    }

    if (Object.values(parsed.sessions).some(Boolean)) return { global: true, sessions: {} };
    return { global: parsed.global, sessions: parsed.sessions };
  } catch {
    try { window.localStorage.removeItem(NOTIFY_STORAGE_KEY); } catch {}
    return { global: false, sessions: {} };
  }
}

export function readNotifySettings() {
  return readNotifyMap()
}

/** Write the per-session notification toggle map to localStorage and dispatch
 *  a synthetic storage event so same-tab listeners update immediately. */
export function writeNotifyMap(settings: BrowserNotifySettings) {
  if (typeof window === "undefined") return;
  const value = JSON.stringify({ global: settings.global === true, sessions: settings.sessions ?? {} });
  try {
    window.localStorage.setItem(NOTIFY_STORAGE_KEY, value);
    window.localStorage.removeItem(LEGACY_NOTIFY_STORAGE_KEY);
  } catch {
    return; // If write failed, no point notifying listeners
  }
  dispatchStorageEvent(NOTIFY_STORAGE_KEY, value);
}

export function isSessionNotifyEnabled(id: string) {
  const settings = readNotifyMap()
  return settings.sessions[id] ?? settings.global
}

export function getSessionNotifyOverride(id: string) {
  const settings = readNotifyMap()
  return settings.sessions[id]
}

export function setGlobalNotifyEnabled(enabled: boolean) {
  const settings = readNotifyMap()
  writeNotifyMap({ ...settings, global: enabled })
}

export function setSessionNotifyOverride(id: string, enabled: boolean) {
  const settings = readNotifyMap()
  writeNotifyMap({
    ...settings,
    sessions: { ...settings.sessions, [id]: enabled },
  })
}

/** Remove a session's entry from the notification toggle map */
export function cleanupNotifyState(id: string) {
  const settings = readNotifyMap();
  if (!(id in settings.sessions)) return;
  const sessions = { ...settings.sessions };
  delete sessions[id];
  writeNotifyMap({ ...settings, sessions });
}
