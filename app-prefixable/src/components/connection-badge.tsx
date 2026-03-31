import { Show, useContext } from "solid-js"
import { EventContext } from "../context/events"

export function ConnectionBadge() {
  const events = useContext(EventContext)
  if (!events) return null

  return (
    <Show when={!events.connected()}>
      <div
        title={events.reconnecting() ? "Reconnecting to server..." : "Disconnected from server"}
        style={{
          width: "8px",
          height: "8px",
          "border-radius": "50%",
          background: events.reconnecting() ? "var(--icon-warning-base)" : "var(--text-critical-base)",
          "flex-shrink": "0",
          cursor: "default",
        }}
        aria-label={events.reconnecting() ? "Reconnecting" : "Disconnected"}
        role="status"
      />
    </Show>
  )
}
