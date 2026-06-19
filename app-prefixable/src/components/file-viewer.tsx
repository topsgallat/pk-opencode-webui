import { createSignal, createEffect, Show, Match, Switch, createMemo, onCleanup, For } from "solid-js"
import { Portal } from "solid-js/web"
import { useFile } from "../context/file"
import { useSDK } from "../context/sdk"
import { useBasePath } from "../context/base-path"
import { useServer } from "../context/server"
import { useDevice } from "../context/device"
import { Spinner } from "./ui/spinner"
import { FileCode, Pencil, Eye, Maximize2, X, MessageSquarePlus, Download } from "lucide-solid"
import { writeFile } from "../utils/extended-api"
import { getServerCapabilities } from "../utils/server-capabilities"
import { EditorDialog } from "./editor-dialog"
import { Markdown } from "./markdown"

interface FileViewerProps {
  path: string
  onMentionFile?: (path: string) => void
  onMentionFileLine?: (path: string, selection: { startLine: number; endLine: number }) => void
}

function getLanguage(path: string) {
  const idx = path.lastIndexOf("/")
  const filename = idx === -1 ? path : path.slice(idx + 1)
  const lower = filename.toLowerCase()

  if (lower === "dockerfile") return "dockerfile"
  if (lower === "makefile") return "makefile"

  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript"
    case "js":
    case "jsx":
      return "javascript"
    case "py":
      return "python"
    case "go":
      return "go"
    case "rs":
      return "rust"
    case "md":
      return "markdown"
    case "json":
      return "json"
    case "css":
      return "css"
    case "html":
      return "html"
    case "yaml":
    case "yml":
      return "yaml"
    case "sh":
    case "bash":
      return "bash"
    case "sql":
      return "sql"
    case "toml":
      return "toml"
    case "xml":
      return "xml"
    case "java":
      return "java"
    case "c":
      return "c"
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp"
    case "h":
    case "hpp":
      return "cpp"
    case "rb":
      return "ruby"
    case "php":
      return "php"
    case "swift":
      return "swift"
    case "kt":
    case "kts":
      return "kotlin"
    case "scala":
      return "scala"
    case "vue":
      return "vue"
    case "svelte":
      return "svelte"
    case "dockerfile":
      return "dockerfile"
    default:
      return undefined
  }
}

function normalizePath(path: string) {
  const absolute = path.startsWith("/")
  const stack: string[] = []

  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      stack.pop()
      continue
    }
    stack.push(part)
  }

  return `${absolute ? "/" : ""}${stack.join("/")}`
}

function blobFromContent(content: string, type: string, encoding?: string) {
  if (encoding === "base64") {
    return new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type })
  }

  return new Blob([content], { type })
}

