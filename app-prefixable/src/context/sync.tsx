import { createContext, useContext, onCleanup, batch, createSignal, type ParentProps } from "solid-js"
import { createStore, reconcile, produce } from "solid-js/store"
import type { Session, Message, Part, Provider } from "../sdk/client"
import { useBasePath } from "./base-path"
import { useSDK } from "./sdk"

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

type SyncStore = {
  ready: boolean
  session: Session[]
  archivedSession: Session[]
  message: Record<string, MessageWithParts[]>
  part: Record<string, Part[]>
  provider: ProviderData
}

interface SyncContextValue {
  data: SyncStore
  ready: boolean
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
  registerExternalListener: (fn: (event: SyncEvent) => void) => () => void
}

export const SyncContext = createContext<SyncContextValue>()

const [globalSyncReady, setGlobalSyncReady] = createSignal(false)
export { globalSyncReady }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function sortParts(parts: Part[]): Part[] {
  const withId = parts.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id))
  const withoutId = parts.filter((p) => !p?.id)
  return [...withId, ...withoutId]
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
  const { client, directory } = useSDK()

  const [store, setStore] = createStore<SyncStore>({
    ready: false,
    session: [],
    archivedSession: [],
    message: {},
    part: {},
    provider: { all: [], connected: [], default: {} },
  })

  const inflight = new Map<string, Promise<void>>()
  const externalListeners = new Set<(event: SyncEvent) => void>()
  // Queue for micro-batching incoming part delta events to avoid many
  // synchronous setStore calls which block the main thread during heavy streams.
  // Keyed by `${messageID}:${partID}` and accumulates per-field string deltas
  // preserving arrival order by a monotonic counter.
  const deltaQueue = new Map<
    string,
    { sessionID: string; messageID: string; partID: string; fields: Record<string, string>; order: number }
  >()
  let rafHandle: number | null = null
  let seqCounter = 0

  function scheduleFlush() {
    // Prefer requestAnimationFrame to batch updates into a single paint tick.
    if (rafHandle != null) return
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null
      flushDeltaQueue()
    })
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
        if (existingParts.length === 0) continue
        let changed = false
        const next = existingParts.map((p) => {
          const matched = list.find((le) => le.partID === p.id)
          if (!matched) return p
          const updated: any = { ...p }
          for (const [f, v] of Object.entries(matched.fields)) {
            const cur = (updated as any)[f] ?? ""
            const result = cur + v
            console.log(`[Sync:flush] id=${p.id} field=${f} cur=${JSON.stringify(cur.slice(0,80))} delta=${JSON.stringify(v.slice(0,80))} result=${JSON.stringify(result.slice(0,80))}`)
            ;(updated as any)[f] = result
          }
          changed = true
          return updated as Part
        })
        if (changed) {
          updatedPartsByMessage.set(messageID, next)
          setStore("part", messageID, next)
        }
      }

      const affectedSessions = new Set(entries.map((e) => e.sessionID))
      for (const sessionID of affectedSessions) {
        const msgs = store.message[sessionID] ?? []
        if (!msgs || msgs.length === 0) continue
        let changed = false
        const nextMsgs = msgs.map((m) => {
          const updated = updatedPartsByMessage.get(m.info.id)
          if (!updated) return m
          changed = true
          return { ...m, parts: updated }
        })
        if (changed) setStore("message", sessionID, nextMsgs)
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
    const eventUrl = prefix(`/event${dirParam}`)
    eventSource = new EventSource(eventUrl)
    console.log("[Sync] Connecting to SSE:", eventUrl)

    eventSource.onopen = () => {
      console.log("[Sync] Connected, bootstrapping...")
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

      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, 3000)
      }
    }
  }

  function handleEvent(event: SyncEvent) {
    console.log("[Sync] Event:", event.type)
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

      const queuedDelta = deltaQueue.get(`${part.messageID}:${part.id}`)
      console.log(`[Sync:part.updated] id=${part.id} text=${JSON.stringify((part as any).text?.slice(0, 80))} queuedDelta=${JSON.stringify(queuedDelta?.fields)}`)

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
          const synthesized: MessageWithParts = {
            info: {
              id: part.messageID,
              sessionID: part.sessionID,
              role: "assistant", // Parts updated from SSE are almost always assistant messages
              time: { created: Date.now() },
            } as any,
            parts: [part]
          };
          return [...(msgs || []), synthesized].sort((a, b) => cmp(a.info.id, b.info.id));
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

      const currentStoreText = (store.part[messageID]?.find(p => p.id === partID) as any)?.[field] ?? ""
      console.log(`[Sync:part.delta] id=${partID} field=${field} delta=${JSON.stringify(delta.slice(0,80))} storeText=${JSON.stringify(currentStoreText.slice(0,80))}`)

      // Micro-batch deltas: accumulate per-part per-field deltas in an
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
    try {
      const [sessionsRes, providersRes] = await Promise.all([client.session.list(), client.provider.list()])

      batch(() => {
        const rawSessions = sessionsRes.data ?? []
        const valid = rawSessions.filter((s: Session | undefined): s is Session => !!s?.id)
        const sessions = valid.filter((s) => !s.time?.archived).sort((a, b) => cmp(a.id, b.id))
        const archived = valid.filter((s) => !!s.time?.archived).sort((a, b) => cmp(a.id, b.id))
        setStore("session", reconcile(sessions, { key: "id" }))
        setStore("archivedSession", reconcile(archived, { key: "id" }))

        if (providersRes.data) {
          setStore("provider", providersRes.data as unknown as ProviderData)
        }

        setStore("ready", true)
        setGlobalSyncReady(true)
      })

      console.log("[Sync] Bootstrap complete, sessions:", store.session.length)
    } catch (err) {
      console.error("[Sync] Bootstrap failed:", err)
    }
  }

  async function syncSession(sessionID: string) {
    const pending = inflight.get(sessionID)
    if (pending) return pending

    const promise = (async () => {
      try {
        const [sessionRes, messagesRes] = await Promise.all([
          client.session.get({ sessionID }),
          client.session.messages({ sessionID }),
        ])

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
                return e.parts.length >= s.parts.length ? e : s
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

  onCleanup(() => {
    setGlobalSyncReady(false)
    eventSource?.close()
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })

  const value: SyncContextValue = {
    get data() {
      return store
    },
    get ready() {
      return store.ready
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
