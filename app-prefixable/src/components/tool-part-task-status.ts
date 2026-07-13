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

// What the TaskToolDisplay child-sync effect should do.
//
// Terminal states (completed/error) still need one sync: the child's "idle"
// status can arrive (via session.status SSE, the refreshStatuses poll, or
// page-reload seeding) before the effect has ever fetched the child's
// messages — returning without syncing there froze the card with no
// "Tools used"/"Skills"/result forever.
//
// `hasChildMessages` is a lazy thunk ON PURPOSE: Solid tracks every signal
// read that executes inside an effect. In a terminal state the decision must
// be made WITHOUT reading the child-messages signal, otherwise each message
// arrival re-runs the effect -> another sync -> store write with fresh
// references -> an infinite network loop. The thunk is only invoked on the
// "still running, do we need to keep polling?" branch.
export type ChildSyncAction = "skip" | "sync-once" | "sync-and-poll";

export function resolveChildSyncAction(args: {
  hasChildId: boolean;
  displayStatus: "pending" | "running" | "completed" | "error";
  hasChildMessages: () => boolean;
}): ChildSyncAction {
  if (!args.hasChildId) return "skip";
  if (args.displayStatus === "completed" || args.displayStatus === "error") return "sync-once";
  if (args.hasChildMessages()) return "sync-once";
  return "sync-and-poll";
}
