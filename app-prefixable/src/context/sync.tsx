import { createContext, useContext, onCleanup, batch, createSignal, type ParentProps } from "solid-js"
import { createStore, reconcile, produce } from "solid-js/store"
import type { Session, Message, Part, Provider } from "../sdk/client"
import { useBasePath } from "./base-path"
import { useSDK } from "./sdk"
import { appendTargetParam } from "../utils/path"
import { useClientAuth } from "./client-auth"
import { errorMessage, fetchWithTimeout, withTimeout } from "../utils/request-timeout"

export type SyncEvent = {
  type: string
  properties: Record<string, unknown>
}

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type ProviderData = {
  all: Provider[]
  connected: string[]
  default: Record<string, string>
}

function createSyntheticTextPart(sessionID: string, messageID: string, partID: string): Part {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text: "",
    synthetic: true,
  }
}

function createSyntheticAssistantMessage(sessionID: string, messageID: string, parts: Part[]): MessageWithParts {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      agent: "",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts,
  }
}

type SyncStore = {
  ready: boolean
  bootstrapping: boolean
  bootstrapError: string | null
  session: Session[]
  archivedSession: Session[]
  message: Record<string, MessageWithParts[]>
  part: Record<string, Part[]>
  provider: ProviderData
}

interface SyncContextValue {
  data: SyncStore
  ready: boolean
  bootstrapping: boolean
  bootstrapError: string | null
  sessions: () => Session[]
  archivedSessions: () => Session[]
  messages: (sessionID: string) => MessageWithParts[]
  parts: (messageID: string) => Part[]
  providers: () => ProviderData
  session: {
    sync: (sessionID: string) => Promise<void>
    get: (sessionID: string) => Session | undefined
  }
  refresh: () => Promise<void>
  retryBootstrap: () => Promise<void>
  registerExternalListener: (fn: (event: SyncEvent) => void) => () => void
}

export const SyncContext = createContext<SyncContextValue>()

const [globalSyncReady, setGlobalSyncReady] = createSignal(false)
export { globalSyncReady }
const SYNC_BOOTSTRAP_TIMEOUT_MS = 30_000
const SYNC_SESSION_TIMEOUT_MS = 30_000
const SYNC_PROBE_TIMEOUT_MS = 5_000

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function sortParts(parts: Part[]): Part[] {
  const withId = parts.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id))
  const withoutId = parts.filter((p) => !p?.id)
  return [...withId, ...withoutId]
}

function partStatusRank(part: Part) {
  const state = (part as { state?: { status?: string } }).state
  if (!state?.status) return 0
  if (state.status === "completed" || state.status === "error") return 2
  if (state.status === "running" || state.status === "pending") return 1
  return 0
}

function messageStatusRank(message: MessageWithParts) {
  return message.parts.reduce((rank, part) => Math.max(rank, partStatusRank(part)), 0)
}

function binarySearch<T>(arr: T[], id: string, getId: (item: T) => string): { found: boolean; index: number } {
  let low = 0
  let high = arr.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const midId = getId(arr[mid])
    if (midId === id) return { found: true, index: mid }
    if (midId < id) low = mid + 1
    else high = mid - 1
  }
  return { found: false, index: low }
}

