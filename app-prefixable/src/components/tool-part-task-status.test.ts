import { describe, expect, test } from "bun:test"
import { isBackgroundTaskMetadata, isChildSessionBusy, resolveTaskDisplayStatus, resolveChildSyncAction } from "./tool-part-task-status"

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

describe("resolveChildSyncAction", () => {
  const mustNotRead = () => {
    throw new Error("childMessages must not be read in a terminal state (would create a sync loop)")
  }

  test("skip when there is no child session id yet", () => {
    expect(resolveChildSyncAction({
      hasChildId: false,
      displayStatus: "running",
      hasChildMessages: () => false,
    })).toBe("skip")
  })

  test("sync-once when completed, without reading child messages (regression: card frozen at 'Sent to:')", () => {
    expect(resolveChildSyncAction({
      hasChildId: true,
      displayStatus: "completed",
      hasChildMessages: mustNotRead,
    })).toBe("sync-once")
  })

  test("sync-once when errored, also without reading child messages", () => {
    expect(resolveChildSyncAction({
      hasChildId: true,
      displayStatus: "error",
      hasChildMessages: mustNotRead,
    })).toBe("sync-once")
  })

  test("sync-once while running once messages exist (SSE keeps them fresh; no interval)", () => {
    expect(resolveChildSyncAction({
      hasChildId: true,
      displayStatus: "running",
      hasChildMessages: () => true,
    })).toBe("sync-once")
  })

  test("sync-and-poll while running with no messages yet", () => {
    expect(resolveChildSyncAction({
      hasChildId: true,
      displayStatus: "running",
      hasChildMessages: () => false,
    })).toBe("sync-and-poll")
  })

  test("pending behaves like running", () => {
    expect(resolveChildSyncAction({
      hasChildId: true,
      displayStatus: "pending",
      hasChildMessages: () => false,
    })).toBe("sync-and-poll")
  })
})
