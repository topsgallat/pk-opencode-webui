import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup, untrack } from "solid-js"
import { Spinner } from "./ui/spinner"
import { MessageTurn } from "./message-turn"
// Note: Markdown and MessageParts are used in the FlatMessageList component below
import { Markdown } from "./markdown"
import { MessageParts } from "./tool-part"
import { ChevronUp, RefreshCw, Clock, Brain, Loader2, ArrowDown } from "lucide-solid"
import { errorText } from "../types/message"
import type { DisplayMessage, QueueTurnState, Turn } from "../types/message"
import { extractTextContent } from "../utils/message"
import type { SessionStatus } from "../sdk/client"
import { reconcileTurns } from "../utils/message-reconcile"

// Number of turns to render initially and on each "load more"
const TURNS_PER_BATCH = 10
const INITIAL_TURNS = 5

function hasVisibleContent(message: DisplayMessage): boolean {
  if (message.error) return true
  if (message.role === "user") return true
  if (message.parts.some((p) => p.type === "tool")) return true
  return extractTextContent(message.parts).trim().length > 0
}

function createAutoScroll(options: { bottomThreshold?: number } = {}) {
  let scroll: HTMLElement | undefined
  let content: HTMLElement | undefined
  let scrollResizeObserver: ResizeObserver | undefined
  let resizeObserver: ResizeObserver | undefined
  const threshold = options.bottomThreshold ?? 24

  const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop
  const [showFab, setShowFab] = createSignal(false)

  const update = () => {
    const el = scroll
    if (!el) return
    setShowFab(distanceFromBottom(el) > threshold)
  }

  const observe = () => {
    if (!content || typeof ResizeObserver === "undefined") return
    if (resizeObserver) resizeObserver.disconnect()
    resizeObserver = new ResizeObserver(() => update())
    resizeObserver.observe(content)
  }

  const observeScroll = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return
    if (scrollResizeObserver) scrollResizeObserver.disconnect()
    scrollResizeObserver = new ResizeObserver(() => update())
    scrollResizeObserver.observe(el)
  }

  onCleanup(() => {
    if (scrollResizeObserver) scrollResizeObserver.disconnect()
    if (resizeObserver) resizeObserver.disconnect()
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      scroll = el
      if (!el) return
      observeScroll(el)
      update()
    },
    contentRef: (el: HTMLElement | undefined) => {
      content = el
      if (!el) return
      observe()
      update()
    },
    handleScroll: update,
    scrollToBottom: () => {
      const el = scroll
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    },
    showScrollToBottom: () => showFab(),
  }
}

