import { createSignal, createMemo, createEffect, on, For, Show, onMount, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { Spinner } from "./ui/spinner"
import { MessageTurn } from "./message-turn"
// Note: Markdown and MessageParts are used in the FlatMessageList component below
import { Markdown } from "./markdown"
import { MessageParts } from "./tool-part"
import { ChevronUp, RefreshCw, Clock, Brain } from "lucide-solid"
import { errorText } from "../types/message"
import type { DisplayMessage, Turn } from "../types/message"
import { extractTextContent } from "../utils/message"
import type { SessionStatus } from "../sdk/client"

// Number of turns to render initially and on each "load more"
const TURNS_PER_BATCH = 10
const INITIAL_TURNS = 5

// Compute turn-level timing from user and assistant message timestamps
function computeTurnTime(user: DisplayMessage, assistants: DisplayMessage[]): Turn["time"] {
  const started = user.time?.created
  if (started == null || !Number.isFinite(started)) return undefined
  // Find the latest completed timestamp among all assistant messages
  const completed = assistants.reduce<number | undefined>((latest, msg) => {
    const c = msg.time?.completed
    if (c == null || !Number.isFinite(c)) return latest
    if (latest == null) return c
    return c > latest ? c : latest
  }, undefined)
  const duration = completed != null && Number.isFinite(completed) ? completed - started : undefined
  return { started, completed, duration }
}

// Convert flat message list to turns (user + assistant groupings)
function messagesToTurns(messages: DisplayMessage[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const msg of messages) {
    if (msg.role === "user") {
      // Start a new turn
      if (current) {
        current.time = computeTurnTime(current.userMessage, current.assistantMessages)
        turns.push(current)
      }
      current = {
        id: msg.id,
        userMessage: msg,
        assistantMessages: [],
      }
    } else if (msg.role === "assistant" && current) {
      // Add to current turn
      current.assistantMessages.push(msg)
    } else if (msg.role === "assistant" && !current) {
      // Handle assistant messages before first user message
      console.warn("MessageTimeline: Dropping assistant message before first user message", msg.id)
    }
  }

  // Don't forget the last turn
  if (current) {
    current.time = computeTurnTime(current.userMessage, current.assistantMessages)
    turns.push(current)
  }

  return turns
}

function hasVisibleContent(message: DisplayMessage): boolean {
  if (message.error) return true
  if (message.role === "user") return true
  if (message.parts.some((p) => p.type === "tool")) return true
  return extractTextContent(message.parts).trim().length > 0
}

function createAutoScroll(options: { working: () => boolean; bottomThreshold?: number }) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let autoTimer: ReturnType<typeof setTimeout> | undefined
  let resizeObserver: ResizeObserver | undefined
  let observedContent: HTMLElement | undefined
  let auto: { top: number; time: number } | undefined

  const threshold = options.bottomThreshold ?? 10

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop

  const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > 1

  const markAuto = (el: HTMLElement) => {
    auto = { top: Math.max(0, el.scrollHeight - el.clientHeight), time: Date.now() }
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = setTimeout(() => {
      auto = undefined
      autoTimer = undefined
    }, 1500)
  }

  const isAuto = (el: HTMLElement) => {
    const a = auto
    if (!a) return false
    if (Date.now() - a.time > 1500) { auto = undefined; return false }
    return Math.abs(el.scrollTop - a.top) < 2
  }

  const scrollToBottomNow = (el: HTMLElement) => {
    markAuto(el)
    el.scrollTop = el.scrollHeight
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const el = scroll
    if (!el) return
    if (!force && store.userScrolled) return

    const distance = distanceFromBottom(el)
    if (distance < 2) { markAuto(el); return }

    scrollToBottomNow(el)
  }

  const stop = () => {
    const el = scroll
    if (!el) return
    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }
    if (store.userScrolled) return
    setStore("userScrolled", true)
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    const el = scroll
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scroll
    if (!el) return

    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (distanceFromBottom(el) < threshold) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (!store.userScrolled && isAuto(el)) {
      scrollToBottom(false)
      return
    }

    stop()
  }

  const updateOverflowAnchor = (el: HTMLElement) => {
    el.style.overflowAnchor = store.userScrolled ? "auto" : "none"
  }

  const setupResizeObserver = (content: HTMLElement) => {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = undefined }
    observedContent = content
    resizeObserver = new ResizeObserver(() => {
      const el = scroll
      if (el && !canScroll(el)) {
        if (store.userScrolled) setStore("userScrolled", false)
        return
      }
      if (!active()) return
      if (store.userScrolled) return
      scrollToBottom(false)
    })
    resizeObserver.observe(content)
  }

  createEffect(() => {
    const content = store.contentRef
    if (!content) return
    if (content === observedContent) return
    setupResizeObserver(content)
  })

  createEffect(on(options.working, (working: boolean) => {
    settling = false
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = undefined

    if (working) {
      if (!store.userScrolled) scrollToBottom(true)
      return
    }

    settling = true
    settleTimer = setTimeout(() => { settling = false }, 300)
  }))

  createEffect(() => {
    store.userScrolled
    const el = scroll
    if (!el) return
    updateOverflowAnchor(el)
  })

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (autoTimer) clearTimeout(autoTimer)
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = undefined }
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      if (scroll) scroll.removeEventListener("wheel", handleWheel)
      scroll = el
      if (!el) return
      updateOverflowAnchor(el)
      el.addEventListener("wheel", handleWheel, { passive: true })
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled: () => store.userScrolled,
  }
}

