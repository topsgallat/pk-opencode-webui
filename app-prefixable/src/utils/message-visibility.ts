import type { DisplayMessage } from "../types/message"
import { extractTextContent } from "./message"

// Visibility is cached by message object reference. The message projection in
// message-reconcile keeps the same object for unchanged messages and creates a
// fresh object whenever parts/error change, so this skips re-running the
// text-extraction regexes over every historical message on each stream flush
// without needing explicit invalidation.
const cache = new WeakMap<DisplayMessage, boolean>()

export function hasVisibleContent(message: DisplayMessage): boolean {
  const cached = cache.get(message)
  if (cached !== undefined) return cached

  const visible =
    !!message.error ||
    message.role === "user" ||
    message.parts.some((p) => p.type === "tool") ||
    extractTextContent(message.parts).trim().length > 0

  cache.set(message, visible)
  return visible
}
