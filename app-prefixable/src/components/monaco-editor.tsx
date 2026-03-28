import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import loader from "@monaco-editor/loader"
import type * as monacoType from "monaco-editor"
import { useTheme } from "../context/theme"

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
        const val = editor?.getValue()
        if (val !== undefined && props.onChange) {
          props.onChange(val)
        }
      }) }

      setReady(true)
    }).catch(err => {
      if (!isCanceled) setError(String(err))
    })

    onCleanup(() => {
      isCanceled = true
      if (editor) {
        editor.dispose()
      }
    })
  })

  // Re-create or update when editorKey changes
  createEffect(() => {
    props.editorKey; // track
    if (editor) {
      editor.setValue(props.value)
    }
  })

  // React to theme changes
  createEffect(() => {
    const isDark = resolved() === "dark"
    loader.init().then((monaco) => {
      monaco.editor.setTheme(isDark ? "vs-dark" : "vs")
    })
  })

  // React to prop.value changes if they come from outside
  createEffect(() => {
    const val = props.value
    if (editor && val !== editor.getValue()) {
      editor.setValue(val)
    }
  })

  // React to language changes
  createEffect(() => {
    const lang = props.language
    if (editor && lang) {
      loader.init().then((monaco) => {
        const model = editor!.getModel()
        if (model) {
          monaco.editor.setModelLanguage(model, lang)
        }
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
      <div ref={monacoContainerRef} class="w-full h-full" />
    </div>
  )
}
