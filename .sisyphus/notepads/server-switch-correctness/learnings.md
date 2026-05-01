## 2026-04-27
- `HomeLayout` now derives PTY client URLs from `server.selectedServer()?.url` with a `useBasePath()` fallback.
- A keyed `<For>` around `SDKProvider` forces a full subtree remount on server ID changes, which resets provider state cleanly.
- Closing the terminal panel on server switch is enough when the terminal component handles PTY cleanup on unmount.
- Wrapping the existing directory-keyed `<For>` in an outer server-keyed `<For>` remounts the whole provider subtree on server changes without altering directory remount behavior.
- Multi-server browser traffic must stay same-origin and carry the selected backend as proxy metadata (`x-opencode-target` / `?target=`); direct browser requests to the selected server break sessions, SSE, and PTY on CORS.
- Server switching must preserve the project route (`/${dir}/session`) instead of forcing `navigate("/")`, otherwise the session/chat tree disappears by design.
