import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { useBasePath } from "../context/base-path"
import { listLogFiles, readLogFile } from "../utils/extended-api"
import { Spinner } from "../components/ui/spinner"
import { Button } from "../components/ui/button"
import { RefreshCw, FileText } from "lucide-solid"

export function Logs() {
  const { serverUrl } = useBasePath()

  const [files, setFiles] = createSignal<string[]>([])
  const [selected, setSelected] = createSignal<string | null>(null)
  const [content, setContent] = createSignal<string | null>(null)
  const [loadingFiles, setLoadingFiles] = createSignal(true)
  const [loadingContent, setLoadingContent] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [autoRefresh, setAutoRefresh] = createSignal(false)

  async function fetchFiles() {
    setLoadingFiles(true)
    setError(null)
    const result = await listLogFiles(serverUrl)
    setFiles(result)
    setLoadingFiles(false)
    if (!selected() && result.length > 0) {
      setSelected(result[0])
    }
  }

  async function fetchContent(name: string) {
    setLoadingContent(true)
    setError(null)
    const result = await readLogFile(serverUrl, name)
    if (result === null) {
      setError(`Failed to load ${name}`)
    } else {
      setContent(result)
    }
    setLoadingContent(false)
  }

  createEffect(() => {
    fetchFiles()
  })

  createEffect(() => {
    const name = selected()
    if (name) fetchContent(name)
  })

  createEffect(() => {
    if (!autoRefresh()) return
    const name = selected()
    if (!name) return
    const timer = setInterval(() => fetchContent(name), 3000)
    onCleanup(() => clearInterval(timer))
  })

  function handleFileSelect(name: string) {
    setSelected(name)
    setContent(null)
  }

  return (
    <div
      class="flex flex-col h-full overflow-hidden"
      style={{ background: "var(--background-stronger)" }}
    >
      <div
        class="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ "border-bottom": "1px solid var(--border-base)" }}
      >
        <span class="text-sm font-medium" style={{ color: "var(--text-base)" }}>
          Server Logs
        </span>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              class="accent-current"
              checked={autoRefresh()}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            Auto-refresh
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const name = selected()
              if (name) fetchContent(name)
              else fetchFiles()
            }}
            title="Refresh"
          >
            <RefreshCw class="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div class="flex flex-1 min-h-0">
        <div
          class="w-48 shrink-0 overflow-y-auto"
          style={{ "border-right": "1px solid var(--border-base)" }}
        >
          <Show when={loadingFiles()}>
            <div class="flex items-center justify-center py-8">
              <Spinner class="w-4 h-4" />
            </div>
          </Show>
          <Show when={!loadingFiles() && files().length === 0}>
            <p class="px-3 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No log files found.
            </p>
          </Show>
          <For each={files()}>
            {(name) => (
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors truncate"
                style={{
                  background: selected() === name ? "var(--surface-inset)" : "transparent",
                  color: selected() === name ? "var(--text-interactive-base)" : "var(--text-base)",
                }}
                onClick={() => handleFileSelect(name)}
                title={name}
              >
                <FileText class="w-3 h-3 shrink-0" style={{ color: "var(--icon-weak)" }} />
                <span class="truncate">{name}</span>
              </button>
            )}
          </For>
        </div>

        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <Show when={error()}>
            <div class="px-4 py-2 text-xs" style={{ color: "var(--text-critical-base)" }}>
              {error()}
            </div>
          </Show>
          <Show when={loadingContent()}>
            <div class="flex items-center justify-center flex-1">
              <Spinner class="w-5 h-5" />
            </div>
          </Show>
          <Show when={!loadingContent() && content() !== null}>
            <pre
              class="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-all"
              style={{ color: "var(--text-base)" }}
            >
              {content()}
            </pre>
          </Show>
          <Show when={!loadingContent() && content() === null && !error() && !selected()}>
            <div class="flex items-center justify-center flex-1">
              <p class="text-sm" style={{ color: "var(--text-muted)" }}>
                Select a log file to view its contents.
              </p>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
