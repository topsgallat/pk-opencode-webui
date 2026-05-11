import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { ChevronDown, ListTodo, X } from "lucide-solid"
import { TodoListSections } from "./session-sidebar"
import { useSessionTodos } from "../utils/session-todos"

interface MobileTodoTrayProps {
  sessionId: () => string | undefined
  open: () => boolean
  setOpen: (value: boolean) => void
  processing: () => boolean
}

export function MobileTodoTray(props: MobileTodoTrayProps) {
  const todos = useSessionTodos(props.sessionId)
  const summary = createMemo(() => todos.summary())
  const [lastSession, setLastSession] = createSignal<string | undefined>(undefined)
  const [hydrated, setHydrated] = createSignal(false)
  const [dismissedKey, setDismissedKey] = createSignal<string | undefined>(undefined)
  const [hiddenSession, setHiddenSession] = createSignal<string | undefined>(undefined)
  const currentKey = createMemo(() => todos.todos().map((todo) => `${todo.id}:${todo.status}`).join("|"))
  const hiddenStorageKey = (id: string) => `opencode.todoTrayHidden.${id}`

  createEffect(() => {
    const id = props.sessionId()
    if (id === lastSession()) return
    setLastSession(id)
    setHydrated(false)
    setDismissedKey(undefined)
    setHiddenSession(id && localStorage.getItem(hiddenStorageKey(id)) === "1" ? id : undefined)
    props.setOpen(false)
  })

  createEffect(() => {
    if (summary().total === 0) {
      setHydrated(false)
      setDismissedKey(undefined)
      const id = props.sessionId()
      if (id) {
        setHiddenSession(id)
        localStorage.setItem(hiddenStorageKey(id), "1")
      }
      return
    }

    const id = props.sessionId()
    if (id && summary().active > 0 && hiddenSession() === id) {
      setHiddenSession(undefined)
      localStorage.removeItem(hiddenStorageKey(id))
    }

    if (!hydrated()) {
      setHydrated(true)
      return
    }

    if (summary().active > 0) {
      if (dismissedKey() === currentKey()) return
      if (props.open()) return
      props.setOpen(true)
    }
  })

  createEffect(() => {
    if (props.processing()) {
      setHydrated(true)
      props.setOpen(false)
    }
  })

  createEffect(() => {
    if (!props.open() || summary().total === 0 || hiddenSession() === props.sessionId()) return

    const body = document.body.style
    const html = document.documentElement.style
    const prevBodyOverflow = body.overflow
    const prevHtmlOverflow = html.overflow
    const prevBodyOverscroll = body.overscrollBehavior
    const prevHtmlOverscroll = html.overscrollBehavior

    body.overflow = "hidden"
    html.overflow = "hidden"
    body.overscrollBehavior = "none"
    html.overscrollBehavior = "none"

    onCleanup(() => {
      body.overflow = prevBodyOverflow
      html.overflow = prevHtmlOverflow
      body.overscrollBehavior = prevBodyOverscroll
      html.overscrollBehavior = prevHtmlOverscroll
    })
  })

  return (
    <Show when={summary().total > 0 && hiddenSession() !== props.sessionId()}>
      <div class="absolute left-0 right-0 bottom-full z-20 mb-2">
        <Show when={props.open()}>
            <button
              type="button"
              class="fixed inset-0 z-10 bg-transparent"
              aria-label="Close todo tray"
              style={{ "touch-action": "none", "overscroll-behavior": "none" }}
              onPointerDown={(e) => {
                e.preventDefault()
                setDismissedKey(currentKey())
                const id = props.sessionId()
                if (id && summary().active === 0) {
                  setHiddenSession(id)
                  localStorage.setItem(hiddenStorageKey(id), "1")
                }
                props.setOpen(false)
              }}
              onClick={() => {
                setDismissedKey(currentKey())
                const id = props.sessionId()
                if (id && summary().active === 0) {
                  setHiddenSession(id)
                  localStorage.setItem(hiddenStorageKey(id), "1")
                }
                props.setOpen(false)
              }}
            />
          </Show>

        <div class="relative z-20 flex flex-col gap-2">
          <button
            type="button"
            class="mobile-todo-tray w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left shadow-lg"
            style={{
              background: "var(--background-base)",
              border: "1px solid var(--border-base)",
            }}
            onClick={() => {
              if (props.open()) {
                setDismissedKey(currentKey())
                props.setOpen(false)
                return
              }

              props.setOpen(true)
            }}
          >
            <ListTodo class="w-4 h-4 shrink-0" style={{ color: "var(--text-interactive-base)" }} />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-weak)" }}>
                  Tasks
                </span>
                <span class="text-xs truncate" style={{ color: "var(--text-base)" }}>
                  {summary().focus?.content || "Agent is planning tasks"}
                </span>
              </div>
              <div class="text-[10px] mt-0.5" style={{ color: "var(--text-weak)" }}>
                {summary().active} active · {summary().total} total
              </div>
            </div>
            <ChevronDown
              class="w-4 h-4 shrink-0 transition-transform"
              style={{
                color: "var(--icon-weak)",
                transform: props.open() ? "rotate(180deg)" : "none",
              }}
            />
          </button>

          <Show when={props.open()}>
            <div
              class="mobile-todo-sheet relative z-20 rounded-xl overflow-hidden shadow-2xl"
                style={{
                  background: "var(--background-base)",
                  border: "1px solid var(--border-base)",
                  display: "flex",
                  "flex-direction": "column",
                "max-height": "min(48dvh, calc(100dvh - 10rem))",
                "min-height": 0,
              }}
            >
              <div class="flex items-center justify-between px-3 py-2" style={{ "border-bottom": "1px solid var(--border-base)" }}>
                <span class="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-weak)" }}>
                  Agent Progress
                </span>
                <button
                  type="button"
                  class="p-1 rounded-md"
                  style={{ color: "var(--icon-weak)" }}
                  onClick={() => {
                    setDismissedKey(currentKey())
                    const id = props.sessionId()
                    if (id && summary().active === 0) {
                      setHiddenSession(id)
                      localStorage.setItem(hiddenStorageKey(id), "1")
                    }
                    props.setOpen(false)
                  }}
                  aria-label="Collapse todo tray"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
              <div class="mobile-todo-sheet-body">
                <TodoListSections todos={todos.todos} />
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
