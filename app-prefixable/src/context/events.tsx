import { createContext, useContext, onCleanup, onMount, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Event, SessionStatus, QuestionRequest } from "../sdk/client"
import { useBasePath } from "./base-path"
import { useSDK } from "./sdk"
import { SyncContext, type SyncEvent } from "./sync"

type EventHandler = (event: Event) => void

interface EventContextValue {
  subscribe: (handler: EventHandler) => () => void
  status: Record<string, SessionStatus>
  pendingQuestions: Record<string, QuestionRequest | undefined>
  dismissQuestion: (sessionID: string, requestID: string) => void
}

export const EventContext = createContext<EventContextValue>()

export function EventProvider(props: ParentProps) {
  const { prefix } = useBasePath()
  const { client, directory } = useSDK()
  const sync = useContext(SyncContext)
  const handlers = new Set<EventHandler>()
  const [status, setStatus] = createStore<Record<string, SessionStatus>>({})
  const [pendingQuestions, setPendingQuestions] = createStore<Record<string, QuestionRequest | undefined>>({})

  const sseAskedQuestions = new Set<string>()
  const sseClearedRequests = new Set<string>()
  const sseSeenStatuses = new Set<string>()

  function handleRawEvent(event: Event | SyncEvent) {
    const e = event as Event
    if (!e || !e.type) return
    console.log("[Events] Received:", e.type, e.properties)

    if (e.type === "session.status") {
      const p = e.properties
      if (p?.sessionID && p?.status) {
        sseSeenStatuses.add(p.sessionID as string)
        setStatus(p.sessionID as string, p.status as SessionStatus)
      }
    }

    if (e.type === "question.asked") {
      const q = e.properties as QuestionRequest
      if (q?.sessionID) {
        sseAskedQuestions.add(q.sessionID)
        setPendingQuestions(q.sessionID, q)
      }
    }
    if (e.type === "question.replied" || e.type === "question.rejected") {
      const q = e.properties as { sessionID?: string; requestID?: string }
      if (q?.sessionID) {
        if (q.requestID) sseClearedRequests.add(q.requestID)
        setPendingQuestions(produce((map) => {
          if (!q.requestID || map[q.sessionID!]?.id === q.requestID) delete map[q.sessionID!]
        }))
      }
    }

    for (const handler of handlers) {
      handler(e)
    }
  }

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
    console.log("[Events] Connecting to SSE:", eventUrl)

    eventSource.onopen = () => {
      console.log("[Events] Connected")
    }

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const event = (data?.payload ?? data) as Event
        if (!event || !event.type) {
          console.warn("[Events] Received event without type:", data)
          return
        }
        handleRawEvent(event)
      } catch (err) {
        console.error("[Events] Parse error:", err)
      }
    }

    eventSource.onerror = (e) => {
      console.error("[Events] Connection error, reconnecting...", e)
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

  onMount(() => {
    if (sync) {
      const unsub = sync.registerExternalListener(handleRawEvent)
      onCleanup(unsub)
    } else {
      connect()
      onCleanup(() => {
        eventSource?.close()
        if (reconnectTimer) clearTimeout(reconnectTimer)
      })
    }

    if (!directory) return
    client.question.list({ directory })
      .then((res) => {
        const questions = Array.isArray(res.data) ? res.data : []
        for (const q of questions) {
          if (sseAskedQuestions.has(q.sessionID)) continue
          if (sseClearedRequests.has(q.id)) continue
          setPendingQuestions(q.sessionID, q)
        }
      })
      .catch((err) => console.error("[Events] Failed to load questions:", err))
    client.session.status({ directory })
      .then((res) => {
        const statuses = (res.data ?? {}) as Record<string, SessionStatus>
        for (const [sessionID, s] of Object.entries(statuses)) {
          if (!sseSeenStatuses.has(sessionID)) setStatus(sessionID, s)
        }
      })
      .catch((err) => console.error("[Events] Failed to load statuses:", err))
  })

  function subscribe(handler: EventHandler) {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  function dismissQuestion(sessionID: string, requestID: string) {
    setPendingQuestions(produce((map) => {
      if (map[sessionID]?.id === requestID) delete map[sessionID]
    }))
  }

  return <EventContext.Provider value={{ subscribe, status, pendingQuestions, dismissQuestion }}>{props.children}</EventContext.Provider>
}

export function useEvents() {
  const ctx = useContext(EventContext)
  if (!ctx) throw new Error("useEvents must be used within EventProvider")
  return ctx
}
