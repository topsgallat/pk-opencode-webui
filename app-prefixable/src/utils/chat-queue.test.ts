import { describe, expect, test } from "bun:test"
import { applyQueuedPromptSubmission } from "./chat-queue"

describe("applyQueuedPromptSubmission", () => {
  test("keeps the queued head when submit is rejected", () => {
    const queue = [{ id: "a" }, { id: "b" }]

    const next = applyQueuedPromptSubmission(queue, "a", false)

    expect(next).toBe(queue)
  })

  test("removes the queued head only after submit succeeds", () => {
    const queue = [{ id: "a" }, { id: "b" }]

    const next = applyQueuedPromptSubmission(queue, "a", true)

    expect(next).toEqual([{ id: "b" }])
  })

  test("removes a non-head item by id if the queue changed before success resolves", () => {
    const queue = [{ id: "b" }, { id: "a" }, { id: "c" }]

    const next = applyQueuedPromptSubmission(queue, "a", true)

    expect(next).toEqual([{ id: "b" }, { id: "c" }])
  })
})
