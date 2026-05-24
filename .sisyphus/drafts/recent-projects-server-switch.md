# Draft: Recent Projects Server Switching

## Requirements (confirmed)
- Recent Projects must change when the selected server changes.
- Recent Projects must not show project paths from the previously selected server.

## Technical Decisions
- Investigate storage scoping and server-key reactivity before planning a fix.
- Target the Recent Projects provider refresh path instead of the list rendering.

## Research Findings
- `app-prefixable/src/context/recent-projects.tsx` stores data under `opencode-recent-projects.<serverKey>` and reloads via `createEffect(on(serverKey, ...))`.
- `app-prefixable/src/context/server.tsx` derives `serverKey()` from the selected server URL, not raw server id.
- `app-prefixable/src/app.tsx` uses `<For each={[serverKey()]}>` to remount `ServerScopedApp`, which contains `RecentProjectsProvider`.
- `app-prefixable/src/pages/project-picker.tsx` only renders `recent.projects()` and does not own the server-specific data logic.
- Likely weak point: provider state survives or refreshes too late/incompletely on same-tab server switching, so explicit reset/reload behavior should be strengthened.

## Open Questions
- None.

## Scope Boundaries
- INCLUDE: Recent Projects list rendering, persistence, and server-switch refresh behavior.
- EXCLUDE: Unrelated project picker path semantics already fixed.
