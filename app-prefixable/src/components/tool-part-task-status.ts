// pentesters_task can run in the background: its own tool call (and
// ToolPart status) completes as soon as the child session is *launched*,
// while the delegated work keeps running afterward. `backgroundTaskId` is
// only ever set by that background-launch path, never by the sync variant.
export function isBackgroundTaskMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return Boolean(metadata?.backgroundTaskId);
}

// Whether the child session itself is still busy, per session.status SSE
// events. If we haven't seen a status event yet, assume busy so the card
// doesn't flash "done" before the child session has even reported in.
export function isChildSessionBusy(status: { type: string } | undefined): boolean {
  if (!status) return true;
  return status.type !== "idle";
}

// The status to actually render/poll against. For background tasks, the
// outer ToolPart reports "completed" immediately on launch, so override
// that with "running" until the child session goes idle.
export function resolveTaskDisplayStatus(args: {
  status: "pending" | "running" | "completed" | "error";
  isBackgroundTask: boolean;
  hasChildId: boolean;
  childIsBusy: boolean;
}): "pending" | "running" | "completed" | "error" {
  if (args.status === "completed" && args.isBackgroundTask && args.hasChildId && args.childIsBusy) {
    return "running";
  }
  return args.status;
}
