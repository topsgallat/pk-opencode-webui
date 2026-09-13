import { createSignal, For, Show, Switch, Match, onCleanup, onMount } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { ArrowDown, ArrowLeft, Bot, History, Lock, LockOpen, Loader2, Plus, SendHorizontal } from "lucide-solid"
import { base64Decode } from "../utils/path"
import { getFilename } from "../components/shared"
import { Markdown } from "../components/markdown"
import { Button } from "../components/ui/button"
import { PickerDialog } from "../components/picker-dialog"
import { formatRelativeTime } from "../utils/time"
import { createAutoScroll } from "../utils/auto-scroll"
import { useDevice } from "../context/device"

type ToolStatus = "running" | "done" | "error"

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: ToolStatus; result?: string; subagent?: string }
  | {
      kind: "usage"
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
      costUsd?: number
      model?: string
      effort?: string
    }

type ClaudeModel = "sonnet" | "opus" | "haiku"

const MODEL_LABELS: Record<ClaudeModel, string> = {
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
  haiku: "Claude Haiku",
}

function isClaudeModel(value: string | null): value is ClaudeModel {
  return value === "sonnet" || value === "opus" || value === "haiku"
}

type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max"

const EFFORT_LABELS: Record<ClaudeEffort, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "X-high effort",
  max: "Max effort",
}

function isClaudeEffort(value: string | null): value is ClaudeEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"
}

function sessionStorageKey(dir: string) {
  return `claude.session.${dir}`
}

function modelStorageKey(dir: string) {
  return `claude.model.${dir}`
}

function effortStorageKey(dir: string) {
  return `claude.effort.${dir}`
}

type SessionSummary = {
  id: string
  preview: string
  updatedAt: string
  messageCount: number
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } => !!block && block.type === "text")
      .map((block) => block.text)
      .join("\n")
  }
  return ""
}

// Claude's `-p` print-mode result summary reports usage for the whole
// turn (`usage`) plus a total spend (`total_cost_usd`) — both documented,
// stable fields of the CLI's non-interactive JSON output.
function extractUsage(
  evt: Record<string, unknown>,
  turnModel: string | undefined,
  turnEffort: string | undefined,
): Extract<ChatItem, { kind: "usage" }> | undefined {
  const usage = evt.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== "object") return undefined
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined
  return {
    kind: "usage",
    inputTokens,
    outputTokens,
    ...(typeof usage.cache_read_input_tokens === "number" ? { cacheReadInputTokens: usage.cache_read_input_tokens } : {}),
    ...(typeof usage.cache_creation_input_tokens === "number" ? { cacheCreationInputTokens: usage.cache_creation_input_tokens } : {}),
    ...(typeof evt.total_cost_usd === "number" ? { costUsd: evt.total_cost_usd } : {}),
    ...(turnModel ? { model: turnModel } : {}),
    ...(turnEffort ? { effort: turnEffort } : {}),
  }
}

/**
 * Claude Code chat page (Phase 1 MVP). Deliberately separate from the OpenCode
 * `Session` page/context stack — the message shapes and streaming protocol
 * are different (Claude CLI stream-json vs. OpenCode's session parts), so
 * this renders its own simplified transcript rather than sharing renderers.
 * Visually it mirrors session-header.tsx / message-turn.tsx (avatar, markdown,
 * design tokens) since it isn't wrapped by the OpenCode Layout/MobileLayout.
 */