export function MessageTimeline(props: {
  messages: DisplayMessage[]
  processing: boolean
  loadingHistory: boolean
  historyError?: string | null
  sessionStatus?: SessionStatus
  activeTurnId?: string
  activeTurnState?: QueueTurnState
  queuedTurns?: Array<Turn & { queueState?: QueueTurnState }>
  onDeleteQueuedTurn?: (turnId: string) => void
  onScroll?: (nearBottom: boolean) => void
  onRetry?: (turnId: string) => void
  onRetryHistory?: () => void
  onOpenFile?: (path: string) => void
}) {
  const autoScroll = createAutoScroll()

  function latestIncompleteAssistantTurnId(items: Turn[]) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].assistantMessages.some((message) => message.time?.completed == null)) return items[i].id
    }
    return undefined
  }

  const [now, setNow] = createSignal(Date.now())
  let tick: number | undefined
  onMount(() => {
    tick = window.setInterval(() => setNow(Date.now()), 30_000)
  })

  onCleanup(() => {
    if (tick !== undefined) clearInterval(tick)
  })

  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [renderCount, setRenderCount] = createSignal(INITIAL_TURNS)
  const [prevTurnIds, setPrevTurnIds] = createSignal<Set<string>>(new Set())

  let turnCache: Turn[] = []
  const turns = createMemo(() => {
    const visible = props.messages.filter(hasVisibleContent)
    turnCache = reconcileTurns(turnCache, visible)
    return turnCache
  })

  const renderedTurns = createMemo(() => {
    const all = turns()
    const count = Math.min(renderCount(), all.length)
    return all.slice(Math.max(0, all.length - count))
  })

  const hasMore = createMemo(() => renderCount() < turns().length)

  const lastTurn = createMemo(() => {
    const all = turns()
    return all.length > 0 ? all[all.length - 1] : null
  })
  const visibleActiveTurnId = createMemo(() => {
    const all = turns()
    if (all.length === 0) return props.activeTurnId

    const explicit = props.activeTurnId && all.some((turn) => turn.id === props.activeTurnId)
      ? props.activeTurnId
      : undefined

    if (!props.processing) return explicit

    const assistantTurnId = latestIncompleteAssistantTurnId(all)
    if (assistantTurnId) return assistantTurnId
    if (explicit) return explicit

    return all[all.length - 1]?.id
  })
  const detachedStreamingTurnId = createMemo(() => {
    if (!props.processing) return undefined

    const activeId = visibleActiveTurnId()
    const last = lastTurn()
    if (!activeId || !last || activeId === last.id) return undefined
    if (last.assistantMessages.length > 0) return undefined

    return activeId
  })
  const queuedTurns = createMemo(() => props.queuedTurns ?? [])
  const timelineEntries = createMemo(() => {
    const real = renderedTurns()
    const queued = queuedTurns()
    return [
      ...real.map((turn, index) => ({
        kind: "real" as const,
        turn,
        queueState: turn.id === visibleActiveTurnId() ? props.activeTurnState : undefined,
        isLastRealTurn: index === real.length - 1,
      })),
      ...queued.map((turn, index) => ({
        kind: "queued" as const,
        turn,
        queueState: turn.queueState,
        isLastQueuedTurn: index === queued.length - 1,
      })),
    ]
  })
  const timelineTurnIds = createMemo(() => timelineEntries().map((entry) => entry.turn.id))
  const timelineTurnById = createMemo(() => new Map(timelineEntries().map((entry) => [entry.turn.id, entry])))

  let containerRef: HTMLDivElement | undefined

  function loadMore() {
    if (!containerRef) {
      setRenderCount((prev) => Math.min(prev + TURNS_PER_BATCH, turns().length))
      return
    }
    const scrollBottom = containerRef.scrollHeight - containerRef.scrollTop
    setRenderCount((prev) => Math.min(prev + TURNS_PER_BATCH, turns().length))
    requestAnimationFrame(() => {
      if (containerRef) containerRef.scrollTop = containerRef.scrollHeight - scrollBottom
    })
  }

  const [prevLastId, setPrevLastId] = createSignal<string | undefined>(undefined)

  createEffect(() => {
    const last = lastTurn()
    if (!last) return

    const prev = untrack(() => prevLastId())
    setPrevLastId(last.id)

    setExpanded((prev) => {
      if (prev[last.id] !== undefined) return prev
      return { ...prev, [last.id]: true }
    })
  })

  createEffect(() => {
    const activeId = visibleActiveTurnId()
    if (!activeId) return

    setExpanded((prev) => {
      if (prev[activeId] !== undefined) return prev
      const next = { ...prev, [activeId]: true }
      if (Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([key, value]) => prev[key] === value)) {
        return prev
      }
      return next
    })
  })

  function handleToggle(turnId: string, isExpanded: boolean) {
    setExpanded((prev) => ({ ...prev, [turnId]: isExpanded }))
  }

  createEffect(() => {
    const currentTurns = turns()
    const currentIds = new Set(currentTurns.map((t) => t.id))
    const prevIds = untrack(() => prevTurnIds())

    if (prevIds.size > 0) {
      let overlap = 0
      for (const id of prevIds) {
        if (currentIds.has(id)) overlap++
      }
      if (overlap < prevIds.size / 2) {
        setRenderCount(INITIAL_TURNS)
        setExpanded({})
      }
    }

    if (currentTurns.length <= INITIAL_TURNS) setRenderCount(INITIAL_TURNS)

    setPrevTurnIds(currentIds)
  })

  createEffect(() => {
    props.onScroll?.(!autoScroll.showScrollToBottom())
  })

  const showScrollToBottom = createMemo(() => !props.loadingHistory && autoScroll.showScrollToBottom())

  return (
    <div class="relative flex-1 min-h-0">
      <div
        ref={(el) => { containerRef = el; autoScroll.scrollRef(el) }}
        onScroll={autoScroll.handleScroll}
        class="h-full overflow-y-auto p-6"
        style={{ background: "var(--background-stronger)", "overflow-anchor": "none" }}
      >
        {/* Loading history indicator */}
        <Show when={props.loadingHistory}>
          <div class="flex flex-col items-center justify-center h-full text-center">
            <Spinner class="w-8 h-8 mb-4" />
            <p class="text-lg" style={{ color: "var(--text-weak)" }}>
              Loading chat history...
            </p>
          </div>
        </Show>

        {/* Main content */}
        <Show when={!props.loadingHistory}>
          <Show when={props.historyError && turns().length === 0}>
            <div class="flex flex-col items-center justify-center h-full text-center gap-3 px-6">
              <p class="text-lg" style={{ color: "var(--status-danger-text)" }}>
                Failed to load chat history
              </p>
              <p class="text-sm max-w-xl" style={{ color: "var(--text-weak)" }}>
                {props.historyError}
              </p>
              <Show when={props.onRetryHistory}>
                <button
                  onClick={() => props.onRetryHistory?.()}
                  class="px-4 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: "var(--surface-inset)",
                    color: "var(--text-strong)",
                    border: "1px solid var(--border-base)",
                  }}
                >
                  Retry
                </button>
              </Show>
            </div>
          </Show>

          <Show when={props.historyError && turns().length > 0}>
            <div
              class="mb-4 px-4 py-3 rounded-lg flex items-center justify-between gap-3"
              style={{
                background: "var(--status-warning-dim)",
                color: "var(--status-warning-text)",
                border: "1px solid var(--status-warning-border)",
              }}
            >
              <div class="min-w-0">
                <div class="text-sm font-medium">Chat history may be incomplete</div>
                <div class="text-xs opacity-90 break-words">{props.historyError}</div>
              </div>
              <Show when={props.onRetryHistory}>
                <button
                  onClick={() => props.onRetryHistory?.()}
                  class="px-3 py-1.5 rounded-md text-xs shrink-0 transition-colors"
                  style={{
                    background: "rgba(0, 0, 0, 0.08)",
                    color: "var(--status-warning-text)",
                  }}
                >
                  Retry
                </button>
              </Show>
            </div>
          </Show>

          {/* Load earlier button */}
          <Show when={hasMore()}>
            <div class="flex justify-center mb-4">
              <button
                onClick={loadMore}
                class="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
                style={{
                  background: "var(--surface-inset)",
                  color: "var(--text-weak)",
                  border: "1px solid var(--border-base)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--background-base)"
                  e.currentTarget.style.color = "var(--text-strong)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--surface-inset)"
                  e.currentTarget.style.color = "var(--text-weak)"
                }}
              >
                <ChevronUp class="w-4 h-4" />
                <span>Load {Math.min(TURNS_PER_BATCH, turns().length - renderCount())} earlier turns</span>
              </button>
            </div>
          </Show>

          {/* Turns */}
          <div ref={autoScroll.contentRef} class="space-y-4">
            <For each={timelineTurnIds()}>
              {(id) => {
                const entry = () => timelineTurnById().get(id)
                return (
                  <Show when={entry()}>
                    {(item) => {
                      const current = item()
                      const isReal = current.kind === "real"
                      const realExpanded = props.processing && current.turn.id === visibleActiveTurnId()
                      let defaultExpanded = expanded()[current.turn.id] ?? true

                      if (isReal) {
                        defaultExpanded = expanded()[current.turn.id] ?? (realExpanded || (!props.processing && current.isLastRealTurn))
                      }

                      return (
                        <MessageTurn
                          turn={current.turn}
                          queueState={current.queueState}
                          now={now}
                          defaultExpanded={defaultExpanded}
                          streaming={props.processing && isReal && current.turn.id === visibleActiveTurnId()}
                          onToggle={handleToggle}
                          onDeleteQueued={props.onDeleteQueuedTurn}
                          onRetry={props.onRetry}
                          onOpenFile={props.onOpenFile}
                        />
                      )
                    }}
                  </Show>
                )
              }}
            </For>
          </div>

          {/* Empty state */}
          <Show when={turns().length === 0 && !props.processing}>
            <div class="flex flex-col items-center justify-center h-full text-center py-12">
              <div
                class="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ background: "var(--surface-inset)" }}
              >
                <svg
                  class="w-8 h-8"
                  style={{ color: "var(--text-interactive-base)" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <p class="text-lg mb-2" style={{ color: "var(--text-weak)" }}>
                Ready to chat
              </p>
              <p style={{ color: "var(--text-weak)", opacity: 0.7 }}>Type a message below to begin</p>
            </div>
          </Show>

        </Show>
      </div>

      <Show when={showScrollToBottom()}>
        <div class="pointer-events-none absolute bottom-6 right-6 z-10">
          <button
            type="button"
            class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
            style={{
              background: "var(--interactive-base)",
              color: "var(--text-on-interactive)",
              border: "1px solid color-mix(in srgb, var(--interactive-hover) 55%, transparent)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--interactive-hover)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--interactive-base)"
            }}
            onClick={() => autoScroll.scrollToBottom()}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
          >
            <ArrowDown class="w-5 h-5" />
          </button>
        </div>
      </Show>
    </div>
  )
}

