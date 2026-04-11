import { onMount, onCleanup, createSignal, createEffect, createMemo, Show } from "solid-js"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { Sun, Moon, Monitor, Clipboard, Copy, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-solid"
import type { ITheme } from "@xterm/xterm"

type TerminalColorScheme = "auto" | "light" | "dark"

const TERMINAL_THEME_KEY = "opencode.terminal-theme"
const PANEL_FOCUS_KEYS = new Set(["1", "2", "3", "4"])

const lightTheme: ITheme = {
  background: "#ffffff",
  foreground: "#1f2937",
  cursor: "#1f2937",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(59, 130, 246, 0.3)",
  selectionForeground: "#1f2937",
  black: "#1f2937",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f3f4f6",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
}

const darkTheme: ITheme = {
  background: "#18181b",
  foreground: "#a1a1aa",
  cursor: "#a1a1aa",
  cursorAccent: "#18181b",
  selectionBackground: "rgba(139, 92, 246, 0.3)",
  selectionForeground: "#e4e4e7",
  black: "#27272a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
}

function loadTerminalTheme(): TerminalColorScheme {
  try {
    const stored = localStorage.getItem(TERMINAL_THEME_KEY)
    if (stored === "auto" || stored === "light" || stored === "dark") return stored
  } catch {
    // localStorage may be unavailable
  }
  return "auto"
}

function saveTerminalTheme(scheme: TerminalColorScheme) {
  try {
    localStorage.setItem(TERMINAL_THEME_KEY, scheme)
  } catch {
    // Ignore persistence errors
  }
}

// Module-level shared state so all Terminal instances use the same scheme
const [terminalScheme, setTerminalSchemeRaw] = createSignal<TerminalColorScheme>(loadTerminalTheme())

const setTerminalScheme = (v: TerminalColorScheme) => {
  setTerminalSchemeRaw(v)
  saveTerminalTheme(v)
}

export interface TerminalProps {
  ptyId: string
  onClose?: () => void
}

export function Terminal(props: TerminalProps) {
  const { client, url, directory } = useSDK()
  const appTheme = useTheme()
  let container!: HTMLDivElement
  let wrapper!: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let ws: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const [status, setStatus] = createSignal<"connecting" | "connected" | "error" | "disconnected">("connecting")
  const [error, setError] = createSignal<string | null>(null)
  const [showBanner, setShowBanner] = createSignal(false)
  const [pasteMenu, setPasteMenu] = createSignal<{ x: number; y: number; hasSelection: boolean } | null>(null)

  const resolvedScheme = () => {
    const scheme = terminalScheme()
    if (scheme === "auto") return appTheme.resolved()
    return scheme
  }

  const activeTheme = createMemo(() => resolvedScheme() === "dark" ? darkTheme : lightTheme)

  function writeStatus(message: string, type: "info" | "error" | "success" = "info") {
    if (!term) return
    const colors = {
      info: "\x1b[90m", // gray
      error: "\x1b[31m", // red
      success: "\x1b[32m", // green
    }
    term.write(`${colors[type]}${message}\x1b[0m\r\n`)
  }

  function connect() {
    if (disposed || !term) return

    // Build WebSocket URL
    const wsUrl =
      url.replace(/^http/, "ws") + `/pty/${props.ptyId}/connect?directory=${encodeURIComponent(directory || "")}`
    console.log("[Terminal] Connecting to:", wsUrl)

    setStatus("connecting")
    setError(null)

    ws = new WebSocket(wsUrl)

    ws.addEventListener("open", () => {
      console.log("[Terminal] WebSocket connected")
      setStatus("connected")

      // Send initial size after connection
      if (term) {
        client.pty
          .update({
            ptyID: props.ptyId,
            size: { cols: term.cols, rows: term.rows },
          })
          .then(() => {
            console.log("[Terminal] Size updated:", term?.cols, "x", term?.rows)
          })
          .catch((e) => {
            console.error("[Terminal] Failed to update size:", e)
            writeStatus(`Warning: Failed to update terminal size: ${e.message || e}`, "error")
          })
      }
    })

    ws.addEventListener("message", (event) => {
      term?.write(event.data)
    })

    ws.addEventListener("error", (e) => {
      console.error("[Terminal] WebSocket error:", e)
      setStatus("error")
      setError("WebSocket connection error")
      setShowBanner(true)
      writeStatus("WebSocket error - check browser console for details", "error")
    })

    ws.addEventListener("close", (event) => {
      console.log("[Terminal] WebSocket closed:", event.code, event.reason)
      setStatus("disconnected")

      if (event.code === 1000) {
        writeStatus("Connection closed normally", "info")
      } else if (event.code === 1006) {
        writeStatus(`Connection lost (code: ${event.code}) - server may have closed the PTY`, "error")
      } else {
        writeStatus(`Connection closed: code=${event.code}, reason=${event.reason || "unknown"}`, "error")
      }

      // Reconnect on abnormal close (but not if we're disposing)
      if (!disposed && event.code !== 1000) {
        console.log("[Terminal] Scheduling reconnect...")
        writeStatus("Reconnecting in 2 seconds...", "info")
        reconnectTimer = setTimeout(() => connect(), 2000)
      }
    })
  }

  onMount(() => {
    console.log("[Terminal] Mounting, ptyId:", props.ptyId)

    // Create terminal with current theme
    term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: activeTheme(),
      scrollback: 10000,
    })

    // Add fit addon
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // Open terminal in container
    term.open(container)
    console.log("[Terminal] Terminal opened in container")

    // Let plain Ctrl+1-4 pass through to the browser for panel focus shortcuts
    // Exclude AltGr (reports as Ctrl+Alt) to avoid breaking locale-specific input
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && PANEL_FOCUS_KEYS.has(event.key))
        return false
      return true
    })

    // Show initializing message
    writeStatus("Initializing terminal...", "info")

    // Send terminal input to WebSocket
    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    // Handle resize
    term.onResize((size) => {
      console.log("[Terminal] Resize:", size.cols, "x", size.rows)
      if (ws?.readyState === WebSocket.OPEN) {
        client.pty
          .update({
            ptyID: props.ptyId,
            size: { cols: size.cols, rows: size.rows },
          })
          .catch(() => {})
      }
    })

    // Delay fit and connect to ensure container is properly sized
    setTimeout(() => {
      if (fitAddon && container.offsetWidth > 0 && container.offsetHeight > 0) {
        console.log("[Terminal] Container size:", container.offsetWidth, "x", container.offsetHeight)
        fitAddon.fit()
        console.log("[Terminal] Terminal size after fit:", term?.cols, "x", term?.rows)
      } else {
        console.warn("[Terminal] Container has no size yet")
        writeStatus("Warning: Terminal container has no size yet", "error")
      }
      connect()
    }, 100)

    // Window resize handler
    const handleResize = () => {
      if (fitAddon && container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit()
      }
    }
    window.addEventListener("resize", handleResize)

    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setTimeout(() => fitAddon?.fit(), 10)
        }
      }
    })
    resizeObserver.observe(container)

    // Focus terminal
    term.focus()

    let longPressTimer: ReturnType<typeof setTimeout> | undefined
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      longPressTimer = setTimeout(() => {
        const rect = wrapper.getBoundingClientRect()
        const hasSelection = !!(term?.getSelection())
        setPasteMenu({ x: touch.clientX - rect.left, y: touch.clientY - rect.top, hasSelection })
      }, 500)
    }
    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = undefined
      }
    }
    wrapper.addEventListener("touchstart", handleTouchStart, { passive: true })
    wrapper.addEventListener("touchend", cancelLongPress, { passive: true })
    wrapper.addEventListener("touchmove", cancelLongPress, { passive: true })

    const dismissPasteMenu = (e: TouchEvent) => {
      const btn = (e.target as Element).closest("button[data-terminal-action]")
      if (!btn) setPasteMenu(null)
    }
    document.addEventListener("touchstart", dismissPasteMenu, { passive: true })

    // Reactively update xterm theme when resolved scheme changes
    createEffect(() => {
      const theme = activeTheme()
      if (!term) return
      term.options.theme = theme
    })

    onCleanup(() => {
      console.log("[Terminal] Cleaning up")
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (longPressTimer) clearTimeout(longPressTimer)
      window.removeEventListener("resize", handleResize)
      resizeObserver.disconnect()
      wrapper.removeEventListener("touchstart", handleTouchStart)
      wrapper.removeEventListener("touchend", cancelLongPress)
      wrapper.removeEventListener("touchmove", cancelLongPress)
      document.removeEventListener("touchstart", dismissPasteMenu)
      ws?.close()
      term?.dispose()
    })
  })

  const schemes: TerminalColorScheme[] = ["auto", "light", "dark"]

  const cycleScheme = () => {
    const current = terminalScheme()
    const idx = schemes.indexOf(current)
    setTerminalScheme(schemes[(idx + 1) % schemes.length])
  }

  const schemeLabel = () => {
    const s = terminalScheme()
    if (s === "auto") return "Auto"
    if (s === "light") return "Light"
    return "Dark"
  }

  const pasteFromClipboard = async () => {
    setPasteMenu(null)
    const text = await navigator.clipboard.readText().catch(() => null)
    if (text && ws?.readyState === WebSocket.OPEN) ws.send(text)
  }

  const copySelection = async () => {
    const text = term?.getSelection()
    setPasteMenu(null)
    if (text) await navigator.clipboard.writeText(text).catch(() => null)
  }

  const sendKey = (seq: string) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(seq)
  }

  return (
    <div class="size-full flex flex-col" style={{ "min-height": "100px" }}>
      <Show when={showBanner()}>
        <div role="alert" class="bg-red-600 text-white px-3 py-2 flex items-center justify-between">
          <div class="text-sm">Terminal connection error. Some features may be unavailable.</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="underline text-sm"
              onClick={() => {
                setShowBanner(false)
                setError(null)
              }}
            >
              Dismiss
            </button>
            <button
              type="button"
              class="bg-white text-red-600 px-2 py-1 rounded text-sm"
              onClick={() => {
                setShowBanner(false)
                setError(null)
                setStatus("connecting")
                try {
                  ws?.close()
                } catch {}
                connect()
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </Show>
      {/* Theme toggle */}
      <div
        class="flex items-center justify-end px-2 py-0.5 shrink-0"
        style={{ background: activeTheme().background }}
      >
        <button
          type="button"
          onClick={cycleScheme}
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors opacity-60 hover:opacity-100"
          style={{ color: activeTheme().foreground }}
          title={`Terminal theme: ${schemeLabel()} (click to cycle)`}
          aria-label={`Terminal theme: ${schemeLabel()}`}
        >
          {terminalScheme() === "auto" && <Monitor class="w-3 h-3" />}
          {terminalScheme() === "light" && <Sun class="w-3 h-3" />}
          {terminalScheme() === "dark" && <Moon class="w-3 h-3" />}
          <span>{schemeLabel()}</span>
        </button>
      </div>

      <div
        class="flex items-center justify-center gap-2 px-2 py-1 shrink-0 md:hidden"
        style={{ background: activeTheme().background }}
      >
        {([
          ["Left", "\x1b[D", ChevronLeft],
          ["Up", "\x1b[A", ChevronUp],
          ["Down", "\x1b[B", ChevronDown],
          ["Right", "\x1b[C", ChevronRight],
        ] as const).map(([label, seq, Icon]) => (
          <button
            type="button"
            class="flex items-center justify-center w-10 h-10 rounded opacity-70 active:opacity-100 active:scale-95 transition-all select-none"
            style={{ color: activeTheme().foreground, background: activeTheme().background === "#ffffff" ? "#f3f4f6" : "#27272a" }}
            onTouchStart={(e) => { e.preventDefault(); sendKey(seq) }}
            onClick={() => sendKey(seq)}
            aria-label={label}
          >
            <Icon class="w-5 h-5" />
          </button>
        ))}
      </div>

      <div
        ref={wrapper}
        class="flex-1 relative"
        style={{
          background: activeTheme().background,
          padding: "0 8px 8px 8px",
          "min-height": "0",
        }}
      >
        <div ref={container} class="size-full" style={{ "min-height": "0" }} />
        <Show when={pasteMenu()}>
          {(pos) => (
            <div
              class="absolute z-50 flex rounded-lg overflow-hidden shadow-lg text-sm font-medium"
              style={{
                left: `${pos().x}px`,
                top: `${pos().y}px`,
                transform: "translate(-50%, -110%)",
              }}
            >
              <Show when={pos().hasSelection}>
                <button
                  type="button"
                  data-terminal-action="copy"
                  class="flex items-center gap-1.5 px-3 py-1.5"
                  style={{
                    background: activeTheme().background === "#ffffff" ? "#1f2937" : "#e4e4e7",
                    color: activeTheme().background === "#ffffff" ? "#f3f4f6" : "#18181b",
                  }}
                  onClick={copySelection}
                  onTouchEnd={(e) => { e.preventDefault(); copySelection() }}
                >
                  <Copy class="w-3.5 h-3.5" />
                  Copy
                </button>
              </Show>
              <button
                type="button"
                data-terminal-action="paste"
                class="flex items-center gap-1.5 px-3 py-1.5"
                style={{
                  background: activeTheme().background === "#ffffff" ? "#374151" : "#d4d4d8",
                  color: activeTheme().background === "#ffffff" ? "#f3f4f6" : "#18181b",
                }}
                onClick={pasteFromClipboard}
                onTouchEnd={(e) => { e.preventDefault(); pasteFromClipboard() }}
              >
                <Clipboard class="w-3.5 h-3.5" />
                Paste
              </button>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
