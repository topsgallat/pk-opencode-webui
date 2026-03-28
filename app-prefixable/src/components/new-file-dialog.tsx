import { createSignal, createComputed, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { X, FilePlus, FolderPlus } from "lucide-solid"

interface NewFileDialogProps {
  open: boolean
  mode: "file" | "folder"
  parentPath: string
  onConfirm: (name: string) => void
  onClose: () => void
}

export function NewFileDialog(props: NewFileDialogProps) {
  const [name, setName] = createSignal("")
  let inputRef: HTMLInputElement | undefined

  createComputed(() => {
    if (props.open) {
      setName("")
      // focus slightly later so modal can render
      setTimeout(() => inputRef?.focus(), 10)
    }
  })

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!name().trim()) return
    props.onConfirm(name().trim())
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose()
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose()
          }}
        >
          <div
            class="w-full max-w-md rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{
              background: "var(--background-base)",
              border: "1px solid var(--border-base)",
            }}
          >
            <div class="px-4 py-3 flex justify-between items-center" style={{ "border-bottom": "1px solid var(--border-base)" }}>
              <div class="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-strong)" }}>
                {props.mode === "file" ? <FilePlus class="w-4 h-4" /> : <FolderPlus class="w-4 h-4" />}
                {props.mode === "file" ? "New File" : "New Folder"}
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  class="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-md"
                  style={{ color: "var(--text-base)" }}
                  title="Close"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} class="p-4 flex flex-col gap-4">
              <div class="text-xs" style={{ color: "var(--text-muted)" }}>
                Create in: <span class="font-mono text-xs px-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}>{props.parentPath || "/"}</span>
              </div>
              
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={props.mode === "file" ? "filename.ext" : "folder-name"}
                  class="w-full px-3 py-2 rounded-md text-sm outline-none focus:ring-1 focus:ring-offset-0 focus:ring-opacity-50"
                  style={{
                    background: "var(--surface-inset)",
                    color: "var(--text-strong)",
                    border: "1px solid var(--border-base)",
                    "caret-color": "var(--interactive-base)",
                  }}
                  autofocus
                />
              </div>

              <div class="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
                  style={{
                    background: "var(--surface-inset)",
                    color: "var(--text-base)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name().trim()}
                  class="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--interactive-base)",
                    color: "white",
                    border: "none",
                  }}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
