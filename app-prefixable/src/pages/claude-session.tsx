import { createSignal, createEffect, For, Show, Switch, Match, onMount } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { ArrowLeft, Bot, SendHorizontal } from "lucide-solid"
import { base64Decode } from "../utils/path"
import { getFilename } from "../components/shared"
import { Markdown } from "../components/markdown"
import { Button } from "../components/ui/button"
import { useDevice } from "../context/device"

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "tool-result"; text: string; isError: boolean }

function sessionStorageKey(dir: string) {
  return `claude.session.${dir}`
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
  const [error, setError] = createSignal<string | undefined>(undefined)

  let textareaRef: HTMLTextAreaElement | undefined
  let scrollRef: HTMLDivElement | undefined

  onMount(() => {
    const dir = directory()
    if (!dir) return
    try {
      const saved = localStorage.getItem(sessionStorageKey(dir))
      if (saved) setSessionId(saved)
    } catch {
      // localStorage unavailable — session simply won't resume across reloads
    }
  })

  createEffect(() => {
    items()
    queueMicrotask(() => scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: "smooth" }))
  })

  function autoResize() {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  function appendAssistantText(text: string) {
    if (!text) return
    setItems((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.kind === "assistant") {
        return [...prev.slice(0, -1), { kind: "assistant", text: last.text + text }]
      }
      return [...prev, { kind: "assistant", text }]
    })
  }

  function handleEvent(evt: Record<string, unknown>) {
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
      for (const block of inner.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          appendAssistantText(block.text)
        } else if (block.type === "tool_use") {
          setItems((prev) => [...prev, { kind: "tool", name: String(block.name), input: block.input }])
        }
      }
      return
    }

    if (evt.type === "user" && inner && Array.isArray(inner.content)) {
      for (const block of inner.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result") {
          setItems((prev) => [
            ...prev,
            { kind: "tool-result", text: toolResultText(block.content), isError: !!block.is_error },
          ])
        }
      }
      return
    }

    if (evt.type === "result" && evt.subtype && evt.subtype !== "success") {
      setError(`Session ended: ${String(evt.subtype)}`)
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
    setError(undefined)

    try {
      const res = await fetch("api/claude/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: dir, prompt, sessionId: sessionId() }),
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
    <div class="flex flex-col h-screen" style={{ background: "var(--background-base)" }}>
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
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto px-3 md:px-4 py-4">
        <div class="max-w-3xl mx-auto flex flex-col gap-4">
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
                  <div
                    class="ml-0 md:ml-9 text-xs font-mono rounded-lg px-3 py-2 border break-all"
                    style={{ color: "var(--text-weak)", "border-color": "var(--border-base)", background: "var(--surface-inset)" }}
                  >
                    🔧 {(item as { name: string }).name}
                    <span class="opacity-70"> {JSON.stringify((item as { input: unknown }).input)}</span>
                  </div>
                </Match>

                <Match when={item.kind === "tool-result"}>
                  <div
                    class="ml-0 md:ml-9 text-xs font-mono rounded-lg px-3 py-2 border whitespace-pre-wrap max-h-48 overflow-y-auto"
                    style={{
                      color: (item as { isError: boolean }).isError ? "var(--text-critical-base)" : "var(--text-weak)",
                      "border-color": "var(--border-base)",
                    }}
                  >
                    {(item as { text: string }).text}
                  </div>
                </Match>
              </Switch>
            )}
          </For>

          <Show when={error()}>
            <div class="text-sm" style={{ color: "var(--text-critical-base)" }}>{error()}</div>
          </Show>
        </div>
      </div>

      <div class="px-3 md:px-4 pb-3 md:pb-4 pt-2 shrink-0" style={{ background: "var(--background-base)" }}>
        <form
          class="max-w-3xl mx-auto flex items-end gap-2 rounded-lg px-3 py-2 focus-within:ring-2"
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
        </form>
      </div>
    </div>
  )
}
