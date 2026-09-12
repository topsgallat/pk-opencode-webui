import { createSignal, For, Show, Switch, Match, onMount } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Decode } from "../utils/path"

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
 * are different (Claude SDK content blocks vs. OpenCode's session parts), so
 * this renders its own simplified transcript rather than sharing renderers.
 */
export function ClaudeSession() {
  const params = useParams<{ dir: string }>()

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
    }
  }

  return (
    <div class="flex flex-col h-screen max-w-3xl mx-auto p-4 gap-4">
      <div class="text-sm" style={{ color: "var(--text-weak)" }}>
        Claude Code — <span class="font-mono">{directory()}</span>
        <Show when={sessionId()}>
          {(id) => <span> · session {id().slice(0, 8)}</span>}
        </Show>
      </div>

      <div class="flex-1 overflow-y-auto flex flex-col gap-2">
        <For each={items()}>
          {(item) => (
            <Switch>
              <Match when={item.kind === "user"}>
                <div class="self-end rounded-lg px-3 py-2 max-w-[80%] whitespace-pre-wrap text-white" style={{ background: "var(--interactive-base)" }}>
                  {(item as { text: string }).text}
                </div>
              </Match>
              <Match when={item.kind === "assistant"}>
                <div class="self-start rounded-lg px-3 py-2 max-w-[80%] whitespace-pre-wrap" style={{ background: "var(--surface-inset)" }}>
                  {(item as { text: string }).text}
                </div>
              </Match>
              <Match when={item.kind === "tool"}>
                <div class="self-start text-xs font-mono rounded px-2 py-1 border" style={{ color: "var(--text-weak)", "border-color": "var(--border-base)" }}>
                  🔧 {(item as { name: string }).name}({JSON.stringify((item as { input: unknown }).input)})
                </div>
              </Match>
              <Match when={item.kind === "tool-result"}>
                <div
                  class="self-start text-xs font-mono rounded px-2 py-1 border whitespace-pre-wrap max-w-[80%]"
                  style={{
                    color: (item as { isError: boolean }).isError ? "var(--text-critical-base)" : "var(--text-weak)",
                    "border-color": (item as { isError: boolean }).isError ? "var(--border-critical-base, #7f1d1d)" : "var(--border-base)",
                  }}
                >
                  {(item as { text: string }).text}
                </div>
              </Match>
            </Switch>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="text-sm" style={{ color: "var(--text-critical-base)" }}>{error()}</div>
      </Show>

      <form
        class="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          class="flex-1 rounded px-3 py-2 border bg-transparent"
          style={{ "border-color": "var(--border-base)" }}
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          placeholder="Ask Claude Code..."
          disabled={sending()}
        />
        <button
          type="submit"
          class="rounded px-4 py-2 text-white disabled:opacity-50"
          style={{ background: "var(--interactive-base)" }}
          disabled={sending() || !input().trim()}
        >
          {sending() ? "..." : "Send"}
        </button>
      </form>
    </div>
  )
}
