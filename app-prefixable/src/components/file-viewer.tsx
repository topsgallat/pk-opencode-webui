import { createSignal, createEffect, Show, Match, Switch, createMemo } from "solid-js"
import { useFile } from "../context/file"
import { useSDK } from "../context/sdk"
import { useBasePath } from "../context/base-path"
import { ContentCode } from "./diff/content-code"
import { Spinner } from "./ui/spinner"
import { FileCode, Pencil } from "lucide-solid"
import { writeFile } from "../utils/extended-api"
import { EditorDialog } from "./editor-dialog"

interface FileViewerProps {
  path: string
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

export function FileViewer(props: FileViewerProps) {
  const file = useFile()
  const sdk = useSDK()
  const basePath = useBasePath()

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

  const lang = createMemo(() => getLanguage(props.path))
  const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

  createEffect(() => {
    const path = props.path
    if (!path) return

    const s = file.get(path)
    const loading = !!s?.loading
    const loaded = !!s?.loaded
    const error = s?.error
    const content = s?.content?.content ?? ""
    const isBin = s?.content?.type === "binary"
    const mime = s?.content?.mimeType
    const img = s?.content?.encoding === "base64" && mime && SAFE_IMAGE_TYPES.has(mime)

    setFileLoading(loading)
    setFileLoaded(loaded)
    setFileError(error)
    setFileContent(content)
    setIsBinary(isBin)
    setIsImage(!!img)
    if (img) {
      setImageUrl(`data:${mime};base64,${s?.content?.content}`)
    } else {
      setImageUrl(undefined)
    }

    if (!loaded && !loading) {
      void file.load(path)
    }
  })

  // Bug #8: Save Path
  async function handleSave(newContent: string) {
    const fullPath = sdk.directory && !props.path.startsWith("/")
      ? `${sdk.directory}/${props.path}`
      : props.path

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
                <div class="truncate">{props.path}</div>
                <button
                  class="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={() => setIsEditing(true)}
                  title="Edit File"
                  style={{ color: "var(--text-base)" }}
                >
                  <Pencil class="w-3.5 h-3.5" />
                </button>
              </div>
              <div class="overflow-x-auto min-h-0">
                <Show when={fileContent()} fallback={<div class="p-4 text-xs" style={{ color: "var(--text-weak)" }}>Empty file</div>}>
                  <ContentCode code={fileContent()} lang={lang()} />
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
          <div class="absolute bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg text-sm z-50 flex items-center gap-2" role="alert">
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
