## 2026-04-27
- Kept the JSX structure inside `SDKProvider` unchanged and wrapped it only with a keyed `For` as requested.
- Used `createMemo` for the PTY client so all PTY calls stay aligned with the active server URL.
- Chose `server.selectedServer()?.id ?? "default"` as the outer key so the subtree remounts even when no server is explicitly selected.
