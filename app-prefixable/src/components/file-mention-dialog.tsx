import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { X } from "lucide-solid"
import { useSDK } from "../context/sdk"

interface Props {
  open: boolean
  path: string
  initialSelection?: { startLine: number; endLine: number }
  onSubmit: (note: string, selection: { startLine: number; endLine: number }, preview: string) => void
  onClose: () => void
}

export function FileMentionDialog(props: Props) {
  const { client, directory } = useSDK()
  const [note, setNote] = createSignal("")
  const [content, setContent] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [startLine, setStartLine] = createSignal(1)
  const [endLine, setEndLine] = createSignal(1)
  let inputRef: HTMLTextAreaElement | undefined

  createEffect(() => {
    if (!props.open) {
      setNote("")
      setContent("")
      setError(null)
      setLoading(false)
      setStartLine(1)
      setEndLine(1)
      return
    }

    setLoading(true)
    void client.file.read({ path: props.path, directory }).then((res) => {
      const next = res.data?.content ?? ""
      setContent(next)
      const lines = Math.max(1, next.split("\n").length)
      setStartLine(Math.min(Math.max(1, props.initialSelection?.startLine ?? 1), lines))
      setEndLine(Math.min(Math.max(props.initialSelection?.endLine ?? Math.min(20, lines), 1), lines))
      setLoading(false)
      setTimeout(() => inputRef?.focus(), 0)
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    })

  })

  const lines = createMemo(() => content().split("\n"))
  const lineCount = createMemo(() => Math.max(1, lines().length))
  const safeStart = createMemo(() => {
    const n = Math.min(Math.max(1, startLine()), lineCount())
    return n
  })
  const safeEnd = createMemo(() => {
    const n = Math.min(Math.max(safeStart(), endLine()), lineCount())
    return n
  })
  const preview = createMemo(() => {
    const start = safeStart()
    const end = safeEnd()
    return lines()
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n")
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-mention-dialog-title"
            class="relative z-[1001] w-full max-w-lg rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ background: "var(--background-base)", border: "1px solid var(--border-base)" }}
          >
            <div class="px-4 py-3 flex items-center justify-between" style={{ "border-bottom": "1px solid var(--border-base)" }}>
              <div id="file-mention-dialog-title" class="text-sm font-medium" style={{ color: "var(--text-strong)" }}>
                Mention file in prompt
              </div>
              <button
                type="button"
                onClick={props.onClose}
                class="p-2 rounded-md min-h-[44px] min-w-[44px] flex items-center justify-center"
                style={{ color: "var(--text-base)" }}
                title="Close"
                aria-label="Close dialog"
              >
                <X class="w-4 h-4" />
              </button>
            </div>

            <div class="p-4 space-y-3">
              <div class="text-xs" style={{ color: "var(--text-weak)" }}>
                {props.path}
              </div>
              <Show when={error()}>
                <div class="text-xs" style={{ color: "var(--status-danger-text)" }}>
                  {error()}
                </div>
              </Show>
              <Show when={!error()}>
                <div class="grid grid-cols-2 gap-2">
                  <label class="block text-xs font-medium" style={{ color: "var(--text-weak)" }}>
                    Start line
                    <input
                      type="number"
                      min="1"
                      max={lineCount()}
                      value={startLine()}
                      onInput={(e) => setStartLine(parseInt(e.currentTarget.value || "1", 10))}
                      class="mt-1 w-full rounded-md px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--surface-inset)", color: "var(--text-base)", border: "1px solid var(--border-base)" }}
                    />
                  </label>
                  <label class="block text-xs font-medium" style={{ color: "var(--text-weak)" }}>
                    End line
                    <input
                      type="number"
                      min="1"
                      max={lineCount()}
                      value={endLine()}
                      onInput={(e) => setEndLine(parseInt(e.currentTarget.value || "1", 10))}
                      class="mt-1 w-full rounded-md px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--surface-inset)", color: "var(--text-base)", border: "1px solid var(--border-base)" }}
                    />
                  </label>
                </div>
                <div class="rounded-md p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto" style={{ background: "var(--surface-inset)", color: "var(--text-base)", border: "1px solid var(--border-base)" }}>
                  <Show when={!loading()} fallback={<div>Loading file…</div>}>
                    {preview() || "No preview"}
                  </Show>
                </div>
              </Show>
              <label class="block text-xs font-medium" style={{ color: "var(--text-weak)" }}>
                Note for the agent (optional)
              </label>
              <textarea
                ref={inputRef}
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
                class="w-full min-h-[120px] resize-none rounded-md px-3 py-2 text-sm outline-none"
                style={{ background: "var(--surface-inset)", color: "var(--text-base)", border: "1px solid var(--border-base)" }}
                placeholder="e.g. please update this file to use the new API"
              />
            </div>

            <div class="px-4 py-3 flex justify-end gap-2" style={{ "border-top": "1px solid var(--border-base)" }}>
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2 min-h-[44px] text-sm font-medium rounded-md"
                style={{ background: "var(--surface-inset)", color: "var(--text-base)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => props.onSubmit(note().trim(), { startLine: safeStart(), endLine: safeEnd() }, preview())}
                class="px-4 py-2 min-h-[44px] text-sm font-medium rounded-md"
                style={{ background: "var(--interactive-base)", color: "white", border: "none" }}
              >
                Add to prompt
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
