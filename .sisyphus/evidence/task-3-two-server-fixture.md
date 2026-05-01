# Task 3: Two-Server QA Fixture and Observability

## Probe Results

Executed from `/home/sgallat/pk-opencode-webui` during `/start-work mobile-server-switch-correctness`.

| URL | Result | Notes |
|---|---:|---|
| `http://127.0.0.1:3000` | connection refused | UI dev server is not currently running. |
| `http://127.0.0.1:4096/session` | HTTP 401 | OpenCode backend appears reachable but requires auth/proxy context. |
| `http://localhost:4096/session` | HTTP 401 | Loopback alias reaches same backend. |
| `http://127.0.0.1:4097/session` | connection refused | No second local backend currently running on 4097. |
| `http://localhost:4097/session` | connection refused | No second local backend currently running on 4097. |

## Fixture Strategy

The final browser QA must not use `localhost:4096` and `127.0.0.1:4096` as the only proof, because those aliases can point to the same backend. The required fixture is:

- Server A: default/backend from `API_URL` (`http://127.0.0.1:4096` in local dev), with an A-only project/session/chat marker.
- Server B: a genuinely separate OpenCode backend, ideally `http://127.0.0.1:4097` or the user's LAN server, with a B-only project/session/chat marker.
- UI dev server: `app-prefixable` on port 3000 or configured `PORT`.

## Network Assertions

After switching to Server B:

- HTTP API requests should go through the same-origin UI proxy with `x-opencode-target` set to Server B for SDK requests.
- SSE/EventSource URLs should include `?target=<Server B URL>` when Server B is non-default.
- Any PTY WebSocket URL should include `?target=<Server B URL>` when applicable.

## Risk

At the time of this evidence capture, only one reachable backend was observed locally. Implementation can proceed, but final QA must start or use a real second backend before marking T8 complete.
