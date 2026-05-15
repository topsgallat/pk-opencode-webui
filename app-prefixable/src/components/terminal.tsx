import { onMount, onCleanup, createSignal, createEffect, createMemo, Show } from "solid-js"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useClientAuth } from "../context/client-auth"
import { appendTargetParam } from "../utils/path"
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
  const { client, url, directory, targetUrl } = useSDK()
  const auth = useClientAuth()
  const appTheme = useTheme()
  let container!: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let ws: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const [status, setStatus] = createSignal<"connecting" | "connected" | "error" | "disconnected">("connecting")
  const [error, setError] = createSignal<string | null>(null)
  const [showBanner, setShowBanner] = createSignal(false)
  const [ctrlActive, setCtrlActive] = createSignal(false)
  const [hasSelection, setHasSelection] = createSignal(false)
  const [selMode, setSelMode] = createSignal(false)

  const resolvedScheme = () => {
    const scheme = terminalScheme()
    if (scheme === "auto") return appTheme.resolved()
    return scheme
  }

  const activeTheme = createMemo(() => resolvedScheme() === "dark" ? darkTheme : lightTheme)
  const btnBg = () => activeTheme().background === "#ffffff" ? "#f3f4f6" : "#27272a"

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
    if (!auth.canReconnect()) {
      setStatus("error")
      setError("Authentication required for selected server")
      setShowBanner(true)
      writeStatus("Authentication required before terminal reconnect", "error")
      return
    }

    // Build WebSocket URL
    const wsBase = url.replace(/^http/, "ws")
    const wsUrl = appendTargetParam(
      `${wsBase}/pty/${props.ptyId}/connect?directory=${encodeURIComponent(directory || "")}`,
      targetUrl,
    )
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

      if (event.code === 1008 || event.code === 4401 || event.code === 4403) {
        auth.markFailure({ scope: "pty-connect", status: event.code, message: event.reason || `WebSocket close ${event.code}` })
        return
      }

      if (event.code === 1000) {
        writeStatus("Connection closed normally", "info")
      } else if (event.code === 1006) {
        writeStatus(`Connection lost (code: ${event.code}) - server may have closed the PTY`, "error")
      } else {
        writeStatus(`Connection closed: code=${event.code}, reason=${event.reason || "unknown"}`, "error")
      }

      // Reconnect on abnormal close (but not if we're disposing)
      if (!disposed && event.code !== 1000) {
        if (!auth.canReconnect()) return
        console.log("[Terminal] Scheduling reconnect...")
        writeStatus("Reconnecting in 2 seconds...", "info")
        reconnectTimer = setTimeout(() => {
          if (!auth.canReconnect()) return
          connect()
        }, 2000)
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

    // Let plain Ctrl+1-4 pass through to the browser for panel focus shortcuts.
    // Exclude AltGr (reports as Ctrl+Alt) to avoid breaking locale-specific input.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      if (event.ctrlKey && !event.altKey && !event.metaKey && PANEL_FOCUS_KEYS.has(event.key))
        return false
      // Ctrl+Shift+C: always intercept — stops browser DevTools, copies if selection
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === "C") {
        const sel = term?.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => {})
        return false
      }
      // Ctrl+C (no Shift): copy if selection, otherwise send SIGINT
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === "c") {
        const sel = term?.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {})
          return false
        }
      }
      return true
    })
    // Capture-phase listener to prevent browser DevTools on Ctrl+Shift+C
    const preventDevTools = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
        e.preventDefault()
      }
    }
    container.addEventListener("keydown", preventDevTools, { capture: true })

    // Show initializing message
    writeStatus("Initializing terminal...", "info")

    // Send terminal input to WebSocket
    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        if (ctrlActive() && data.length === 1) {
          setCtrlActive(false)
          const code = data.toUpperCase().charCodeAt(0) & 0x1f
          ws.send(String.fromCharCode(code))
        } else {
          ws.send(data)
        }
      }
    })

    // Track selection changes for Copy button state
    term.onSelectionChange(() => {
      setHasSelection(!!(term?.getSelection()))
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
      window.removeEventListener("resize", handleResize)
      resizeObserver.disconnect()
      container.removeEventListener("keydown", preventDevTools, { capture: true })
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
    const text = await navigator.clipboard.readText().catch(() => null)
    if (text && ws?.readyState === WebSocket.OPEN) ws.send(text)
    term?.focus()
  }

  const copySelection = async () => {
    if (selMode()) {
      const native = window.getSelection()?.toString()
      if (native) await navigator.clipboard.writeText(native).catch(() => null)
      setSelMode(false)
      term?.focus()
      return
    }
    const text = term?.getSelection()
    if (text) await navigator.clipboard.writeText(text).catch(() => null)
    term?.focus()
  }

  const sendKey = (seq: string) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(seq)
  }

  const readBuffer = () => {
    if (!term) return []
    const buf = term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? "")
    }
    return lines
  }

  const toggleSelMode = () => {
    const next = !selMode()
    setSelMode(next)
    if (!next) term?.focus()
  }

  const overlayHasSelection = () => !!(selMode() && window.getSelection()?.toString())

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
        <button
          type="button"
          class="flex items-center justify-center h-10 px-3 rounded text-xs font-mono font-bold transition-all select-none"
          style={{
            color: ctrlActive() ? (activeTheme().background === "#ffffff" ? "#2563eb" : "#60a5fa") : activeTheme().foreground,
            background: ctrlActive()
              ? (activeTheme().background === "#ffffff" ? "#dbeafe" : "#1e3a5f")
              : btnBg(),
            outline: ctrlActive() ? "2px solid currentColor" : "none",
          }}
          onTouchEnd={(e) => { e.preventDefault(); setCtrlActive(v => !v); term?.focus() }}
          onClick={() => { setCtrlActive(v => !v); term?.focus() }}
          aria-label="Ctrl"
          aria-pressed={ctrlActive()}
        >
          Ctrl
        </button>
        <button
          type="button"
          class="flex items-center justify-center h-10 px-3 rounded text-xs font-mono font-bold transition-all select-none"
          style={{ color: activeTheme().foreground, background: btnBg() }}
          onTouchEnd={(e) => { e.preventDefault(); sendKey("\t") }}
          onClick={() => sendKey("\t")}
          aria-label="Tab"
        >
          Tab
        </button>
        <button
          type="button"
          class="flex items-center justify-center h-10 px-3 rounded text-xs font-mono font-bold transition-all select-none"
          style={{
            color: selMode() ? (activeTheme().background === "#ffffff" ? "#2563eb" : "#60a5fa") : activeTheme().foreground,
            background: selMode()
              ? (activeTheme().background === "#ffffff" ? "#dbeafe" : "#1e3a5f")
              : btnBg(),
            outline: selMode() ? "2px solid currentColor" : "none",
          }}
          onTouchEnd={(e) => { e.preventDefault(); toggleSelMode() }}
          onClick={toggleSelMode}
          aria-label="Selection mode"
          aria-pressed={selMode()}
        >
          Sel
        </button>
        {([
          ["Left", "\x1b[D", ChevronLeft],
          ["Up", "\x1b[A", ChevronUp],
          ["Down", "\x1b[B", ChevronDown],
          ["Right", "\x1b[C", ChevronRight],
        ] as const).map(([label, seq, Icon]) => (
          <button
            type="button"
            class="flex items-center justify-center w-10 h-10 rounded opacity-70 active:opacity-100 active:scale-95 transition-all select-none"
            style={{ color: activeTheme().foreground, background: btnBg() }}
            onTouchStart={(e) => { e.preventDefault(); sendKey(seq) }}
            onClick={() => sendKey(seq)}
            aria-label={label}
          >
            <Icon class="w-5 h-5" />
          </button>
        ))}
        <button
          type="button"
          class="flex items-center justify-center w-10 h-10 rounded transition-all select-none"
          style={{
            color: activeTheme().foreground,
            background: btnBg(),
            opacity: (hasSelection() || overlayHasSelection()) ? "1" : "0.35",
          }}
          onTouchEnd={(e) => { e.preventDefault(); copySelection() }}
          onClick={copySelection}
          aria-label="Copy"
          disabled={!hasSelection() && !overlayHasSelection()}
        >
          <Copy class="w-5 h-5" />
        </button>
        <button
          type="button"
          class="flex items-center justify-center w-10 h-10 rounded opacity-70 active:opacity-100 active:scale-95 transition-all select-none"
          style={{ color: activeTheme().foreground, background: btnBg() }}
          onTouchEnd={(e) => { e.preventDefault(); pasteFromClipboard() }}
          onClick={pasteFromClipboard}
          aria-label="Paste"
        >
          <Clipboard class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 relative" style={{ "min-height": "0" }}>
        <div
          ref={container}
          class="size-full"
          style={{
            background: activeTheme().background,
            padding: "0 8px 8px 8px",
            "min-height": "0",
          }}
        />
        <Show when={selMode()}>
          <div
            class="absolute inset-0 overflow-auto z-10 px-2 py-2 font-mono text-sm whitespace-pre leading-5"
            style={{
              background: activeTheme().background,
              color: activeTheme().foreground,
              "font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              "font-size": "14px",
              "-webkit-user-select": "text",
              "user-select": "text",
            }}
          >
            {readBuffer().join("\n")}
          </div>
        </Show>
      </div>
    </div>
  )
}
