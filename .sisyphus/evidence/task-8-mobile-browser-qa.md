# Task 8: Mobile Browser QA

## Status

Blocked in this environment; not passed.

## What was attempted

1. Rebuilt frontend:
   - `cd app-prefixable && bun run build.ts`
   - Result: pass, `JS build completed: 698 files`.

2. Checked local UI/server availability:
   - `http://127.0.0.1:3000`: connection refused.
   - attempted to start dev server, but default `PORT=8080` was already in use.
   - `http://127.0.0.1:8080`: reachable and serves the UI.
   - `http://127.0.0.1:8080/session`: reachable through the UI proxy and returns sessions.
   - `http://127.0.0.1:4097/session`: connection refused; no second local backend exists.

3. Attempted Playwright mobile browser QA:
   - Tool: Playwright MCP `browser_resize`.
   - Result: blocked because Chrome is missing:
     `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`.

## Why T8 cannot be honestly marked as passed

The required acceptance scenario needs two distinguishable OpenCode backends and a working browser automation runtime:

- Server A with A-only project/session/chat data.
- Server B with B-only project/session/chat data.
- Mobile browser interaction to switch A → B → A.
- Network evidence proving post-switch requests target the selected server.

This environment currently has only one reachable backend and no usable Chrome binary for Playwright MCP.

## Partial evidence

- Existing UI on port `8080` responds.
- Existing proxy session endpoint responds.
- Build passes after the server-boundary fixes.

## Required external verification

Run the pushed `dev` branch in an environment with:

1. Two real OpenCode servers configured with distinct data.
2. Browser automation or manual browser access.
3. Mobile viewport.

Then verify:

- A-only chat text disappears immediately after switching to B.
- B-only sessions/projects/chats appear without refresh.
- Switching B → A restores A-only data and removes B-only data.
- Network requests/SSE after each switch target the selected backend.
