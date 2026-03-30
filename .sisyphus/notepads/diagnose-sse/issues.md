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