// Flat message list display (alternative simpler view)
export function FlatMessageList(props: {
  messages: DisplayMessage[]
  processing: boolean
  loadingHistory: boolean
  sessionStatus?: SessionStatus
}) {
  let containerRef: HTMLDivElement | undefined
  let endRef: HTMLDivElement | undefined
  const [userScrolledUp, setUserScrolledUp] = createSignal(false)

  function isNearBottom(): boolean {
    if (!containerRef) return true
    const { scrollTop, scrollHeight, clientHeight } = containerRef
    return scrollHeight - scrollTop - clientHeight < 100
  }

  function handleScroll() {
    setUserScrolledUp(!isNearBottom())
  }

  function scrollToBottom(force = false) {
    if (userScrolledUp() && !force) return
    if (containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight
    }
  }

  onMount(() => {
    setTimeout(() => scrollToBottom(true), 100)
  })

  const visibleMessages = createMemo(() => props.messages.filter(hasVisibleContent))

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      class="flex-1 overflow-y-auto p-6 space-y-4"
      style={{ background: "var(--background-stronger)", "overflow-anchor": "none" }}
    >
      <Show when={props.loadingHistory}>
        <div class="flex flex-col items-center justify-center h-full text-center">
          <Spinner class="w-8 h-8 mb-4" />
          <p class="text-lg" style={{ color: "var(--text-weak)" }}>
            Loading chat history...
          </p>
        </div>
      </Show>

      <Show when={!props.loadingHistory}>
        <Show when={visibleMessages().length === 0 && !props.processing}>
          <div class="flex flex-col items-center justify-center h-full text-center py-12">
            <p class="text-lg mb-2" style={{ color: "var(--text-weak)" }}>
              Ready to chat
            </p>
            <p style={{ color: "var(--text-weak)", opacity: 0.7 }}>Type a message below to begin</p>
          </div>
        </Show>

        <For each={visibleMessages()}>
          {(message) => {
            const text = extractTextContent(message.parts).trim()
            const hasText = text.length > 0
            const hasTools = message.parts.some((p) => p.type === "tool")
            const isToolOnly = message.role === "assistant" && !hasText && hasTools && !message.error

            return (
              <div
                class="w-full"
                classList={{
                  "max-w-2xl ml-auto": message.role === "user",
                }}
              >
                <Show when={isToolOnly}>
                  <MessageParts parts={message.parts} />
                </Show>

                <Show when={!isToolOnly}>
                  <div
                    class="rounded-lg p-4"
                    style={{
                      background: message.role === "user" ? "var(--surface-inset)" : "var(--background-base)",
                      border: "1px solid var(--border-base)",
                    }}
                  >
                    <div class="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: "var(--text-weak)" }}>
                      {message.role}
                    </div>
                    <Show when={message.error}>
                      {(err) => (
                        <div
                          class="px-3 py-2 rounded text-sm mb-2"
                          style={{ background: "var(--status-danger-dim)", color: "var(--status-danger-text)" }}
                        >
                          <strong>Error:</strong> {errorText(err())}
                        </div>
                      )}
                    </Show>
                    <Show
                      when={message.role === "assistant"}
                      fallback={
                        <div class="whitespace-pre-wrap" style={{ color: "var(--text-base)" }}>
                          {text || "..."}
                        </div>
                      }
                    >
                      <Show when={hasText}>
                        <Markdown content={text} class="text-[var(--text-strong)]" />
                      </Show>
                    </Show>
                  </div>
                  <Show when={message.role === "assistant" && hasTools}>
                    <div class="mt-2">
                      <MessageParts parts={message.parts} />
                    </div>
                  </Show>
                </Show>
              </div>
            )
          }}
        </For>

      </Show>

      <div ref={endRef} style={{ "overflow-anchor": "auto", height: "1px" }} />
    </div>
  )
}

