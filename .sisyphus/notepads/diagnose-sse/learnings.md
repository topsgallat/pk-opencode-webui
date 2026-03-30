Placeholder for learnings about SSE and listDirs investigation.

---
# Findings (auto-append)
Timestamp: 2026-03-30

Summary:
- Frontend opens SSE connections to a prefixed `/event` endpoint via prefix(`/event${dirParam}`) in multiple places (events.tsx, sync.tsx, global-events.tsx).
- The UI server (dev.ts / docker/serve-ui.ts) proxies `/event` to the OpenCode API (API_URL) and specially forwards the response body as text/event-stream.
- The extended directory-listing API `GET /api/ext/list-dirs` is implemented in shared/extended-api.ts and called by frontend via utils/extended-api.ts -> listDirs(serverUrl,...).
- `serverUrl` is derived from window.__OPENCODE__.serverUrl or window.origin + basePath (see app-prefixable/src/utils/path.ts).

Important notes:
- list-dirs is handled by the UI server (handleExtendedEndpoint) — it does not forward to the OpenCode backend. Therefore a `Failed to fetch` from listDirs implies the UI server failed to answer the request (network error, wrong origin, or the browser blocked the call), not the backend directly.
- SSE `/event` is proxied through the UI server to the API_URL. If API server is down or API_URL misconfigured, the UI SSE proxy will fail and the browser will show a persistent pending/reconnect loop.

Key files referenced:
- app-prefixable/src/context/events.tsx — EventSource connect + reconnect logic
- app-prefixable/src/context/sync.tsx — SSE connect + event handling for session sync
- app-prefixable/src/context/global-events.tsx — per-directory SSE connections for badges
- shared/extended-api.ts — implementation of /api/ext/list-dirs
- app-prefixable/src/utils/extended-api.ts — frontend listDirs() wrapper that calls the UI server
- app-prefixable/dev.ts and docker/serve-ui.ts — dev/prod UI servers that proxy /event and handle extended endpoints
 - 2026-03-30: UI proxy now strips upstream Content-Encoding, Transfer-Encoding, and Content-Length headers for regular proxied API responses to avoid ERR_CONTENT_DECODING_FAILED in browsers.
2026-03-30 22:07: UI proxy decompresses upstream compressed responses (gzip/deflate/br when available) for proxied API responses to avoid ERR_CONTENT_DECODING_FAILED
2026-03-30T22:10: implemented materialize-and-decompress for proxied API responses; set explicit Content-Length header to prevent Bun auto-recompression
