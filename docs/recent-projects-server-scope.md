# Recent Projects - Server-Scoped Verification

## Behavior
- Recent Projects list is **per server** (keyed by `serverKey`)
- Switching servers → list updates immediately (no stale projects)
- Empty server (no last session) → shows **Recent Projects** page
- Server name label shown next to "Recent Projects" heading

## Verified (Playwright, 2026-05-03)

| Switch | Result |
|---|---|
| Open project on **Local** (127.0.0.1:4096) | ✅ Added to Recent Projects |
| Switch to **Main** (192.168.1.173:4096) | ✅ Recent Projects **empty** (no stale from Local) |
| Switch back to **Local** | ✅ Recent Projects **shows** opened project |

## Evidence (Temporary - delete after verification)
- Screenshot: `.playwright-mcp/page-2026-05-03T13-03-03-714Z.png` (Main server, Recent Projects empty)
- Snapshot: `.playwright-mcp/page-2026-05-03T12-38-09-777Z.yml` (Local server, Recent Projects visible)

## How It Works
1. `ServerBoundary` uses SolidJS `Show keyed` → full remount on `serverKey` change
2. `RecentProjectsProvider` loads from `localStorage` keyed by `serverKey`
3. `layout.tsx` / `mobile-layout.tsx` add `?server-switch=1` on server switch
4. `getLastSessionHref()` routes to `/` (Recent Projects) when no last session + server-switch flag

## Related Commits (dev)
`32bda76`, `9c6105f`, `da15426`, `3c7cb63`, `03c8815`, `df9a25b`