function ProcessingIndicator(props: { sessionStatus?: SessionStatus }) {
  const [timeLeft, setTimeLeft] = createSignal<number>(0)

  // Use a reactive calculation for time left
  const calculateRemaining = () => {
    const s = props.sessionStatus
    if (s?.type === "retry" && s.next) {
      return Math.max(0, Math.round((s.next - Date.now()) / 1000))
    }
    return 0
  }

  createEffect(() => {
    // Re-run effect when sessionStatus type changes to retry or next changes
    const s = props.sessionStatus
    if (s?.type === "retry" && s.next) {
      setTimeLeft(calculateRemaining())
      const timer = setInterval(() => {
        setTimeLeft(calculateRemaining())
      }, 1000)
      onCleanup(() => clearInterval(timer))
    }
  })

  return (
    <div
      class="rounded-lg p-3 sm:p-4 transition-all"
      style={{
        background: props.sessionStatus?.type === "retry" ? "var(--status-warning-dim)" : "var(--background-base)",
        border: props.sessionStatus?.type === "retry" ? "1px solid var(--status-warning-border)" : "1px solid var(--border-base)",
      }}
    >
      <Show
        when={props.sessionStatus?.type === "retry"}
        fallback={
          <div class="flex items-center gap-3 min-h-5" style={{ color: "var(--text-interactive-base)" }}>
            <Brain class="w-5 h-5 shrink-0" />
            <div class="flex-1 overflow-hidden">
              <span class="inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap leading-none" style={{ color: "var(--text-strong)" }}>
                Thinking
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
              </span>
            </div>
          </div>
        }
      >
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2" style={{ color: "var(--status-warning-text)" }}>
            <RefreshCw class="w-3.5 h-3.5 animate-spin-slow" />
            <span class="text-sm font-semibold">Retrying soon</span>
            <div class="flex items-center gap-1 ml-auto text-xs px-2 py-0.5 rounded bg-black/10" style={{ color: "var(--status-warning-text)" }}>
              <Clock class="w-3 h-3" />
              <span class="font-mono">{timeLeft()}s</span>
            </div>
          </div>
          <div class="text-xs leading-relaxed opacity-90 font-medium" style={{ color: "var(--status-warning-text)" }}>
            {props.sessionStatus?.type === "retry" ? props.sessionStatus.message : "Waiting to retry..."}
          </div>
        </div>
      </Show>
    </div>
  )
}
