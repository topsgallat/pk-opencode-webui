Issue notes and hypotheses:
- Frontend shows pending /event SSE connection.
- listDirs call fails with 'TypeError: Failed to fetch' (likely backend unreachable or CORS).

---
# Investigation notes (auto-append)
Timestamp: 2026-03-30

Observed errors:
- Frontend: SSE to /event stays in "Pending" and client logs show reconnect loop handlers.
- Frontend: listDirs() call results in `TypeError: Failed to fetch` (network-level failure)

Hypotheses (prioritized):
1) API server (opencode serve) is not running or API_URL used by UI server points to unreachable host -> SSE proxy fails and API calls proxied to backend also fail. (Most likely)
2) UI server proxy misconfiguration: UI dev server or docker server strips or mis-prefixes the path, so request reaches wrong target (prefix mismatch). (Likely)
3) CORS or mixed-origin issues — unlikely because frontend talks to same origin UI server which proxies; but if serverUrl points to backend origin directly, browser will enforce CORS. (Possible)
4) Docker host naming mismatch (using 127.0.0.1 vs host.docker.internal) inside container -> UI cannot reach backend. (Likely in container setups)
5) Extended endpoint error: handleExtendedEndpoint returned 5xx or the process lacked permission to read directories -> list-dirs returns error response causing `fetch` to reject. (Possible)

Quick validation steps (run locally):
- Check backend: curl -v http://127.0.0.1:4096/health
- Check UI server SSE proxy: curl -v -N "http://localhost:3000/event" (or port 8080 in docker) and observe response or errors
- Check extended API: curl -v "http://localhost:3000/api/ext/list-dirs?directory=$HOME"
- Inspect UI server logs (dev.ts console or docker container logs) for "[Proxy] SSE" or "[ExtAPI] list-dirs" entries

Next actions:
- Confirm API_URL environment variable used by UI server (dev.ts/dockers) and whether backend is reachable from that host.
- If running in Docker, ensure extra_hosts and API_URL use host.docker.internal:4096 (linux) or appropriate host address.

2026-03-31T21:30:21+07:00 - diagnose-sse: Found ConfigProvider calling useEvents while mounted outside EventProvider in DirectoryLayout. Files: app-prefixable/src/context/config.tsx. Recommended: move ConfigProvider inside EventProvider in DirectoryLayout or guard useEvents. Full report saved to assistant output.
$(date --iso-8601=seconds) - Detailed findings for diagnose-sse

Summary:
- Identified one risky call site where useEvents() is invoked from a provider that is mounted above EventProvider in DirectoryLayout: app-prefixable/src/context/config.tsx
- This can throw "useEvents must be used within EventProvider" at runtime when visiting directory routes (e.g. /<dir>/session)

Findings:
1) /home/sgallat/pk-opencode-webui/app-prefixable/src/context/config.tsx:28
   - useEvents() is called at provider initialization inside ConfigProvider
   - ConfigProvider is mounted in DirectoryLayout BEFORE EventProvider (DirectoryLayout: SDKProvider -> ConfigProvider -> SyncProvider -> EventProvider -> ...)
   - Risk: useEvents() will run without EventProvider on directory routes and will throw (exact runtime error observed).
   - Suggested remediation (minimal):
     a) Move ConfigProvider to be inside EventProvider in /home/sgallat/pk-opencode-webui/app-prefixable/src/pages/directory-layout.tsx (place it below EventProvider), OR
     b) Make useEvents usage resilient: replace direct useEvents() call with a guarded lookup: const ctx = useContext(EventContext) and only call ctx methods if ctx is defined (avoid throw), or call useEvents() inside onMount where you can guard for context presence.
   - Repro steps:
     1. cd app-prefixable && bun run dev
     2. Open a project route that uses DirectoryLayout, e.g. http://localhost:3000/<base64-encoded-path>/session
     3. Check browser console for: "Error: useEvents must be used within EventProvider"

Other checked call sites (no immediate risk found):
- /home/sgallat/pk-opencode-webui/app-prefixable/src/pages/layout.tsx:239 - Layout uses useEvents(); Layout is mounted inside EventProvider by DirectoryLayout -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/pages/session.tsx:93 - Session uses useEvents(); mounted under Layout inside EventProvider -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/components/project-dialog.tsx:63 - ProjectDialog uses useEvents(); mounted inside HomeLayout and Layout which both provide EventProvider -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/components/command-palette.tsx:33 - CommandPalette uses useEvents(); mounted in Layout -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/components/review-panel.tsx:46 - ReviewPanel uses useEvents(); mounted in Session -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/components/session-sidebar.tsx:21 - SessionSidebar uses useEvents(); mounted in Session -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/pages/mobile-layout.tsx:51 - MobileLayout uses useEvents(); used by Layout -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/context/mcp.tsx:70 - MCPProvider uses useEvents(); MCPProvider is mounted inside EventProvider in DirectoryLayout -> SAFE
- /home/sgallat/pk-opencode-webui/app-prefixable/src/context/permission.tsx:32 - PermissionProvider uses useEvents(); mounted inside EventProvider -> SAFE

