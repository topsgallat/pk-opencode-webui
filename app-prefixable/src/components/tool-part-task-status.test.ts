import { describe, expect, test } from "bun:test"
import { isBackgroundTaskMetadata, isChildSessionBusy, resolveTaskDisplayStatus } from "./tool-part-task-status"

describe("isBackgroundTaskMetadata", () => {
  test("true when backgroundTaskId is present (pentesters_task background launch)", () => {
    expect(isBackgroundTaskMetadata({ backgroundTaskId: "bg_123", sessionId: "ses_1" })).toBe(true)
  })

  test("false when backgroundTaskId is absent (built-in task, or pentesters_task sync mode)", () => {
    expect(isBackgroundTaskMetadata({ sessionId: "ses_1", run_in_background: false })).toBe(false)
  })

  test("false when metadata is undefined", () => {
    expect(isBackgroundTaskMetadata(undefined)).toBe(false)
  })
})

describe("isChildSessionBusy", () => {
  test("true when no status event has been seen yet (avoid a premature 'done' flash)", () => {
    expect(isChildSessionBusy(undefined)).toBe(true)
  })

  test("true when the child session is busy", () => {
    expect(isChildSessionBusy({ type: "busy" })).toBe(true)
  })

  test("true when the child session is retrying", () => {
    expect(isChildSessionBusy({ type: "retry" })).toBe(true)
  })

  test("false only once the child session reports idle", () => {
    expect(isChildSessionBusy({ type: "idle" })).toBe(false)
  })
})

describe("resolveTaskDisplayStatus", () => {
  test("overrides a background task's premature 'completed' with 'running' while the child is busy", () => {
    expect(resolveTaskDisplayStatus({
      status: "completed",
      isBackgroundTask: true,
      hasChildId: true,
      childIsBusy: true,
    })).toBe("running")
  })

  test("passes 'completed' through once the child session goes idle", () => {
    expect(resolveTaskDisplayStatus({
      status: "completed",
      isBackgroundTask: true,
      hasChildId: true,
      childIsBusy: false,
    })).toBe("completed")
  })

  test("passes 'completed' through for a foreground/sync task (built-in task tool)", () => {
    expect(resolveTaskDisplayStatus({
      status: "completed",
      isBackgroundTask: false,
      hasChildId: true,
      childIsBusy: true,
    })).toBe("completed")
  })

  test("passes 'completed' through when there is no child id yet", () => {
    expect(resolveTaskDisplayStatus({
      status: "completed",
      isBackgroundTask: true,
      hasChildId: false,
      childIsBusy: true,
    })).toBe("completed")
  })

  test("leaves non-completed statuses untouched", () => {
    expect(resolveTaskDisplayStatus({
      status: "running",
      isBackgroundTask: true,
      hasChildId: true,
      childIsBusy: true,
    })).toBe("running")
    expect(resolveTaskDisplayStatus({
      status: "error",
      isBackgroundTask: true,
      hasChildId: true,
      childIsBusy: true,
    })).toBe("error")
    expect(resolveTaskDisplayStatus({
      status: "pending",
      isBackgroundTask: true,
      hasChildId: true,
      childIsBusy: true,
    })).toBe("pending")
  })
})
