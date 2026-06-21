/** Shared helpers for the per-session notification toggle stored in localStorage */

import { dispatchStorageEvent } from "./storage"

export const NOTIFY_STORAGE_KEY = "opencode.sessionNotify";

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
export function readNotifyMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NOTIFY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    if (!parsed || typeof parsed !== "object") {
      window.localStorage.removeItem(NOTIFY_STORAGE_KEY);
      return {};
    }
    return parsed;
  } catch {
    try { window.localStorage.removeItem(NOTIFY_STORAGE_KEY); } catch {}
    return {};
  }
}

/** Write the per-session notification toggle map to localStorage and dispatch
 *  a synthetic storage event so same-tab listeners update immediately. */
export function writeNotifyMap(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  const value = JSON.stringify(map);
  try {
    window.localStorage.setItem(NOTIFY_STORAGE_KEY, value);
  } catch {
    return; // If write failed, no point notifying listeners
  }
  dispatchStorageEvent(NOTIFY_STORAGE_KEY, value);
}

/** Remove a session's entry from the notification toggle map */
export function cleanupNotifyState(id: string) {
  const map = readNotifyMap();
  if (!(id in map)) return;
  delete map[id];
  writeNotifyMap(map);
}
