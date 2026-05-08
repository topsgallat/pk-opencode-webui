import { describe, expect, test } from "bun:test"
import { splitTodos, summarizeTodos } from "../utils/session-todos"

describe("session todo helpers", () => {
  test("keeps active tasks separate from completed ones", () => {
    const todos = splitTodos([
      { id: "1", content: "Plan", status: "pending", priority: "high" },
      { id: "2", content: "Ship", status: "completed", priority: "low" },
      { id: "3", content: "Review", status: "in_progress", priority: "medium" },
    ])

    expect(todos.pending.map((t) => t.id)).toEqual(["1", "3"])
    expect(todos.completed.map((t) => t.id)).toEqual(["2"])
  })

  test("prefers in-progress task for the tray summary", () => {
    const summary = summarizeTodos([
      { id: "1", content: "Plan", status: "pending", priority: "high" },
      { id: "2", content: "Build", status: "in_progress", priority: "medium" },
      { id: "3", content: "Done", status: "completed", priority: "low" },
    ])

    expect(summary.focus?.content).toBe("Build")
    expect(summary.active).toBe(2)
    expect(summary.total).toBe(3)
  })
})
