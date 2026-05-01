# Task 2: Provider and Router Remount Boundary

## Current Tree

```text
App
└─ BasePathProvider
   └─ DeviceProvider
      └─ ThemeProvider
         └─ BrandingProvider
            └─ RecentProjectsProvider
               └─ SavedPromptsProvider(directory=activeDirectory)
                  └─ GlobalEventsProvider(projects, activeDirectory)
                     └─ CommandProvider
                        └─ ServerProvider
                           └─ Router routes
                              ├─ HomeLayout
                              │  └─ For selectedServer id
                              │     └─ SDK/Event/Config/Provider/MCP subtree
                              └─ DirectoryLayout
                                 └─ For selectedServer id
                                    └─ For directory
                                       └─ SDKProvider
                                          └─ SyncProvider
                                             └─ EventProvider
                                                └─ Config/File/Permission/Provider/MCP/Terminal/LayoutProvider
                                                   └─ Layout
                                                      └─ MobileLayout fallback on mobile
```

## What Remounts on Selected Server Change Today

- Home route subtree below `HomeLayout`'s selected-server `For`.
- Directory route subtree below `DirectoryLayout`'s selected-server `For`.
- `SDKProvider`, `SyncProvider`, `EventProvider`, `Layout`, `MobileLayout`, and `Session` if the route is inside the keyed directory subtree.

## What Survives Today

- `ServerProvider` itself.
- `GlobalEventsProvider` and any event/badge state inside it.
- `RecentProjectsProvider` and project history state.
- `SavedPromptsProvider` because it is above `ServerProvider` and keyed only by active directory.
- `CommandProvider`.
- Module-scope caches such as `Session` drafts if their keys are not server-scoped.

## Why Mobile Can Keep Stale Data

- `MobileLayout` is a fallback inside `Layout`; it relies on the parent subtree to remount and also has its own session/project state.
- Global project history survives server switch, so mobile can keep presenting old projects.
- `GlobalEventsProvider` remains connected to default/global state because it is above `ServerProvider` and cannot follow selected target.
- Route resets alone are insufficient if the project list, badges, provider models, and project picker clients still use server-blind state.

## Recommended Corrected Tree

```text
App
└─ BasePathProvider / DeviceProvider / ThemeProvider / BrandingProvider
   └─ ServerProvider
      └─ ServerScopedAppBoundary keyed by canonical server key
         ├─ RecentProjectsProvider(serverKey)
         ├─ SavedPromptsProvider(directory, serverKey)
         ├─ GlobalEventsProvider(serverKey, selected target)
         ├─ CommandProvider
         └─ Router routes
```

Under each route, `HomeLayout` and `DirectoryLayout` may keep their local keying, but the authoritative boundary should be higher so project history, global events, command palette, and route content reset as one unit.

## Implementation Notes

- Introduce a canonical stable server key from selected server id, falling back to `default`.
- Move server-aware providers under `ServerProvider` so they can read selected server context.
- Key the server-scoped app subtree with Solid `For` or equivalent so all server-derived UI state unmounts on switch.
- Keep truly global prefs (theme, branding, device, base path) outside this boundary.
