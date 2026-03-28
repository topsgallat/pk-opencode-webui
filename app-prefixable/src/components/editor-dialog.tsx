import { createSignal, createEffect, createComputed, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { MonacoEditor } from "./monaco-editor"
import { Save, X } from "lucide-solid"

interface EditorDialogProps {
  open: boolean
  path: string
  content: string
  onSave: (content: string) => void
  onClose: () => void
  language?: string
}

export function EditorDialog(props: EditorDialogProps) {
  const [editContent, setEditContent] = createSignal("")
  const [editorKey, setEditorKey] = createSignal(0)

  // Bug #5: EditorDialog Send Content to Monaco Timing Issue Workaround
  createComputed(() => {
    if (props.open) {
      setEditContent(props.content)
      setEditorKey((k) => k + 1) // force Monaco re-create or update
    } else {
      setEditorKey(0)
    }
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          role="presentation"
        >
          <div
            class="w-full max-w-6xl rounded-lg shadow-xl overflow-hidden flex flex-col h-[90vh] sm:h-[calc(100vh-40px)]"
            style={{
              background: "var(--background-base)",
              border: "1px solid var(--border-base)",
            }}
          >
            <div class="px-4 py-3 flex justify-between items-center" style={{ "border-bottom": "1px solid var(--border-base)" }}>
              <div class="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-strong)" }}>
                Editing: <span class="text-xs font-mono px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}>{props.path}</span>
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

            <div class="relative w-full h-[60vh] md:h-[75vh]">
              <Show when={editorKey() > 0}>
                <MonacoEditor
                  editorKey={editorKey()}
                  value={editContent()}
                  language={props.language}
                  onChange={setEditContent}
                />
              </Show>
            </div>

            <div class="px-4 py-3 flex justify-end gap-2" style={{ "border-top": "1px solid var(--border-base)" }}>
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
                type="button"
                onClick={() => props.onSave(editContent())}
                class="px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2"
                style={{
                  background: "var(--interactive-base)",
                  color: "white",
                  border: "none",
                }}
              >
                <Save class="w-4 h-4" />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
