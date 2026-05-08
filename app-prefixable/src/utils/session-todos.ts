import { createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import { useSDK } from "../context/sdk"
import { useEvents } from "../context/events"

export interface Todo {
  id: string
  content: string
  status: string
  priority: string
}

export function splitTodos(todos: Todo[]) {
  const pending = todos.filter((t) => t.status === "pending" || t.status === "in_progress")
  const completed = todos.filter((t) => t.status === "completed" || t.status === "cancelled")
  const focus = pending.find((t) => t.status === "in_progress") ?? pending[0] ?? completed[0] ?? null

  return { pending, completed, focus }
}

export function summarizeTodos(todos: Todo[]) {
  const parts = splitTodos(todos)
  return {
    total: todos.length,
    active: parts.pending.length,
    done: parts.completed.length,
    focus: parts.focus,
  }
}

export function useSessionTodos(sessionId: () => string | undefined) {
  const { client, directory } = useSDK()
  const events = useEvents()

  const [todos, setTodos] = createSignal<Todo[]>([])

  createEffect(() => {
    const id = sessionId()
    if (!id) {
      setTodos([])
      return
    }

    let cancelled = false

    void client.session
      .todo({ sessionID: id, directory })
      .then((res) => {
        if (cancelled) return
        setTodos((res.data ?? []) as Todo[])
      })
      .catch((e) => {
        if (cancelled) return
        console.error("[SessionTodos] Failed to load todos:", e)
        setTodos([])
      })

    const unsub = events.subscribe((event) => {
      if (event.type !== "todo.updated") return
      const eventProps = event.properties as { sessionID: string; todos: Todo[] }
      if (eventProps.sessionID !== id) return
      setTodos(eventProps.todos)
    })

    onCleanup(() => {
      cancelled = true
      unsub()
    })
  })

  const pendingTodos = createMemo(() => splitTodos(todos()).pending)
  const completedTodos = createMemo(() => splitTodos(todos()).completed)

  return { todos, pendingTodos, completedTodos, summary: createMemo(() => summarizeTodos(todos())) }
}