export function ClaudeSession() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  const device = useDevice()

  const directory = (): string | undefined => {
    try {
      const decoded = base64Decode(params.dir)
      return decoded && (decoded.startsWith("/") || decoded.startsWith("~")) ? decoded : undefined
    } catch {
      return undefined
    }
  }

  const [items, setItems] = createSignal<ChatItem[]>([])
  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [sessionId, setSessionId] = createSignal<string | undefined>(undefined)
  const [model, setModel] = createSignal<ClaudeModel>("sonnet")
  const [effort, setEffort] = createSignal<ClaudeEffort>("medium")
  const [hasOutputThisTurn, setHasOutputThisTurn] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [showHistoryPicker, setShowHistoryPicker] = createSignal(false)
  const [showModelPicker, setShowModelPicker] = createSignal(false)
  const [showEffortPicker, setShowEffortPicker] = createSignal(false)
  const [historySessions, setHistorySessions] = createSignal<SessionSummary[]>([])
  const [loadingHistoryList, setLoadingHistoryList] = createSignal(false)
  const [pinned, setPinned] = createSignal(false)
  // The FAB shows solid for a few seconds right after locking (clear
  // confirmation it engaged), then fades to the same quiet look as the
  // unlocked-at-bottom state so it isn't a loud, distracting fixture for the
  // rest of a long streamed reply.
  const [justLocked, setJustLocked] = createSignal(false)
  let lockFadeTimer: ReturnType<typeof setTimeout> | undefined
  function engagePin() {
    setPinned(true)
    setJustLocked(true)
    if (lockFadeTimer) clearTimeout(lockFadeTimer)
    lockFadeTimer = setTimeout(() => setJustLocked(false), 3000)
  }
  function disengagePin() {
    setPinned(false)
    setJustLocked(false)
    if (lockFadeTimer) {
      clearTimeout(lockFadeTimer)
      lockFadeTimer = undefined
    }
  }

  // Set once per turn when a `stream_event` text delta lands, so the final
  // full-snapshot `assistant` record for that turn doesn't get re-appended
  // on top of text we already streamed in incrementally. Subagent text
  // (tagged with `parent_tool_use_id`) is deduped per tool call instead,
  // since a turn can involve several Task calls each streaming their own text.
  let streamedTextThisTurn = false
  let streamedSubagentIds = new Set<string>()
  // Captured from the main thread's `assistant` records so the eventual
  // usage summary can report what was actually used this turn (the CLI
  // stamps both fields on every top-level assistant record).
  let turnModel: string | undefined
  let turnEffort: string | undefined

  const autoScroll = createAutoScroll({ pinned })
  // While pinned, block manual scroll input entirely (hard lock, matching
  // the OpenCode chat's message-timeline.tsx behavior) instead of letting it
  // move and snap back -- scrolling up requires pressing unlock first.
  let scrollEl: HTMLDivElement | undefined
  const blockWheelOrTouch = (e: Event) => { if (pinned()) e.preventDefault() }
  onCleanup(() => {
    scrollEl?.removeEventListener("wheel", blockWheelOrTouch)
    scrollEl?.removeEventListener("touchmove", blockWheelOrTouch)
    if (lockFadeTimer) clearTimeout(lockFadeTimer)
  })
  const fabVivid = () => (pinned() ? justLocked() : autoScroll.showScrollToBottom())

  let textareaRef: HTMLTextAreaElement | undefined

  onMount(() => {
    const dir = directory()
    if (!dir) return
    try {
      const saved = localStorage.getItem(sessionStorageKey(dir))
      if (saved) {
        setSessionId(saved)
        void loadHistory(dir, saved)
      }
      const savedModel = localStorage.getItem(modelStorageKey(dir))
      if (isClaudeModel(savedModel)) setModel(savedModel)
      const savedEffort = localStorage.getItem(effortStorageKey(dir))
      if (isClaudeEffort(savedEffort)) setEffort(savedEffort)
    } catch {
      // localStorage unavailable — session/model/effort simply won't resume across reloads
    }
  })

  async function loadHistory(dir: string, id: string) {
    try {
      const res = await fetch(`api/claude/sessions/${encodeURIComponent(id)}/messages?cwd=${encodeURIComponent(dir)}`)
      if (!res.ok) return
      const data = (await res.json()) as { items?: ChatItem[] }
      if (Array.isArray(data.items)) setItems(data.items)
    } catch {
      // history is best-effort — leave the transcript empty rather than block the page
    }
  }

  async function openHistoryPicker() {
    const dir = directory()
    if (!dir) return
    setShowHistoryPicker(true)
    setLoadingHistoryList(true)
    try {
      const res = await fetch(`api/claude/sessions?cwd=${encodeURIComponent(dir)}`)
      const data = (await res.json().catch(() => null)) as { sessions?: SessionSummary[] } | null
      setHistorySessions(data?.sessions ?? [])
    } catch {
      setHistorySessions([])
    } finally {
      setLoadingHistoryList(false)
    }
  }

  function selectHistorySession(id: string) {
    const dir = directory()
    setShowHistoryPicker(false)
    if (!dir) return
    setSessionId(id)
    setItems([])
    setError(undefined)
    setPinned(false)
    try {
      localStorage.setItem(sessionStorageKey(dir), id)
    } catch {
      // ignore
    }
    void loadHistory(dir, id)
  }

  function startNewChat() {
    const dir = directory()
    setSessionId(undefined)
    setItems([])
    setError(undefined)
    setPinned(false)
    if (!dir) return
    try {
      localStorage.removeItem(sessionStorageKey(dir))
    } catch {
      // ignore
    }
  }


  function autoResize() {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  function selectModel(value: string) {
    if (!isClaudeModel(value)) return
    setModel(value)
    const dir = directory()
    if (!dir) return
    try {
      localStorage.setItem(modelStorageKey(dir), value)
    } catch {
      // ignore
    }
  }

  function selectEffort(value: string) {
    if (!isClaudeEffort(value)) return
    setEffort(value)
    const dir = directory()
    if (!dir) return
    try {
      localStorage.setItem(effortStorageKey(dir), value)
    } catch {
      // ignore
    }
  }

  function appendAssistantText(text: string) {
    if (!text) return
    setHasOutputThisTurn(true)
    setItems((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.kind === "assistant") {
        return [...prev.slice(0, -1), { kind: "assistant", text: last.text + text }]
      }
      return [...prev, { kind: "assistant", text }]
    })
  }

  function addToolCall(id: string, name: string, input: unknown) {
    setHasOutputThisTurn(true)
    setItems((prev) => [...prev, { kind: "tool", id, name, input, status: "running" }])
  }

  function resolveToolCall(toolUseId: string, result: string, isError: boolean) {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "tool" && item.id === toolUseId
          ? { ...item, status: isError ? "error" : "done", result }
          : item,
      ),
    )
  }

  function appendSubagentText(parentToolUseId: string, text: string) {
    if (!text) return
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "tool" && item.id === parentToolUseId
          ? { ...item, subagent: (item.subagent ?? "") + text }
          : item,
      ),
    )
  }

  function handleEvent(evt: Record<string, unknown>) {
    const parentToolUseId = typeof evt.parent_tool_use_id === "string" ? evt.parent_tool_use_id : undefined

    if (evt.type === "stream_event") {
      const event = evt.event as Record<string, unknown> | undefined
      const delta = event?.delta as Record<string, unknown> | undefined
      if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
        if (parentToolUseId) {
          streamedSubagentIds.add(parentToolUseId)
          appendSubagentText(parentToolUseId, delta.text)
        } else {
          streamedTextThisTurn = true
          appendAssistantText(delta.text)
        }
      }
      return
    }

    if (evt.type === "system" && evt.subtype === "init") {
      if (typeof evt.session_id === "string") {
        setSessionId(evt.session_id)
        const dir = directory()
        if (dir) {
          try {
            localStorage.setItem(sessionStorageKey(dir), evt.session_id)
          } catch {
            // ignore
          }
        }
      }
      return
    }

    if (evt.type === "error") {
      setError(String(evt.message || "Unknown error"))
      return
    }

    // The raw CLI's stream-json wraps the Anthropic message under `message`,
    // e.g. {type: "assistant", message: {content: [...]}} — unlike the Agent
    // SDK's flattened SDKMessage shape. Verified against a live container.
    const inner = evt.message as Record<string, unknown> | undefined

    if (evt.type === "assistant" && inner && Array.isArray(inner.content)) {
      if (!parentToolUseId) {
        if (typeof inner.model === "string") turnModel = inner.model
        if (typeof evt.effort === "string") turnEffort = evt.effort
      }
      for (const block of inner.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          // Already rendered progressively via stream_event deltas above.
          if (parentToolUseId) {
            if (!streamedSubagentIds.has(parentToolUseId)) appendSubagentText(parentToolUseId, block.text)
          } else if (!streamedTextThisTurn) {
            appendAssistantText(block.text)
          }
        } else if (block.type === "tool_use" && !parentToolUseId) {
          const id = typeof block.id === "string" && block.id ? block.id : `tool-${Date.now()}-${Math.random()}`
          addToolCall(id, String(block.name), block.input)
        }
      }
      return
    }

    if (evt.type === "user" && inner && Array.isArray(inner.content)) {
      for (const block of inner.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result") {
          const text = toolResultText(block.content)
          const isError = !!block.is_error
          if (typeof block.tool_use_id === "string") {
            resolveToolCall(block.tool_use_id, text, isError)
          }
        }
      }
      return
    }

    if (evt.type === "result") {
      if (evt.subtype && evt.subtype !== "success") {
        setError(`Session ended: ${String(evt.subtype)}`)
      }
      const usage = extractUsage(evt, turnModel, turnEffort)
      if (usage) setItems((prev) => [...prev, usage])
    }
  }

  async function send() {
    const dir = directory()
    const prompt = input().trim()
    if (!dir || !prompt || sending()) return

    setInput("")
    queueMicrotask(autoResize)
    setItems((prev) => [...prev, { kind: "user", text: prompt }])
    setSending(true)
    setHasOutputThisTurn(false)
    streamedTextThisTurn = false
    streamedSubagentIds = new Set()
    turnModel = undefined
    turnEffort = undefined
    setError(undefined)

    try {
      const res = await fetch("api/claude/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: dir, prompt, sessionId: sessionId(), model: model(), effort: effort() }),
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        setError(text || `Request failed (${res.status})`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() || ""
        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, "").trim()
          if (!line) continue
          try {
            handleEvent(JSON.parse(line))
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      if (!device.isTouchDevice()) textareaRef?.focus()
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !device.isTouchDevice()) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div class="flex flex-col mobile-viewport" style={{ background: "var(--background-base)" }}>
      <header
        class="flex items-center gap-2 px-2 md:px-4 h-12 shrink-0"
        style={{ background: "var(--background-base)", "border-bottom": "1px solid var(--border-base)" }}
      >
        <button
          type="button"
          class="p-1.5 rounded transition-colors shrink-0"
          style={{ color: "var(--text-weak)" }}
          onClick={() => navigate(`/${params.dir}/session`)}
          aria-label="Back to project"
          title="Back to project"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div class="min-w-0 flex-1">
          <h1 class="text-sm font-medium truncate" style={{ color: "var(--text-strong)" }}>
            {directory() ? getFilename(directory()!) : "Claude Code"}
          </h1>
          <div class="text-xs truncate" style={{ color: "var(--text-weak)" }}>
            Claude Code
            <Show when={sessionId()}>
              {(id) => <span> · session {id().slice(0, 8)}</span>}
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="p-1.5 rounded transition-colors"
            style={{ color: "var(--text-weak)" }}
            onClick={() => void openHistoryPicker()}
            aria-label="Session history"
            title="Session history"
          >
            <History class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="p-1.5 rounded transition-colors"
            style={{ color: "var(--text-weak)" }}
            onClick={startNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <Plus class="w-4 h-4" />
          </button>
        </div>
      </header>

      <Show when={showHistoryPicker()}>
        <PickerDialog
          title="Session history"
          placeholder="Filter sessions..."
          emptyMessage="No previous sessions for this project."
          loading={loadingHistoryList()}
          loadingMessage="Loading sessions…"
          items={historySessions().map((session) => ({
            id: session.id,
            title: session.preview,
            description: `${formatRelativeTime(new Date(session.updatedAt).getTime())} · ${session.messageCount} messages`,
          }))}
          onSelect={(item) => selectHistorySession(item.id)}
          onClose={() => setShowHistoryPicker(false)}
        />
      </Show>

      <div class="relative flex-1 min-h-0">
      <div
        ref={(el) => {
          scrollEl = el
          autoScroll.scrollRef(el)
          el?.addEventListener("wheel", blockWheelOrTouch, { passive: false })
          el?.addEventListener("touchmove", blockWheelOrTouch, { passive: false })
        }}
        onScroll={autoScroll.handleScroll}
        class="h-full overflow-y-auto px-3 md:px-4 py-4"
      >
        <div ref={autoScroll.contentRef} class="max-w-3xl mx-auto flex flex-col gap-4">
          <Show when={items().length === 0}>
            <div class="text-sm text-center py-12" style={{ color: "var(--text-weak)" }}>
              Ask Claude Code anything about this project.
            </div>
          </Show>

          <For each={items()}>
            {(item) => (
              <Switch>
                <Match when={item.kind === "user"}>
                  <div class="flex justify-end">
                    <div
                      class="rounded-lg px-3 py-2 max-w-[85%] md:max-w-[75%] whitespace-pre-wrap text-sm"
                      style={{ background: "var(--interactive-base)", color: "white" }}
                    >
                      {(item as { text: string }).text}
                    </div>
                  </div>
                </Match>

                <Match when={item.kind === "assistant"}>
                  <div class="flex gap-3">
                    <div
                      class="w-6 h-6 rounded-full items-center justify-center shrink-0 mt-0.5 hidden md:flex"
                      style={{ background: "var(--surface-inset)" }}
                    >
                      <Bot class="w-3 h-3" style={{ color: "var(--text-strong)" }} />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div
                        class="text-xs font-medium mb-1 flex items-center gap-1"
                        style={{ color: "var(--text-weak)" }}
                      >
                        <Bot class="w-3 h-3 md:hidden" />
                        Claude
                      </div>
                      <Markdown content={(item as { text: string }).text} class="text-sm" copyCodeBlocks />
                    </div>
                  </div>
                </Match>

                <Match when={item.kind === "tool"}>
                  {(() => {
                    const tool = item as Extract<ChatItem, { kind: "tool" }>
                    return (
                      <div
                        class="ml-0 md:ml-9 rounded-lg border overflow-hidden"
                        style={{ "border-color": "var(--border-base)" }}
                      >
                        <div
                          class="flex items-center gap-2 text-xs font-mono px-3 py-2 break-all"
                          style={{ color: "var(--text-weak)", background: "var(--surface-inset)" }}
                        >
                          <span>🔧 {tool.name}</span>
                          <span class="opacity-70 truncate">{JSON.stringify(tool.input)}</span>
                          <span class="ml-auto flex items-center gap-1 shrink-0 not-italic font-sans">
                            <Show when={tool.status === "running"}>
                              <Loader2 class="w-3 h-3 animate-spin" style={{ color: "var(--text-interactive-base)" }} />
                              <span style={{ color: "var(--text-interactive-base)" }}>Running</span>
                            </Show>
                            <Show when={tool.status === "done"}>
                              <span style={{ color: "var(--icon-success-base)" }}>Done</span>
                            </Show>
                            <Show when={tool.status === "error"}>
                              <span style={{ color: "var(--text-critical-base)" }}>Error</span>
                            </Show>
                          </span>
                        </div>
                        <Show when={tool.subagent}>
                          <div
                            class="text-xs px-3 py-2 whitespace-pre-wrap max-h-40 overflow-y-auto italic"
                            style={{ color: "var(--text-weak)", "border-top": "1px solid var(--border-base)" }}
                          >
                            {tool.subagent}
                          </div>
                        </Show>
                        <Show when={tool.result}>
                          <div
                            class="text-xs font-mono px-3 py-2 whitespace-pre-wrap max-h-48 overflow-y-auto"
                            style={{ color: tool.status === "error" ? "var(--text-critical-base)" : "var(--text-weak)" }}
                          >
                            {tool.result}
                          </div>
                        </Show>
                      </div>
                    )
                  })()}
                </Match>

                <Match when={item.kind === "usage"}>
                  {(() => {
                    const usage = item as Extract<ChatItem, { kind: "usage" }>
                    const parts = []
                    if (usage.model) parts.push(usage.model)
                    if (usage.effort) parts.push(EFFORT_LABELS[usage.effort as ClaudeEffort] ?? usage.effort)
                    parts.push(`${usage.inputTokens.toLocaleString()} in`, `${usage.outputTokens.toLocaleString()} out`)
                    if (usage.cacheReadInputTokens) parts.push(`${usage.cacheReadInputTokens.toLocaleString()} cached`)
                    if (usage.costUsd !== undefined) parts.push(`$${usage.costUsd.toFixed(4)}`)
                    return (
                      <div class="ml-0 md:ml-9 text-[11px]" style={{ color: "var(--text-weak)" }}>
                        {parts.join(" · ")}
                      </div>
                    )
                  })()}
                </Match>
              </Switch>
            )}
          </For>

          <Show when={sending() && !hasOutputThisTurn()}>
            <div class="flex gap-3">
              <div
                class="w-6 h-6 rounded-full items-center justify-center shrink-0 mt-0.5 hidden md:flex"
                style={{ background: "var(--surface-inset)" }}
              >
                <Bot class="w-3 h-3" style={{ color: "var(--text-strong)" }} />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: "var(--text-weak)" }}>
                  <Bot class="w-3 h-3 md:hidden" />
                  Claude
                </div>
                <div
                  class="inline-flex items-center gap-2 text-sm font-medium"
                  style={{ color: "var(--text-strong)" }}
                >
                  Thinking
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                </div>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            <div class="text-sm" style={{ color: "var(--text-critical-base)" }}>{error()}</div>
          </Show>
        </div>
      </div>

      <div class="pointer-events-none absolute bottom-6 right-6 z-10">
        <button
          type="button"
          class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-700 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
          style={{
            background: fabVivid() ? "var(--interactive-base)" : "var(--surface-inset)",
            color: fabVivid() ? "var(--text-on-interactive)" : "var(--text-weak)",
            border: "1px solid color-mix(in srgb, var(--interactive-hover) 55%, transparent)",
            opacity: fabVivid() ? 1 : 0.6,
          }}
          onMouseEnter={(e) => {
            if (fabVivid()) e.currentTarget.style.background = "var(--interactive-hover)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = fabVivid() ? "var(--interactive-base)" : "var(--surface-inset)"
          }}
          onClick={() => {
            if (pinned()) { disengagePin(); return }
            if (autoScroll.showScrollToBottom()) { autoScroll.scrollToBottom(); return }
            engagePin()
          }}
          aria-label={pinned() ? "Unlock auto-scroll" : autoScroll.showScrollToBottom() ? "Scroll to bottom" : "Lock auto-scroll to bottom"}
          title={pinned() ? "Unlock auto-scroll" : autoScroll.showScrollToBottom() ? "Scroll to bottom" : "Lock auto-scroll to bottom"}
        >
          <Show when={pinned()} fallback={
            <Show when={autoScroll.showScrollToBottom()} fallback={<LockOpen class="w-5 h-5" />}>
              <ArrowDown class="w-5 h-5" />
            </Show>
          }>
            <Lock class="w-5 h-5" />
          </Show>
        </button>
      </div>
      </div>

      <div class="px-3 md:px-4 pb-3 md:pb-4 pt-2 shrink-0" style={{ background: "var(--background-base)" }}>
        <form
          class="max-w-3xl mx-auto rounded-lg focus-within:ring-2"
          style={{
            border: "1px solid var(--border-base)",
            background: "var(--background-base)",
            "--tw-ring-color": "var(--interactive-base)",
          }}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <div class="flex items-end gap-2 px-3 py-2">
            <textarea
              ref={textareaRef}
              rows={1}
              class="flex-1 min-w-0 bg-transparent outline-none resize-none text-sm py-1.5 max-h-48"
              style={{ color: "var(--text-base)" }}
              value={input()}
              onInput={(e) => {
                setInput(e.currentTarget.value)
                autoResize()
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude Code..."
              disabled={sending()}
            />
            <Button type="submit" variant="primary" size="sm" disabled={sending() || !input().trim()}>
              <SendHorizontal class="w-4 h-4" />
            </Button>
          </div>
          <div
            class="relative flex items-center gap-2 px-2 py-1.5 text-xs sm:gap-3 sm:px-4"
            style={{ color: "var(--text-weak)", "border-top": "1px solid var(--border-base)" }}
          >
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                class="flex items-center gap-1 min-w-0 hover:opacity-80 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setShowModelPicker(true)}
                disabled={sending()}
              >
                <span class="opacity-60 shrink-0">Model:</span>
                <span class="truncate" style={{ color: "var(--text-base)" }}>{MODEL_LABELS[model()]}</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-1 min-w-0 hover:opacity-80 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setShowEffortPicker(true)}
                disabled={sending()}
              >
                <span class="opacity-60 shrink-0">Effort:</span>
                <span class="truncate" style={{ color: "var(--text-base)" }}>{EFFORT_LABELS[effort()]}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <Show when={showModelPicker()}>
        <PickerDialog
          title="Select model"
          items={Object.entries(MODEL_LABELS).map(([id, title]) => ({ id, title }))}
          onSelect={(item) => {
            selectModel(item.id)
            setShowModelPicker(false)
          }}
          onClose={() => setShowModelPicker(false)}
        />
      </Show>

      <Show when={showEffortPicker()}>
        <PickerDialog
          title="Select effort"
          items={Object.entries(EFFORT_LABELS).map(([id, title]) => ({ id, title }))}
          onSelect={(item) => {
            selectEffort(item.id)
            setShowEffortPicker(false)
          }}
          onClose={() => setShowEffortPicker(false)}
        />
      </Show>
    </div>
  )
}
