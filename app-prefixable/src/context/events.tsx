import { createContext, useContext, onCleanup, onMount, createSignal, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Event, SessionStatus, QuestionRequest } from "../sdk/client"
import { appendTargetParam } from "../utils/path"
import { useSDK } from "./sdk"
import { SyncContext, type SyncEvent } from "./sync"
import { useClientAuth } from "./client-auth"
import { fetchWithTimeout } from "../utils/request-timeout"

type EventHandler = (event: Event) => void
const EVENT_SEED_TIMEOUT_MS = 8_000
const EVENT_PROBE_TIMEOUT_MS = 5_000

interface EventContextValue {
  subscribe: (handler: EventHandler) => () => void
  status: Record<string, SessionStatus>
  pendingQuestions: Record<string, QuestionRequest | undefined>
  dismissQuestion: (sessionID: string, requestID: string) => void
  connected: () => boolean
  reconnecting: () => boolean
}

export const EventContext = createContext<EventContextValue>()

export function EventProvider(props: ParentProps) {
  const { client, directory, url, targetUrl } = useSDK()
  const sync = useContext(SyncContext)
  const auth = useClientAuth()
  const handlers = new Set<EventHandler>()
  const [status, setStatus] = createStore<Record<string, SessionStatus>>({})
  const [pendingQuestions, setPendingQuestions] = createStore<Record<string, QuestionRequest | undefined>>({})
  const [connected, setConnected] = createSignal(false)
  const [reconnecting, setReconnecting] = createSignal(false)

  const sseAskedQuestions = new Set<string>()
  const sseClearedRequests = new Set<string>()
  const sseSeenStatuses = new Set<string>()

  function handleRawEvent(event: Event | SyncEvent) {
    const e = event as Event
    const eventType = e.type as string
    if (!e || !e.type) return
    console.log("[Events] Received:", e.type, e.properties)

    if (eventType === "server.connected") {
      setConnected(true)
      setReconnecting(false)
    }
    if (eventType === "server.disconnected") {
      setConnected(false)
      setReconnecting(true)
    }

    if (e.type === "session.status") {
      const p = e.properties
      if (p?.sessionID && p?.status) {
        sseSeenStatuses.add(p.sessionID as string)
        setStatus(p.sessionID as string, p.status as SessionStatus)
      }
    }

    if (e.type === "session.error") {
      const p = e.properties as { sessionID?: string }
      if (p?.sessionID) setStatus(p.sessionID, { type: "idle" })
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
    const eventUrl = appendTargetParam(`${url}/event${dirParam}`, targetUrl)
    eventSource = new EventSource(eventUrl)
    console.log("[Events] Connecting to SSE:", eventUrl)

    eventSource.onopen = () => {
      console.log("[Events] Connected")
      setConnected(true)
      setReconnecting(false)
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
      setConnected(false)
      setReconnecting(true)
      eventSource?.close()
      eventSource = null

      const authProbe = fetchWithTimeout(
        appendTargetParam(`${url}/session/status${dirParam}`, targetUrl),
        {},
        EVENT_PROBE_TIMEOUT_MS,
        "Event reconnect probe",
      )
        .then((r) => {
          if (r.status === 401 || r.status === 403) {
            auth.markFailure({ scope: "events", status: r.status, message: `HTTP ${r.status}` })
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
    fetchWithTimeout(
      appendTargetParam(`${url}/question?directory=${encodeURIComponent(directory)}`, targetUrl),
      {},
      EVENT_SEED_TIMEOUT_MS,
      "Loading pending questions",
    )
      .then((r) => r.json())
      .then((res) => {
        const questions = Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : []
        for (const q of questions) {
          if (sseAskedQuestions.has(q.sessionID)) continue
          if (sseClearedRequests.has(q.id)) continue
          setPendingQuestions(q.sessionID, q)
        }
      })
      .catch((err) => console.error("[Events] Failed to load questions:", err))
    fetchWithTimeout(
      appendTargetParam(`${url}/session/status?directory=${encodeURIComponent(directory)}`, targetUrl),
      {},
      EVENT_SEED_TIMEOUT_MS,
      "Loading session statuses",
    )
      .then((r) => r.json())
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

  return <EventContext.Provider value={{ subscribe, status, pendingQuestions, dismissQuestion, connected, reconnecting }}>{props.children}</EventContext.Provider>
}

export function useEvents() {
  const ctx = useContext(EventContext)
  if (!ctx) throw new Error("useEvents must be used within EventProvider")
  return ctx
}
