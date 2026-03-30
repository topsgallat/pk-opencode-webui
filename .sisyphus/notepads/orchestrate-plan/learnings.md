Initial learnings for orchestrate-plan

- User reported UI freeze when waiting for agent response.
- Console shows repeated log: "[Sync] Event: message.part.delta" with rapidly increasing counter.
- Problem appears to block UI (no click/scroll) until the counter stops.

Keep app-level UX fixes minimal and focused on preventing main-thread blocking.

- Analysis run: located streaming handlers and delta processors in sync.tsx and related components.
  Files: app-prefixable/src/context/sync.tsx, app-prefixable/src/pages/session.tsx, app-prefixable/src/components/message-timeline.tsx, app-prefixable/src/components/message-turn.tsx, app-prefixable/src/context/events.tsx
  Reason: message.part.delta handled on main thread via SSE; numerous synchronous setStore updates and per-delta array/map operations can produce many re-renders.

- Implemented micro-batching for message.part.delta in app-prefixable/src/context/sync.tsx.
  Deltas are queued per messageID:partID and flushed once per animation frame using requestAnimationFrame.
  This reduces per-delta setStore calls by applying concatenated updates in a single SolidJS batch,
  preserving ordering and final part content while lowering main-thread work.
