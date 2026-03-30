import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import loader from "@monaco-editor/loader"
import type * as monacoType from "monaco-editor"
import { useTheme } from "../context/theme"

// Install a global handler to suppress known Monaco 'Canceled' promise
// rejections that occur when the editor or its workers are torn down.
// This handler is safe to keep permanently and only ignores the exact
// 'Canceled' reason to avoid noisy console output during normal use.
if (typeof window !== "undefined") {
  try {
    const globalKey = "__pk_oc_monaco_cancel_handler"
    // @ts-ignore global marker
    if (!(window as any)[globalKey]) {
      const g = (ev: PromiseRejectionEvent) => {
        try {
          const r: any = ev.reason
          const msg = typeof r === "string" ? r : r?.message
          if (msg === "Canceled") {
            // Log a lightweight debug entry so we can trace where this
            // cancellation originates during runtime without polluting
            // the console for end users. The debug log will include a
            // stack snapshot to help locate the source in production
            // bundles.
            try { console.debug("Monaco canceled rejection detected:", r, new Error().stack) } catch {}
            ev.preventDefault()
          }
        } catch {}
      }
      window.addEventListener("unhandledrejection", g)
      ;(window as any)[globalKey] = g
    }
  } catch {}
}

export interface MonacoEditorProps {
  value: string
  language?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  editorKey?: number // Used to trigger recreation if needed
}

export function MonacoEditor(props: MonacoEditorProps) {
  let monacoContainerRef!: HTMLDivElement
  const { resolved } = useTheme()
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let editor: monacoType.editor.IStandaloneCodeEditor | undefined

  onMount(() => {
    let isCanceled = false
    // During the editor lifetime ignore known 'Canceled' promise rejections
    // coming from Monaco/worker disposal to avoid noisy console logs.
    const _unhandled = (ev: PromiseRejectionEvent) => {
      try {
        const r: any = ev.reason
        const msg = typeof r === "string" ? r : r?.message || r?.name || String(r)
        if (typeof msg === "string" && msg.indexOf("Canceled") !== -1) {
          ev.preventDefault()
          return
        }
      } catch {}
    }
    window.addEventListener("unhandledrejection", _unhandled)

    loader.init().then((monaco) => {
      if (isCanceled) return

      // Bug #4: Monaco uses built-in themes
      const isDark = resolved() === "dark"
      const themeName = isDark ? "vs-dark" : "vs"

      editor = monaco.editor.create(monacoContainerRef, {
        value: props.value,
        language: props.language ?? "plaintext",
        theme: themeName,
        automaticLayout: true,
        readOnly: props.readOnly,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      })

      if (editor) { editor.onDidChangeModelContent(() => {
        try {
          const val = editor?.getValue()
          if (val !== undefined && props.onChange) {
            props.onChange(val)
          }
        } catch (e) {
          // ignore synchronous errors if editor was disposed concurrently
        }
      }) }

      setReady(true)
    }).catch(err => {
      // Ignore cancellation during unmount
      if (!isCanceled && err?.message !== "Canceled") setError(String(err))
    })

    onCleanup(() => {
      isCanceled = true
      // remove handler and dispose editor asynchronously so that any
      // in-flight microtasks or promise chains can settle first. This
      // reduces races where Monaco rejects promises during synchronous
      // disposal.
      try { window.removeEventListener("unhandledrejection", _unhandled) } catch {}
      try {
        Promise.resolve().then(() => {
          try { editor?.dispose() } catch {}
        })
      } catch {}
    })
  })

  // Re-create or update when editorKey changes
  createEffect(() => {
    props.editorKey; // track
    if (editor) {
      try {
        editor.setValue(props.value)
      } catch (e) { /* ignore if disposed concurrently */ }
    }
  })

  // React to theme changes
  createEffect(() => {
    const isDark = resolved() === "dark"
    loader.init().then((monaco) => {
      monaco.editor.setTheme(isDark ? "vs-dark" : "vs")
    }).catch(e => {
      if (e?.message !== "Canceled") console.warn("Monaco theme init error", e)
    })
  })

  // React to prop.value changes if they come from outside
  createEffect(() => {
    const val = props.value
    if (editor) {
      try {
        if (val !== editor.getValue()) {
          editor.setValue(val)
        }
      } catch (e) { /* ignore if disposed concurrently */ }
    }
  })

  // React to language changes
  createEffect(() => {
    const lang = props.language
    if (editor && lang) {
      loader.init().then((monaco) => {
        try {
          const model = editor!.getModel()
          if (model) {
            monaco.editor.setModelLanguage(model, lang)
          }
        } catch (e) { /* ignore if disposed concurrently */ }
      }).catch(e => {
        if (e?.message !== "Canceled") console.warn("Monaco language init error", e)
      })
    }
  })

  return (
    // Bug #3: DOM conflict workaround - separate div for Monaco
    <div class="absolute inset-0">
      {/* SolidJS managed loading overlay */}
      <Show when={!ready()}>
        <div class="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "var(--background-base)", color: "var(--text-weak)" }}>
          <div class="text-sm">{error() ? `Error: ${error()}` : "Loading editor..."}</div>
        </div>
      </Show>
      
      {/* Monaco managed container - completely clean from SolidJS reactivity */}
      <div ref={monacoContainerRef} class="w-full h-full" aria-label="Code Editor" role="region" />
    </div>
  )
}
