# Task 1: Server-Derived State Map

## Summary

Main leak sources are global providers above `ServerProvider`, global project/history/layout keys, and server-agnostic API clients that ignore the selected server.

| Files | State / Key | Current Scope | Risk | Proposed Fix |
|---|---:|---:|---:|---|
| `app-prefixable/src/app.tsx` | provider tree: `RecentProjectsProvider`, `SavedPromptsProvider`, `GlobalEventsProvider` above `ServerProvider` | global | high | Move/key server-bound providers under `ServerProvider` so selected-server switch remounts them. |
| `context/server.tsx`, `utils/servers.ts` | `opencode.selectedServer`, `opencode.servers` | global | low | Keep global; validate selection when server list changes/removes entries. |
| `context/sdk.tsx`, `sdk/client.ts`, `pages/home-layout.tsx`, `components/terminal.tsx`, `pages/settings.tsx` | `targetUrl`, `x-opencode-target`, `createOpencodeClient(...)` | per-server | low | Ensure every client is recreated on selected-server change. |
| `context/sync.tsx`, `pages/layout.tsx`, `pages/mobile-layout.tsx` | `client.session.list(...)` bootstrap/search/session lists | per-server | medium | Clear session caches on server switch; keep providers server-keyed. |
| `context/global-events.tsx` | SSE/fetch for inactive project badges | global | high | Bind to selected server or move under server-scoped SDK; currently ignores `targetUrl`. |
| `pages/project-picker.tsx`, `components/project-dialog.tsx`, `utils/extended-api.ts` | project browser APIs and `path.get()` | default backend | high | Use selected-server-aware client/target override instead of bare base URL. |
| `context/providers.tsx` | `opencode.modelsByAgent` | global | high | Namespace by selected server key or reset when provider list changes. |
| `context/recent-projects.tsx`, `pages/project-picker.tsx`, `pages/directory-layout.tsx`, `pages/home-layout.tsx`, `components/command-palette.tsx`, `pages/mobile-layout.tsx`, `pages/layout.tsx` | `opencode-recent-projects`, `opencode.projects` | global | high | Split project history/list data by selected server. |
| `context/saved-prompts.tsx` | `opencode.savedPrompts.<directory>` | per-directory | medium | Add server prefix if prompts should be server-specific. |
| `context/permission.tsx` | `prokube-permission-autoaccept-<directory>` | per-directory | medium | Prefix with server key if trust differs by server. |
| `context/layout.tsx`, `pages/layout.tsx` | `opencode.layout`, `opencode.sidebarExpanded`, `opencode.showArchived`, `opencode.pinnedSessions.<directory>` | global/per-directory | high | Namespace layout and pinned/session UI by server+directory. |
| `pages/session.tsx`, `pages/mobile-layout.tsx`, `app.tsx` | `opencode.lastSession.<serverId>.<dir>` | per-server | medium | Use stable canonical server key and ignore stale unscoped keys. |
| `pages/session.tsx`, `pages/layout.tsx` | `opencode.pendingPrompt.<id>` | session-only | low/medium | Namespace by server if session IDs can overlap. |
| `utils/notify.ts`, `pages/session.tsx`, `pages/layout.tsx` | `opencode.sessionNotify` | session-only | low/medium | Namespace by server if session IDs can overlap. |
| `context/theme.tsx`, `utils/sound.ts`, `components/terminal.tsx`, `utils/extended-api.ts` | theme/sound/terminal/provider account prefs | global prefs | low | Leave global unless product requires per-server UX. |

## Priority Fix Order

1. Move/key selected-server boundary above `GlobalEventsProvider`, recent projects, saved prompts, and routes.
2. Make project history keys server-scoped (`opencode.projects` and `opencode-recent-projects`).
3. Ensure project picker/dialog API clients include selected server target.
4. Reset or namespace provider/model persistence that depends on server provider list.