export function SyncProvider(props: ParentProps) {
  const { prefix } = useBasePath()
  const { client, directory, targetUrl } = useSDK()
  const auth = useClientAuth()

  const [store, setStore] = createStore<SyncStore>({
    ready: false,
    bootstrapping: true,
    bootstrapError: null,
    session: [],
    archivedSession: [],
    message: {},
    part: {},
    provider: { all: [], connected: [], default: {} },
  })

  const inflight = new Map<string, Promise<void>>()
  const externalListeners = new Set<(event: SyncEvent) => void>()
  // Queue for frame-batching incoming part delta events to avoid many
  // synchronous setStore calls which block the main thread during heavy streams.
  // Keyed by `${messageID}:${partID}` and accumulates per-field string deltas
  // preserving arrival order by a monotonic counter.
  const deltaQueue = new Map<
    string,
    { sessionID: string; messageID: string; partID: string; fields: Record<string, string>; order: number }
  >()
  let flushQueued = false
  let flushTimer: number | ReturnType<typeof setTimeout> | null = null
  let flushTimerMode: "raf" | "timeout" | null = null
  let seqCounter = 0

  function scheduleFlush() {
    if (flushQueued) return
    flushQueued = true
    const flush = () => {
      flushTimer = null
      flushTimerMode = null
      flushQueued = false
      flushDeltaQueue()
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && document.visibilityState === "visible") {
      flushTimerMode = "raf"
      flushTimer = window.requestAnimationFrame(flush)
      return
    }

    flushTimerMode = "timeout"
    flushTimer = setTimeout(flush, 16)
  }

  function rescheduleFlushForHiddenTab() {
    if (!flushQueued || flushTimerMode !== "raf") return
    if (typeof document === "undefined" || document.visibilityState === "visible") return
    if (typeof window === "undefined" || typeof flushTimer !== "number") return

    window.cancelAnimationFrame(flushTimer)
    flushTimerMode = "timeout"
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushTimerMode = null
      flushQueued = false
      flushDeltaQueue()
    }, 16)
  }

  function flushDeltaQueue() {
    if (deltaQueue.size === 0) return
    // Capture queued entries and clear the queue immediately so new events
    // can be collected while we apply the batched update.
    const entries = Array.from(deltaQueue.values()).sort((a, b) => a.order - b.order)
    deltaQueue.clear()

    // Apply updates in a single SolidJS batch to minimise reactivity churn.
    batch(() => {
      const byMessage = new Map<string, typeof entries>()
      for (const e of entries) {
        const arr = byMessage.get(e.messageID) ?? []
        arr.push(e)
        byMessage.set(e.messageID, arr)
      }

      const updatedPartsByMessage = new Map<string, Part[]>()

      for (const [messageID, list] of byMessage.entries()) {
        const existingParts = store.part[messageID] ?? []
        const next = [...existingParts]
        let changed = false

        for (const item of list) {
          const partIndex = next.findIndex((part) => part.id === item.partID)
          if (partIndex === -1) {
            next.push(createSyntheticTextPart(item.sessionID, item.messageID, item.partID))
            changed = true
          }

          const index = next.findIndex((part) => part.id === item.partID)
          if (index === -1) continue

          const current = next[index]
          const updated: Part = { ...current }
          const currentRecord = updated as Record<string, unknown>
          for (const [field, value] of Object.entries(item.fields)) {
            const currentValue = typeof currentRecord[field] === "string" ? currentRecord[field] : ""
            currentRecord[field] = currentValue + value
          }

          next[index] = updated
          changed = true
        }

        if (changed) {
          const sorted = sortParts(next)
          updatedPartsByMessage.set(messageID, sorted)
          setStore("part", messageID, sorted)
        }
      }

      const updatesBySession = new Map<string, Array<{ messageID: string; parts: Part[] }>>()
      const sessionByMessageID = new Map(entries.map((entry) => [entry.messageID, entry.sessionID]))
      for (const [messageID, parts] of updatedPartsByMessage.entries()) {
        const sessionID = sessionByMessageID.get(messageID)
        if (!sessionID) continue
        const next = updatesBySession.get(sessionID) ?? []
        next.push({ messageID, parts })
        updatesBySession.set(sessionID, next)
      }

      for (const [sessionID, updates] of updatesBySession.entries()) {
        setStore("message", sessionID, (msgs: MessageWithParts[] = []) => {
          const nextMsgs = [...msgs]

          for (const update of updates) {
            const match = binarySearch(nextMsgs, update.messageID, (message) => message.info.id)
            if (!match.found) {
              nextMsgs.splice(match.index, 0, createSyntheticAssistantMessage(sessionID, update.messageID, update.parts))
              continue
            }

            nextMsgs[match.index] = { ...nextMsgs[match.index], parts: update.parts }
          }

          return nextMsgs
        })
      }
    })
  }

  // Connect to SSE endpoint
  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }

    const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : ""
    const eventUrl = appendTargetParam(prefix(`/event${dirParam}`), targetUrl)
    eventSource = new EventSource(eventUrl)
    console.log("[Sync] Connecting to SSE:", eventUrl)

    eventSource.onopen = () => {
      if (!store.ready) bootstrap()
    }

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const event = (data?.payload ?? data) as SyncEvent
        if (!event || !event.type) return
        handleEvent(event)
      } catch (err) {
        console.error("[Sync] Parse error:", err)
      }
    }

    eventSource.onerror = () => {
      console.error("[Sync] Connection error, reconnecting...")
      eventSource?.close()
      eventSource = null

      const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : ""
      const authProbe = fetchWithTimeout(
        appendTargetParam(prefix(`/session/status${dirParam}`), targetUrl),
        {},
        SYNC_PROBE_TIMEOUT_MS,
        "Sync reconnect probe",
      )
        .then((r) => {
          if (r.status === 401 || r.status === 403) {
            auth.markFailure({ scope: "sync", status: r.status, message: `HTTP ${r.status}` })
            return false
          }
          return true
        })
        .catch(() => true)

      if (!reconnectTimer && auth.canReconnect()) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          authProbe.then((ok) => {
            if (!ok) return
            if (!auth.canReconnect()) return
            connect()
          })
        }, 3000)
      }
    }
  }

  function handleEvent(event: SyncEvent) {
    const props = event.properties

    // Session events
    if (event.type === "session.created") {
      const session = props as unknown as Session
      if (!session?.id) return
      const target = session.time?.archived ? "archivedSession" : "session"
      setStore(
        target,
        produce((draft: Session[]) => {
          const match = binarySearch(draft, session.id, (s) => s.id)
          if (!match.found) draft.splice(match.index, 0, session)
        }),
      )
    }

    if (event.type === "session.updated") {
      const session = props as unknown as Session
      if (!session?.id) return
      const wasArchived = binarySearch(store.archivedSession, session.id, (s) => s.id).found
      const isArchived = !!session.time?.archived

      // If archive status changed, move between lists
      if (wasArchived && !isArchived) {
        // Restored: remove from archived, add to active
        setStore(
          "archivedSession",
          produce((draft: Session[]) => {
            const match = binarySearch(draft, session.id, (s) => s.id)
            if (match.found) draft.splice(match.index, 1)
          }),
        )
        setStore(
          "session",
          produce((draft: Session[]) => {
            const match = binarySearch(draft, session.id, (s) => s.id)
            if (!match.found) draft.splice(match.index, 0, session)
          }),
        )
      } else if (!wasArchived && isArchived) {
        // Archived: remove from active, add to archived
        setStore(
          "session",
          produce((draft: Session[]) => {
            const match = binarySearch(draft, session.id, (s) => s.id)
            if (match.found) draft.splice(match.index, 1)
          }),
        )
        setStore(
          "archivedSession",
          produce((draft: Session[]) => {
            const match = binarySearch(draft, session.id, (s) => s.id)
            if (!match.found) draft.splice(match.index, 0, session)
          }),
        )
      } else {
        // No change in archive status, just update in place
        const target = isArchived ? "archivedSession" : "session"
        setStore(
          target,
          produce((draft: Session[]) => {
            const match = binarySearch(draft, session.id, (s) => s.id)
            if (match.found) draft[match.index] = session
          }),
        )
      }
    }

    if (event.type === "session.deleted") {
      const session = props as unknown as Session
      if (!session?.id) return
      // Remove from both lists
      setStore(
        "session",
        produce((draft: Session[]) => {
          const match = binarySearch(draft, session.id, (s) => s.id)
          if (match.found) draft.splice(match.index, 1)
        }),
      )
      setStore(
        "archivedSession",
        produce((draft: Session[]) => {
          const match = binarySearch(draft, session.id, (s) => s.id)
          if (match.found) draft.splice(match.index, 1)
        }),
      )
      setStore("message", session.id, reconcile([]))
    }

    // Message part events - the main real-time update mechanism
    if (event.type === "message.part.updated") {
      const part = props.part as Part
      if (!part?.sessionID || !part?.messageID) return

      // Evict any queued deltas for this part — the updated event carries
      // authoritative full text, so any accumulated deltas are stale/redundant
      // and must not be appended on top of the correct value.
      deltaQueue.delete(`${part.messageID}:${part.id}`)

      // Update or insert the part
      setStore("part", part.messageID, (existing: Part[] | undefined) => {
        if (!existing) return sortParts([part])
        const idx = existing.findIndex((p) => p.id === part.id)
        if (idx === -1) return sortParts([...existing, part])
        return existing.map((p, i) => (i === idx ? part : p))
      })

      // Update parts in existing messages only - don't synthesize messages from parts
      setStore("message", part.sessionID, (msgs: MessageWithParts[]) => {
        // Find existing message
        const msgIdx = (msgs || []).findIndex((m) => m.info.id === part.messageID)

        if (msgIdx === -1) {
          // If message doesn't exist yet, synthesize a placeholder assistant message
          const synthesized = createSyntheticAssistantMessage(part.sessionID, part.messageID, [part])
          return [...(msgs || []), synthesized].sort((a, b) => cmp(a.info.id, b.info.id))
        }

        // Update existing message parts
        return msgs.map((m, i) => {
          if (i !== msgIdx) return m
          const partIdx = m.parts.findIndex((p) => p.id === part.id)
          const newParts = partIdx === -1 ? sortParts([...m.parts, part]) : m.parts.map((p, pi) => (pi === partIdx ? part : p))
          return { ...m, parts: newParts }
        })
      })
    }

    if (event.type === "message.part.delta") {
      const { sessionID, messageID, partID, field, delta } = props as {
        sessionID: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      if (!sessionID || !messageID || !partID) return

      // Frame-batch deltas: accumulate per-part per-field deltas in an
      // in-memory queue and schedule a single flush per animation frame.
      const key = `${messageID}:${partID}`
      const existing = deltaQueue.get(key)
      if (existing) {
        // Preserve ordering by appending to the existing field value
        existing.fields[field] = (existing.fields[field] ?? "") + delta
      } else {
        deltaQueue.set(key, {
          sessionID,
          messageID,
          partID,
          fields: { [field]: delta },
          order: seqCounter++,
        })
      }

      scheduleFlush()
    }

    if (event.type === "message.part.removed") {
      const { sessionID, messageID, partID } = props as {
        sessionID: string
        messageID: string
        partID: string
      }
      if (!sessionID || !messageID || !partID) return

      deltaQueue.delete(`${messageID}:${partID}`)

      setStore("part", messageID, (existing: Part[] | undefined) => {
        if (!existing) return [];
        return existing.filter((p) => p.id !== partID)
      })

      setStore("message", sessionID, (msgs: MessageWithParts[]) => {
        if (!msgs) return msgs
        return msgs.map((m) => {
          if (m.info.id !== messageID) return m
          return { ...m, parts: m.parts.filter((p) => p.id !== partID) }
        })
      })
    }

    // Message created event
    if (event.type === "message.created") {
      const msg = props as unknown as MessageWithParts
      if (!msg?.info?.sessionID) return

      setStore("message", msg.info.sessionID, (existing: MessageWithParts[]) => {
        if (!existing || existing.length === 0) return [msg]
        const match = binarySearch(existing, msg.info.id, (m) => m.info.id)
        if (match.found) {
          // Update info on the existing synthesized placeholder with the real message info,
          // but preserve existing parts (which may have more recent streaming content)
          const next = [...existing]
          next[match.index] = { ...existing[match.index], info: msg.info }
          return next
        }
        const next = [...existing]
        next.splice(match.index, 0, msg)
        return next
      })

      if (msg.parts) {
        for (const p of msg.parts) deltaQueue.delete(`${msg.info.id}:${p.id}`)
        setStore("part", msg.info.id, sortParts(msg.parts))
      }
    }

    // Message updated event
    if (event.type === "message.updated") {
      const msgProps = props as { info?: Message; parts?: Part[] }
      const info = msgProps.info
      const parts = msgProps.parts
      if (!info?.sessionID) return

      setStore("message", info.sessionID, (existing: MessageWithParts[]) => {
        if (!existing || existing.length === 0) return existing
        return existing.map((m) => {
          if (m.info.id !== info.id) return m
          // Merge info and optionally update parts if provided
          const updatedParts = parts ? sortParts(parts) : m.parts
          return { info, parts: updatedParts }
        })
      })

      // Also update parts store if parts were provided
      if (parts && info.id) {
        for (const p of parts) deltaQueue.delete(`${info.id}:${p.id}`)
        setStore("part", info.id, sortParts(parts))
      }
    }

    // Provider events
    if (event.type === "provider.updated") {
      const data = props as unknown as ProviderData
      if (data) {
        setStore("provider", data)
      }
    }

    for (const fn of externalListeners) fn(event)
  }

  async function bootstrap() {
    setStore("bootstrapping", true)
    setStore("bootstrapError", null)

    try {
      const [sessionsResult, providersResult] = await Promise.allSettled([
        withTimeout(() => client.session.list(), SYNC_BOOTSTRAP_TIMEOUT_MS, "Loading sessions"),
        withTimeout(() => client.provider.list(), SYNC_BOOTSTRAP_TIMEOUT_MS, "Loading providers"),
      ])

      if (sessionsResult.status === "rejected") throw sessionsResult.reason

      const sessionsRes = sessionsResult.value
      const providersRes = providersResult.status === "fulfilled" ? providersResult.value : undefined

      batch(() => {
        const rawSessions = sessionsRes.data ?? []
        const valid = rawSessions.filter((s: Session | undefined): s is Session => !!s?.id)
        const sessions = valid.filter((s) => !s.time?.archived).sort((a, b) => cmp(a.id, b.id))
        const archived = valid.filter((s) => !!s.time?.archived).sort((a, b) => cmp(a.id, b.id))
        setStore("session", reconcile(sessions, { key: "id" }))
        setStore("archivedSession", reconcile(archived, { key: "id" }))

        if (providersRes?.data) {
          setStore("provider", providersRes.data as unknown as ProviderData)
        }

        setStore("ready", true)
        setStore("bootstrapping", false)
        setStore(
          "bootstrapError",
          providersResult.status === "rejected"
            ? errorMessage(providersResult.reason, "Loading providers failed")
            : null,
        )
        setGlobalSyncReady(true)
      })

      console.log("[Sync] Bootstrap complete, sessions:", store.session.length)
    } catch (err) {
      const result = auth.classifyAuthFailure(err)
      if (result.auth) auth.markFailure({ scope: "sync", status: result.status, message: result.message })
      console.error("[Sync] Bootstrap failed:", err)
      setStore("bootstrapping", false)
      setStore("bootstrapError", errorMessage(err, "Loading sessions failed"))
      setStore("ready", false)
      setGlobalSyncReady(false)
      throw err
    }
  }

  async function syncSession(sessionID: string) {
    const pending = inflight.get(sessionID)
    if (pending) return pending

    const promise = (async () => {
      try {
        const [sessionRes, messagesRes] = await withTimeout(
          () => Promise.all([
            client.session.get({ sessionID }),
            client.session.messages({ sessionID }),
          ]),
          SYNC_SESSION_TIMEOUT_MS,
          `Loading session ${sessionID}`,
        )

        batch(() => {
          // Update session in appropriate list and remove from other list
          if (sessionRes.data) {
            const session = sessionRes.data
            const isArchived = !!session.time?.archived
            const target = isArchived ? "archivedSession" : "session"
            const other = isArchived ? "session" : "archivedSession"

            // Remove from the other list to ensure session exists in exactly one list
            setStore(
              other,
              produce((draft: Session[]) => {
                const match = binarySearch(draft, sessionID, (s) => s.id)
                if (match.found) draft.splice(match.index, 1)
              }),
            )

            // Add/update in target list
            setStore(
              target,
              produce((draft: Session[]) => {
                const match = binarySearch(draft, sessionID, (s) => s.id)
                if (match.found) {
                  draft[match.index] = session
                } else {
                  draft.splice(match.index, 0, session)
                }
              }),
            )
          }

          // Merge messages - preserve newer SSE updates
          if (messagesRes.data) {
            const synced = (messagesRes.data as MessageWithParts[])
              .filter((m): m is MessageWithParts => !!m?.info?.id)
              .sort((a, b) => cmp(a.info.id, b.info.id))

            setStore("message", sessionID, (existing: MessageWithParts[]) => {
              if (!existing || existing.length === 0) return synced

              const merged = synced.map((s) => {
                const e = existing.find((m) => m.info.id === s.info.id)
                if (!e) return s
                if (s.info.role === "assistant" && s.info.time.completed) return s

                const syncedRank = messageStatusRank(s)
                const existingRank = messageStatusRank(e)
                if (syncedRank !== existingRank) return syncedRank > existingRank ? s : e

                return e.parts.length > s.parts.length ? e : s
              })

              // Add any messages from existing that aren't in synced (new SSE messages)
              for (const e of existing) {
                if (!merged.find((m) => m.info.id === e.info.id)) {
                  merged.push(e)
                }
              }

              return merged.sort((a, b) => cmp(a.info.id, b.info.id))
            })

            // Update parts
            const msgs = store.message[sessionID] ?? []
            for (const msg of msgs) {
              if (msg.parts) {
                setStore("part", msg.info.id, sortParts(msg.parts))
              }
            }
          }
        })
      } catch (err) {
        console.error("[Sync] Failed to sync session:", sessionID, err)
        throw err
      }
    })()

    inflight.set(sessionID, promise)
    promise.finally(() => inflight.delete(sessionID))
    return promise
  }

  async function refresh() {
    await bootstrap()
  }

  // Start connection
  connect()

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", rescheduleFlushForHiddenTab)
  }

  onCleanup(() => {
    setGlobalSyncReady(false)
    eventSource?.close()
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", rescheduleFlushForHiddenTab)
    }
    if (flushTimerMode === "raf" && typeof flushTimer === "number" && typeof window !== "undefined") {
      window.cancelAnimationFrame(flushTimer)
    }
    if (flushTimerMode === "timeout" && flushTimer != null) clearTimeout(flushTimer)
  })

  const value: SyncContextValue = {
    get data() {
      return store
    },
    get ready() {
      return store.ready
    },
    get bootstrapping() {
      return store.bootstrapping
    },
    get bootstrapError() {
      return store.bootstrapError
    },
    sessions: () => store.session,
    archivedSessions: () => store.archivedSession,
    messages: (sessionID: string) => store.message[sessionID] ?? [],
    parts: (messageID: string) => store.part[messageID] ?? [],
    providers: () => store.provider,
    session: {
      sync: syncSession,
      get: (sessionID: string) => {
        // Search in both active and archived sessions
        const match = binarySearch(store.session, sessionID, (s: Session) => s.id)
        if (match.found) return store.session[match.index]
        const archived = binarySearch(store.archivedSession, sessionID, (s: Session) => s.id)
        return archived.found ? store.archivedSession[archived.index] : undefined
      },
    },
    refresh,
    retryBootstrap: bootstrap,
    registerExternalListener(fn) {
      externalListeners.add(fn)
      return () => externalListeners.delete(fn)
    },
  }

  return <SyncContext.Provider value={value}>{props.children}</SyncContext.Provider>
}

export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync must be used within SyncProvider")
  return ctx
}