export function FileViewer(props: FileViewerProps) {
  const file = useFile()
  const sdk = useSDK()
  const basePath = useBasePath()
  const server = useServer()
  const device = useDevice()
  const capabilities = () => getServerCapabilities(server.selectedServer())

  const [isEditing, setIsEditing] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  // Bug #7: Explicit signals for file content reactivity
  const [fileLoading, setFileLoading] = createSignal(false)
  const [fileLoaded, setFileLoaded] = createSignal(false)
  const [fileError, setFileError] = createSignal<string | undefined>(undefined)
  const [fileContent, setFileContent] = createSignal("")
  const [isBinary, setIsBinary] = createSignal(false)
  const [imageUrl, setImageUrl] = createSignal<string | undefined>(undefined)
  const [isImage, setIsImage] = createSignal(false)
  const [isPdf, setIsPdf] = createSignal(false)
  const [pdfUrl, setPdfUrl] = createSignal<string | undefined>(undefined)

  const lang = createMemo(() => getLanguage(props.path))
  const isMarkdown = createMemo(() => lang() === "markdown")
  const isHtml = createMemo(() => lang() === "html")
  const [markdownPreview, setMarkdownPreview] = createSignal(true)
  const [htmlPreview, setHtmlPreview] = createSignal(true)
  const [htmlAllowJs, setHtmlAllowJs] = createSignal(false)
  const [fullscreenPreview, setFullscreenPreview] = createSignal(false)
  let fullscreenRef: HTMLDivElement | undefined
  const htmlBlobUrl = createMemo(() => {
    if (!isHtml() || !fileContent()) return undefined
    const blob = new Blob([fileContent()], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    onCleanup(() => URL.revokeObjectURL(url))
    return url
  })
  const htmlSandbox = createMemo(() => (htmlAllowJs() ? "allow-scripts" : ""))
  const sourceLines = createMemo(() => fileContent().split("\n"))
  const lineButtonClass = () =>
    device.isTouchDevice()
      ? "opacity-100 transition-opacity p-1 rounded min-h-[28px] min-w-[28px] flex items-center justify-center"
      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity p-1 rounded min-h-[28px] min-w-[28px] flex items-center justify-center"
  const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

  createEffect(() => {
    const path = props.path
    if (!path) return

    setHtmlAllowJs(false)

    const s = file.get(path)
    const loading = !!s?.loading
    const loaded = !!s?.loaded
    const error = s?.error
    const content = s?.content?.content ?? ""
    const isBin = s?.content?.type === "binary"
    const mime = s?.content?.mimeType
    const img = s?.content?.encoding === "base64" && mime && SAFE_IMAGE_TYPES.has(mime)
    const pdf = mime === "application/pdf" || path.toLowerCase().endsWith(".pdf")

    setFileLoading(loading)
    setFileLoaded(loaded)
    setFileError(error)
    setFileContent(content)
    setIsBinary(isBin)
    setIsImage(!!img)
    setIsPdf(pdf)
    if (img) {
      setImageUrl(`data:${mime};base64,${s?.content?.content}`)
    } else {
      setImageUrl(undefined)
    }

    if (pdf && content) {
      const type = mime || "application/pdf"
      const blob = blobFromContent(content, type, s?.content?.encoding)
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      onCleanup(() => URL.revokeObjectURL(url))
    } else {
      setPdfUrl(undefined)
    }

    if (!loaded && !loading) {
      void file.load(path)
    }
  })

  createEffect(() => {
    if (!fullscreenPreview()) return
    const active = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setFullscreenPreview(false)
        return
      }

      if (e.key !== "Tab" || !fullscreenRef) return

      const focusable = fullscreenRef.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable.length) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
        return
      }

      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handler)
    setTimeout(() => {
      fullscreenRef?.querySelector<HTMLElement>("button")?.focus()
    }, 0)
    onCleanup(() => document.removeEventListener("keydown", handler))
    onCleanup(() => {
      document.body.style.overflow = overflow
      active?.focus?.()
    })
  })

  // Bug #8: Save Path
  async function handleSave(newContent: string) {
    if (!capabilities().canUseLocalExtFileOps) {
      setSaveError("Saving files directly is available only for the local OpenCode backend.")
      return
    }
    const fullPath = normalizePath(sdk.directory && !props.path.startsWith("/") ? `${sdk.directory}/${props.path}` : props.path)
    const root = sdk.directory ? normalizePath(sdk.directory) : undefined

    if (root && fullPath !== root && !fullPath.startsWith(`${root}/`)) {
      setSaveError("Invalid file path.")
      return
    }

    setSaveError(null)
    const success = await writeFile(basePath.serverUrl, fullPath, newContent)
    if (success) {
      // Force reload content locally so it updates
      file.setContent(props.path, newContent)
      setIsEditing(false)
    } else {
      setSaveError("Failed to save file.")
      // In a real app, maybe show a toast
      console.error("Save failed for", fullPath)
    }
  }

  async function handleDownload() {
    const data = await file.downloadFile(props.path)
    if (!data) {
      setSaveError("Failed to download file.")
      return
    }

    const type = data.mimeType || (data.type === "binary" ? "application/octet-stream" : "text/plain;charset=utf-8")
    const blob = blobFromContent(data.content, type, data.encoding)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = data.name || props.path.split("/").pop() || "download"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div class="flex-1 overflow-auto min-h-0 relative">
      <Switch>
        <Match when={fileLoading()}>
          <div class="flex items-center justify-center gap-2 p-8">
            <Spinner class="w-4 h-4" />
            <span class="text-xs" style={{ color: "var(--text-weak)" }}>
              Loading file...
            </span>
          </div>
        </Match>
        <Match when={fileError()}>
          {(err) => (
            <div class="flex flex-col items-center justify-center h-full text-center px-4">
              <FileCode class="w-8 h-8 mb-2" style={{ color: "var(--icon-critical-base)", opacity: 0.5 }} />
              <span class="text-xs" style={{ color: "var(--text-weak)" }}>
                {err()}
              </span>
            </div>
          )}
        </Match>
        <Match when={fileLoaded() && isImage()}>
          <div class="p-4 flex justify-center">
            <img src={imageUrl()} alt={props.path} class="max-w-full max-h-[60vh]" />
          </div>
        </Match>
        <Match when={fileLoaded() && isPdf()}>
          <div class="p-2">
            <div class="rounded overflow-hidden flex flex-col" style={{ border: "1px solid var(--border-base)" }}>
              <div
                class="px-3 py-1.5 text-xs flex justify-between items-center shrink-0"
                style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}
              >
                <div class="truncate flex-1 min-w-0 pr-2">{props.path}</div>
                <div class="flex items-center gap-1 shrink-0 flex-nowrap">
                  <button
                    class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                    onClick={() => setFullscreenPreview(true)}
                    title="Fullscreen Preview"
                    aria-label="Fullscreen Preview"
                    style={{ color: "var(--text-base)" }}
                  >
                    <Maximize2 class="w-3.5 h-3.5" />
                  </button>
                  <Show when={capabilities().canUseLocalExtFileOps}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                      onClick={() => setIsEditing(true)}
                      title="Edit File"
                      aria-label="Edit File"
                      style={{ color: "var(--text-base)" }}
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                  <button
                    class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                    onClick={() => void handleDownload()}
                    title="Download File"
                    aria-label="Download File"
                    style={{ color: "var(--text-base)" }}
                  >
                    <Download class="w-3.5 h-3.5" />
                  </button>
                  <Show when={props.onMentionFile}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                      onClick={() => props.onMentionFile?.(props.path)}
                      title="Mention in prompt"
                      aria-label="Mention in prompt"
                      style={{ color: "var(--text-base)" }}
                    >
                      <MessageSquarePlus class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto min-h-0">
                <iframe
                  src={pdfUrl()}
                  class="w-full border-0"
                  style={{ height: "calc(100vh - 120px)", background: "var(--background-base)" }}
                  title="PDF preview"
                />
              </div>
            </div>
          </div>
        </Match>
        <Match when={fileLoaded() && isBinary()}>
          <div class="flex flex-col items-center justify-center h-full text-center px-4">
            <FileCode class="w-8 h-8 mb-2" style={{ color: "var(--icon-weak)", opacity: 0.3 }} />
            <div class="text-xs" style={{ color: "var(--text-weak)" }}>
              Binary file cannot be displayed
            </div>
          </div>
        </Match>
        <Match when={fileLoaded()}>
          <div class="p-2">
            <div class="rounded overflow-hidden flex flex-col" style={{ border: "1px solid var(--border-base)" }}>
              <div
                class="px-3 py-1.5 text-xs flex justify-between items-center shrink-0"
                style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}
              >
                <div class="truncate flex-1 min-w-0 pr-2">{props.path}</div>
                <div class="flex items-center gap-1 shrink-0 flex-nowrap">
                  <Show when={isMarkdown()}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center gap-1"
                      onClick={() => setMarkdownPreview(!markdownPreview())}
                      title={markdownPreview() ? "Switch to source" : "Switch to preview"}
                      aria-label={markdownPreview() ? "Switch to source" : "Switch to preview"}
                      style={{ color: "var(--text-base)" }}
                    >
                      <Show when={markdownPreview()} fallback={<Eye class="w-3.5 h-3.5" />}>
                        <FileCode class="w-3.5 h-3.5" />
                      </Show>
                    </button>
                  </Show>
                  <Show when={isHtml()}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center gap-1"
                      onClick={() => setHtmlPreview(!htmlPreview())}
                      title={htmlPreview() ? "Switch to source" : "Switch to preview"}
                      aria-label={htmlPreview() ? "Switch to source" : "Switch to preview"}
                      style={{ color: "var(--text-base)" }}
                    >
                      <Show when={htmlPreview()} fallback={<Eye class="w-3.5 h-3.5" />}>
                        <FileCode class="w-3.5 h-3.5" />
                      </Show>
                    </button>
                  </Show>
                  <Show when={isHtml()}>
                    <button
                      classList={{
                        "p-1 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center text-[10px] font-mono border": true,
                        "hover:bg-black/5 dark:hover:bg-white/5": !htmlAllowJs(),
                        "bg-black/10 dark:bg-white/10": htmlAllowJs(),
                      }}
                      onClick={() => setHtmlAllowJs(!htmlAllowJs())}
                      title={htmlAllowJs() ? "Disable JavaScript in HTML preview" : "Enable JavaScript in HTML preview"}
                      aria-label={htmlAllowJs() ? "Disable JavaScript in HTML preview" : "Enable JavaScript in HTML preview"}
                      aria-pressed={htmlAllowJs()}
                      style={{ color: "var(--text-base)", borderColor: "var(--border-base)" }}
                    >
                      JS
                    </button>
                  </Show>
                    <Show when={fileLoaded() && (!isBinary() || isPdf()) && !isImage()}>
                      <button
                        class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                        onClick={() => setFullscreenPreview(true)}
                      title="Fullscreen Preview"
                      aria-label="Fullscreen Preview"
                      style={{ color: "var(--text-base)" }}
                    >
                      <Maximize2 class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                  <Show when={capabilities().canUseLocalExtFileOps}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                      onClick={() => setIsEditing(true)}
                      title="Edit File"
                      aria-label="Edit File"
                      style={{ color: "var(--text-base)" }}
                    >
                      <Pencil class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                  <Show when={fileLoaded()}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                      onClick={() => void handleDownload()}
                      title="Download File"
                      aria-label="Download File"
                      style={{ color: "var(--text-base)" }}
                    >
                      <Download class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                  <Show when={props.onMentionFile}>
                    <button
                      class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center"
                      onClick={() => props.onMentionFile?.(props.path)}
                      title="Mention in prompt"
                      aria-label="Mention in prompt"
                      style={{ color: "var(--text-base)" }}
                    >
                      <MessageSquarePlus class="w-3.5 h-3.5" />
                    </button>
                  </Show>
                </div>
              </div>
              <div class="overflow-x-auto min-h-0">
                <Show when={fileContent()} fallback={<div class="p-4 text-xs" style={{ color: "var(--text-weak)" }}>Empty file</div>}>
                  <Show
                    when={isMarkdown() && markdownPreview()}
                    fallback={
                      <Show
                        when={isHtml() && htmlPreview()}
                      fallback={
                        <div class="p-4 overflow-auto">
                          <div class="font-mono text-xs leading-6 whitespace-pre" style={{ color: "var(--text-base)" }}>
                              <For each={sourceLines()}>
                                {(line, index) => {
                                  const num = () => index() + 1
                                  return (
                                    <div class="group flex min-w-max rounded-sm px-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                                      <div class="min-h-[1.5rem] flex-1 pr-3">
                                        {line || " "}
                                      </div>
                                        <Show when={props.onMentionFileLine}>
                                          <button
                                            type="button"
                                            class={lineButtonClass()}
                                            style={{ color: "var(--text-weak)", background: device.isTouchDevice() ? "var(--surface-inset)" : "transparent" }}
                                            aria-label={`Add comment for ${props.path} line ${num()}`}
                                            title="Add comment"
                                            onClick={() => props.onMentionFileLine?.(props.path, { startLine: num(), endLine: num() })}
                                          >
                                            <MessageSquarePlus class="w-3.5 h-3.5" />
                                          </button>
                                        </Show>
                                    </div>
                                  )
                                }}
                              </For>
                          </div>
                        </div>
                      }
                      >
                    <iframe
                      src={htmlBlobUrl()}
                      sandbox={htmlSandbox()}
                      class="w-full border-0"
                      style={{ height: "calc(100vh - 120px)", background: "var(--background-base)" }}
                      title="HTML preview"
                    />
                      </Show>
                    }
                  >
                    <div class="p-4 overflow-y-auto">
                      <Markdown content={fileContent()} class="text-sm" />
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Match>
        <Match when={!props.path}>
          <div class="flex flex-col items-center justify-center h-full text-center px-4">
            <FileCode class="w-8 h-8 mb-2" style={{ color: "var(--icon-weak)", opacity: 0.3 }} />
            <span class="text-xs" style={{ color: "var(--text-weak)" }}>
              Select a file to view
            </span>
          </div>
        </Match>
      </Switch>

       <Show when={saveError()}>
         {(err) => (
           <div class="absolute bottom-4 right-4 bg-red-500 px-4 py-2 rounded shadow-lg text-sm z-50 flex items-center gap-2" role="alert" style={{ color: "var(--text-on-interactive)" }}>
            <span>{err()}</span>
            <button 
              onClick={() => setSaveError(null)} 
              class="p-1 hover:bg-white/20 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}
      </Show>

      <Show when={fullscreenPreview()}>
        <Portal>
          <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" role="presentation">
            <div
              ref={fullscreenRef}
              role="dialog"
              aria-modal="true"
              aria-label="Fullscreen preview"
              tabIndex={-1}
              class="w-full h-full relative"
              style={{ background: "var(--background-base)" }}
            >
              <button
                class="absolute top-4 right-4 z-10 p-2 hover:bg-black/10 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
                onClick={() => setFullscreenPreview(false)}
                title="Close Fullscreen"
                aria-label="Close Fullscreen"
              >
                <X class="w-5 h-5" />
              </button>
              <div class="w-full h-full overflow-auto">
                <Show
                  when={isMarkdown() && markdownPreview()}
                  fallback={
                    <Show
                      when={isHtml() && htmlPreview()}
                      fallback={
                        <Show when={isPdf()} fallback={
                        <div class="p-8 max-w-4xl mx-auto">
                          <div class="font-mono text-xs leading-6 whitespace-pre" style={{ color: "var(--text-base)" }}>
                            <For each={sourceLines()}>
                              {(line, index) => {
                                const num = () => index() + 1
                                return (
                                  <div class="group flex min-w-max rounded-sm px-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                                    <div class="min-h-[1.5rem] flex-1 pr-3">
                                      {line || " "}
                                    </div>
                                    <Show when={props.onMentionFileLine}>
                                      <button
                                        type="button"
                                        class={lineButtonClass()}
                                        style={{ color: "var(--text-weak)", background: device.isTouchDevice() ? "var(--surface-inset)" : "transparent" }}
                                        aria-label={`Add comment for ${props.path} line ${num()}`}
                                        title="Add comment"
                                        onClick={() => props.onMentionFileLine?.(props.path, { startLine: num(), endLine: num() })}
                                      >
                                        <MessageSquarePlus class="w-3.5 h-3.5" />
                                      </button>
                                    </Show>
                                  </div>
                                )
                              }}
                            </For>
                          </div>
                        </div>
                        }>
                          <iframe
                            src={pdfUrl()}
                            class="w-full h-full border-0"
                            title="PDF preview"
                          />
                        </Show>
                      }
                    >
                      <iframe
                        src={htmlBlobUrl()}
                        sandbox={htmlSandbox()}
                        tabIndex={-1}
                        class="w-full h-full border-0"
                        title="HTML preview"
                      />
                    </Show>
                  }
                >
                  <div class="p-8 max-w-4xl mx-auto">
                    <Markdown content={fileContent()} class="text-sm" />
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      <EditorDialog
        open={isEditing()}
        path={props.path}
        content={fileContent()}
        language={lang()}
        onClose={() => setIsEditing(false)}
        onSave={handleSave}
      />
    </div>
  )
}