export function MessageTimeline(props: {
  messages: DisplayMessage[]
  processing: boolean
  loadingHistory: boolean
  historyError?: string | null
  sessionStatus?: SessionStatus
  onScroll?: (nearBottom: boolean) => void
  onRetry?: (turnId: string) => void
  onRetryHistory?: () => void
  onOpenFile?: (path: string) => void
}) {
  const autoScroll = createAutoScroll({ working: () => props.processing })

  const [now, setNow] = createSignal(Date.now())
  let tick: number | undefined
  onMount(() => {
    tick = window.setInterval(() => setNow(Date.now()), 30_000)
  })

  createEffect(on(() => props.loadingHistory, (loading, prev) => {
    if (prev && !loading) requestAnimationFrame(() => autoScroll.forceScrollToBottom())
  }))
  onCleanup(() => {
    if (tick !== undefined) clearInterval(tick)
  })

  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [renderCount, setRenderCount] = createSignal(INITIAL_TURNS)
  const [prevTurnIds, setPrevTurnIds] = createSignal<Set<string>>(new Set())

  const turns = createMemo(() => messagesToTurns(props.messages.filter(hasVisibleContent)))

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
    if (prev && prev !== last.id) {
      setExpanded((e) => {
        const next = { ...e }
        delete next[prev]
        return next
      })
    }
    setPrevLastId(last.id)

    setExpanded((prev) => {
      if (prev[last.id] !== undefined) return prev
      return { ...prev, [last.id]: true }
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
    props.onScroll?.(!autoScroll.userScrolled())
  })

  return (
    <div
      ref={(el) => { containerRef = el; autoScroll.scrollRef(el) }}
      onScroll={autoScroll.handleScroll}
      class="flex-1 overflow-y-auto p-6"
      style={{ background: "var(--background-stronger)" }}
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
          <For each={renderedTurns()}>
            {(turn, index) => (
              <MessageTurn
                turn={turn}
                now={now}
                isLast={index() === renderedTurns().length - 1}
                defaultExpanded={expanded()[turn.id] ?? index() === renderedTurns().length - 1}
                onToggle={handleToggle}
                onRetry={props.onRetry}
                onOpenFile={props.onOpenFile}
              />
            )}
          </For>
        </div>

        {/* Processing indicator - shown when processing but last turn has content */}
        <Show when={props.processing && lastTurn() && lastTurn()!.assistantMessages.length > 0}>
          <div class="mt-4">
            <ProcessingIndicator sessionStatus={props.sessionStatus} />
          </div>
        </Show>

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

        {/* Processing indicator when no turns yet */}
        <Show when={props.processing && (!lastTurn() || lastTurn()!.assistantMessages.length === 0)}>
          <div class="mt-4">
            <ProcessingIndicator sessionStatus={props.sessionStatus} />
          </div>
        </Show>
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

        <Show when={props.processing}>
          <div class="mt-4">
            <ProcessingIndicator sessionStatus={props.sessionStatus} />
          </div>
        </Show>
      </Show>

      <div ref={endRef} style={{ "overflow-anchor": "auto", height: "1px" }} />
    </div>
  )
}

const THINKING_PHRASES = ["Thinking...", "Working...", "Processing...", "Analyzing..."]

function ProcessingIndicator(props: { sessionStatus?: SessionStatus }) {
  const [timeLeft, setTimeLeft] = createSignal<number>(0)
  const [phraseIndex, setPhraseIndex] = createSignal<number>(0)

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
    } else {
      const phraseTimer = setInterval(() => {
        setPhraseIndex((prev) => (prev + 1) % THINKING_PHRASES.length)
      }, 2000)
      onCleanup(() => clearInterval(phraseTimer))
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
          <div class="flex items-center gap-3" style={{ color: "var(--text-interactive-base)" }}>
            <Brain class="w-5 h-5 animate-pulse" />
            <div class="flex-1 overflow-hidden">
              <span class="block text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                {THINKING_PHRASES[phraseIndex()].split("").map((ch, i) => (
                  <span
                    class="inline-block char-bounce"
                    style={{ "animation-delay": `${i * 70}ms`, display: "inline-block" }}
                  >
                    {ch === " " ? "\u00A0" : ch}
                  </span>
                ))}
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
