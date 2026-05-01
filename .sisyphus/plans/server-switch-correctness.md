# Server Switch Correctness

## TL;DR

> **Quick Summary**: Make server switching fully reactive by using key-based remount on SDKProvider subtrees in HomeLayout and DirectoryLayout. When the user selects a different server, all contexts (SSE, MCP, Config, Providers, Terminal) automatically reinitialize against the new server URL.
>
> **Deliverables**:
> - `home-layout.tsx` — SDKProvider subtree keyed by `selectedServer().id`
> - `directory-layout.tsx` — For key updated to combine `dir + selectedServer().id`
> - `server.tsx` — `setSelectedServer` navigates to home after switching (clears stale session list)
> - Build passes, no TypeScript errors
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — 3 sequential tasks (small scope, 3 files)
> **Critical Path**: Task 1 → Task 2 → Task 3 → Build verify

---

## Context

### Original Request
"วางแผนให้ครอบคลุมรองการสลับ server ทุกเคส ให้ทำงานได้อย่างสมบูรณ์แบบ"

### Interview Summary
**Key Discussions**:
- 5 broken layers identified: events.tsx (SSE), mcp.tsx, config.tsx, providers.tsx, terminal.tsx
- User chose key-based remount (simpler, correct, handles all layers automatically)
- Navigate home on server switch to avoid stale session list

**Research Findings**:
- `HomeLayout` (line 140): `<SDKProvider>` — no key, never remounts on server change ❌
- `DirectoryLayout` (line 57): `<For each={directories()}>` — keyed by `dir`, not by `dir+server` ❌
- `events.tsx` (line 88): SSE URL captured at `connect()` time via `url` from `useSDK()` — BUT since `url` is a getter, re-mounting SDKProvider will cause EventProvider to re-run `onMount` → reconnects to new URL ✅ (if remounted)
- `server.tsx` (line 32): `setSelectedServer` persists to localStorage but does NOT navigate ❌
- All stale stores (mcp, config, providers, terminal) use `onMount` — remount fixes them automatically ✅

### Metis Review
Metis unavailable (timeout). Self-assessment:
- **Gap**: HomeLayout creates its own `client` at line 42 with hardcoded `getServerUrl()` — this is used only for PTY operations. Must also switch to `useSDK()` client or close terminal on switch.
- **Gap**: Terminal panel in HomeLayout must be closed on server switch (can't use stale PTY).
- **Resolved**: key-based remount covers all context providers automatically.

---

## Work Objectives

### Core Objective
Key-based remount of SDKProvider subtrees ensures all dependent contexts (SSE, MCP, Config, Providers, Terminal) are destroyed and recreated with the new server URL when the user switches servers.

### Concrete Deliverables
- `app-prefixable/src/pages/home-layout.tsx` — SDKProvider keyed; terminal closed on switch; PTY client uses SDK
- `app-prefixable/src/pages/directory-layout.tsx` — For key = `dir + serverId`
- `app-prefixable/src/context/server.tsx` — navigate to home after switching (via callback or signal)

### Definition of Done
- [ ] Switching server in sidebar dropdown causes full reconnect (SSE closes/reopens to new URL)
- [ ] Switching server reloads MCP list, Config, Providers from new server
- [ ] Terminal panel closes automatically on server switch (no stale WS)
- [ ] `bun run build.ts` completes with 0 errors in `app-prefixable/`

### Must Have
- Key-based remount on SDKProvider in both HomeLayout and DirectoryLayout
- Terminal panel in HomeLayout closed when server changes
- Navigate to home (`/`) on server switch to prevent stale session list in sidebar

### Must NOT Have
- No new dependencies
- No `any` type
- No `else` clauses
- No hardcoded server URLs
- No per-provider `createEffect` workarounds (key-based remount is the chosen approach)
- No changes to events.tsx, mcp.tsx, config.tsx, providers.tsx, terminal.tsx (remount makes them correct automatically)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Agent-Executed QA**: YES (manual browser verification via Playwright)

### QA Policy
Playwright for UI verification. Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Sequential Tasks (small scope)

```
Task 1: Fix HomeLayout — SDKProvider key + terminal close + PTY client
Task 2: Fix DirectoryLayout — For key = dir + serverId
Task 3: Fix server.tsx — navigate home on switch
Task 4: Build verify
```

---

## TODOs

- [x] 1. Fix `home-layout.tsx` — SDKProvider key-based remount + terminal cleanup

  **What to do**:
  - Import `useServer` (already imported at line 11)
  - Wrap `<SDKProvider>...</SDKProvider>` (lines 140-371) inside a keyed wrapper. Use `<For each={[server.selectedServer()?.id ?? "default"]}>{() => <SDKProvider>...</SDKProvider>}</For>`. This forces SolidJS to remount the entire SDKProvider subtree when the server changes.
  - When server changes (i.e., the For remounts), the terminal panel will also be destroyed. But the PTY cleanup in `onCleanup` uses a `client` created at line 42 with hardcoded `getServerUrl()`. This stale client won't be able to clean up the PTY on the new server anyway. Accept this: `onCleanup` fires with the old client on the old server — PTY cleanup still works correctly for the old server before remount.
  - The `client` at line 42 is used only for PTY operations (toggleTerminal, onCleanup). This client is outside SDKProvider so it won't benefit from the new server URL after remount. Fix: replace `createOpencodeClient({ baseUrl: getServerUrl() })` with a reactive approach: remove the top-level `client` variable and instead use `useSDK()` inside the SDKProvider subtree. But wait — the terminal toggle function is defined outside SDKProvider in the current code. **Simplest fix**: move the terminal panel and its PTY logic inside the SDKProvider subtree (i.e., it already is, since `<Terminal>` and the toggle buttons are inside the JSX that's inside `<SDKProvider>`). The `client` at line 42 needs to become reactive. Simplest approach: replace line 42's `createOpencodeClient` with a memo that reads from `server.selectedServer()?.url ?? basePathServerUrl` — matching what `sdk.tsx` does. This way PTY ops always go to the currently selected server.
  - Also: close the terminal panel when the server key changes, to avoid showing a blank/dead terminal. Do this with a `createEffect` that watches `server.selectedServer()?.id` and calls `setTerminalOpen(false)` and `setTerminalPtyId(null)` when it changes.

  **Must NOT do**:
  - Don't change EventProvider, MCPProvider, ConfigProvider, ProviderProvider internals
  - Don't add per-provider createEffect
  - Don't use `any`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential — Task 1 first
  - **Blocks**: Tasks 2, 3 (independent but small, do sequentially)
  - **Blocked By**: None

  **References**:
  - `app-prefixable/src/pages/home-layout.tsx:26-373` — full file to modify
  - `app-prefixable/src/pages/directory-layout.tsx:49-82` — pattern: `<For each={directories()}>` with key — copy this pattern for HomeLayout
  - `app-prefixable/src/context/sdk.tsx:22-25` — how `url` is computed from `useServer()` — replicate for PTY client
  - `app-prefixable/src/utils/servers.ts` — `getDefaultServer()`, `builtinServer()` for fallback URL
  - `app-prefixable/src/utils/path.ts` — `getServerUrl()` (current hardcoded approach to replace)

  **Acceptance Criteria**:

  ```
  Scenario: Server switch remounts HomeLayout providers
    Tool: Playwright
    Preconditions: App loaded at http://localhost:3000, at least 2 servers configured
    Steps:
      1. Open browser devtools console
      2. Click Server icon in bottom-left sidebar
      3. Select a different server from dropdown
      4. Observe console logs for "[Events] Connecting to SSE:" — should show new server URL
    Expected Result: Console shows new SSE URL with new server's address
    Evidence: .sisyphus/evidence/task-1-sse-reconnect.png

  Scenario: Terminal closes on server switch
    Tool: Playwright
    Preconditions: Terminal panel open in HomeLayout
    Steps:
      1. Open terminal panel (click terminal icon)
      2. Switch to a different server
      3. Check terminal panel visibility
    Expected Result: Terminal panel is closed (not visible)
    Evidence: .sisyphus/evidence/task-1-terminal-closed.png
  ```

  **Commit**: YES (group with Task 2 and 3 in one commit)

---

- [x] 2. Fix `directory-layout.tsx` — For key includes server ID

  **What to do**:
  - Import `useServer` from `../context/server`
  - Add `const server = useServer()` at top of `DirectoryLayout`
  - Change `directories` memo from returning `[dir]` to returning `[dir + "|" + (server.selectedServer()?.id ?? "default")]`
  - This means when either the directory OR the server changes, the For remounts the entire provider subtree
  - The key inside the For should reflect this combined value — the `dir` variable passed to `SDKProvider directory={dir}` stays as the actual decoded path (just use the original `directory()` memo for `dir`)

  **Example**:
  ```tsx
  const server = useServer()
  const keys = createMemo(() => {
    const dir = directory()
    return dir ? [`${dir}|${server.selectedServer()?.id ?? "default"}`] : []
  })
  // In JSX:
  <For each={keys()} fallback={<Navigate href="/" />}>
    {(key: string) => {
      const dir = key.split("|")[0]  // extract original dir
      return (
        <SDKProvider directory={dir}>
          ...
        </SDKProvider>
      )
    }}
  </For>
  ```
  Wait — this is awkward because the key includes the server ID but we still need the `dir` for `SDKProvider`. Better approach: keep `directories` memo returning `[dir]` as before, but add a separate reactive signal for the server ID, and wrap the whole `<For>` in another `<For each={[serverId]}>` or use `<Show keyed>`. 
  
  **Cleanest approach**: Wrap the existing `<For each={directories()}>` in a `<For each={[server.selectedServer()?.id ?? "default"]}>` outer wrapper:
  ```tsx
  <For each={[server.selectedServer()?.id ?? "default"]}>
    {() => (
      <For each={directories()} fallback={<Navigate href="/" />}>
        {(dir: string) => (
          <SDKProvider directory={dir}>
            ...
          </SDKProvider>
        )}
      </For>
    )}
  </For>
  ```
  But SolidJS `<For>` only remounts when the array changes. Since `[server.selectedServer()?.id ?? "default"]` is always length-1, the inner function runs once. When the server changes, the outer For gets a new array with a different string — SolidJS will destroy and recreate the inner content.

  **Must NOT do**:
  - Don't change any provider internals
  - Don't add `else`
  - Don't add `any`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent of Task 1 at code level, but do sequentially for clarity)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `app-prefixable/src/pages/directory-layout.tsx:1-83` — full file
  - `app-prefixable/src/context/server.tsx:26-30` — `selectedServer()` accessor
  - `app-prefixable/src/pages/home-layout.tsx` — pattern from Task 1 for consistency

  **Acceptance Criteria**:

  ```
  Scenario: Server switch remounts DirectoryLayout providers
    Tool: Playwright
    Preconditions: App loaded at a project URL (/:dir/session), 2 servers configured
    Steps:
      1. Open devtools console
      2. Click Server icon in sidebar
      3. Select a different server
      4. Observe console logs for "[Events] Connecting to SSE:" — should show new server URL
    Expected Result: SSE reconnects to new server URL; console shows new connection
    Evidence: .sisyphus/evidence/task-2-directory-sse-reconnect.png
  ```

  **Commit**: YES (group with Tasks 1 and 3)

---

- [x] 3. Fix `server.tsx` — navigate to home on server switch

  **What to do**:
  - The `setSelectedServer` function needs to navigate to `/` after changing the server, to prevent the session list in the sidebar from showing sessions from the old server
  - Problem: `server.tsx` is a context provider with no access to the router. Cannot import `useNavigate` directly at module level.
  - Solution: Add an optional `onSwitch` callback to `ServerContextValue`. The caller (home-layout.tsx or layout.tsx) provides the callback when constructing the provider, or we expose a `switchServer` function that accepts a navigate callback.
  
  **Simpler solution**: Don't modify server.tsx. Instead, in `home-layout.tsx` and `layout.tsx` (which both have `useNavigate()`), intercept the server dropdown's `onClick` to call `navigate("/")` BEFORE or AFTER calling `server.setSelectedServer(s.id)`. Since key-based remount already handles the reconnect, navigation to home is just a UX nicety to avoid showing stale sessions in the sidebar momentarily.
  
  In `home-layout.tsx` line 247:
  ```tsx
  onClick={() => { server.setSelectedServer(s.id); setServerDropdownOpen(false) }}
  ```
  Change to:
  ```tsx
  onClick={() => { server.setSelectedServer(s.id); setServerDropdownOpen(false); navigate("/") }}
  ```
  
  In `layout.tsx`, find the equivalent server dropdown onClick and add `navigate(`/${dirSlug()}/session`)` or `navigate("/")` after `setSelectedServer`.
  
  Actually: navigate to `"/"` unconditionally — the home screen is the safest reset point. The user can then pick a project on the new server.

  **Must NOT do**:
  - Don't add navigate to server.tsx (no router access there)
  - Don't add `else`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on reading layout.tsx to find the dropdown)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `app-prefixable/src/pages/home-layout.tsx:247` — server dropdown onClick (already found)
  - `app-prefixable/src/pages/layout.tsx` — search for `setSelectedServer` call in server dropdown section

  **Acceptance Criteria**:

  ```
  Scenario: Server switch navigates to home
    Tool: Playwright
    Preconditions: App open at a project session URL (/:dir/session/:sessionId)
    Steps:
      1. Click Server icon in bottom-left sidebar
      2. Select a different server
      3. Observe URL in browser address bar
    Expected Result: URL changes to "/" (home screen)
    Evidence: .sisyphus/evidence/task-3-navigate-home.png
  ```

  **Commit**: YES (group with Tasks 1 and 2)
  - Message: `feat: key-based remount for server switching`
  - Files: `app-prefixable/src/pages/home-layout.tsx`, `app-prefixable/src/pages/directory-layout.tsx`, `app-prefixable/src/pages/layout.tsx`

---

- [x] 4. Build verification

  **What to do**:
  - Run `bun run build.ts` in `app-prefixable/`
  - Fix any TypeScript errors
  - Confirm build output exists in `dist/`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO — must run after Tasks 1-3
  - **Blocked By**: Tasks 1, 2, 3

  **Acceptance Criteria**:

  ```
  Scenario: Clean build
    Tool: Bash
    Steps:
      1. cd app-prefixable && bun run build.ts
    Expected Result: Exit code 0, no TypeScript errors, dist/ populated
    Evidence: Terminal output (no screenshot needed)
  ```

  **Commit**: NO (already committed in Task 3)

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Verify: key-based remount implemented in both HomeLayout and DirectoryLayout. Terminal closes on switch. Navigate to home on switch. Build passes.
  Output: `Must Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run build.ts`. Check for `any`, `else`, hardcoded URLs, unused imports.
  Output: `Build [PASS/FAIL] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Open app, add 2 servers, switch between them, observe SSE reconnect in console, verify session list refreshes, verify terminal closes.
  Output: `Scenarios [N/N pass] | VERDICT`

---

## Commit Strategy

- **1 commit** after all 3 code tasks: `feat: key-based remount for server switching`
- Files: `home-layout.tsx`, `directory-layout.tsx`, `layout.tsx`

---

## Success Criteria

### Verification Commands
```bash
cd app-prefixable && bun run build.ts  # Expected: exit 0, no errors
```

### Final Checklist
- [ ] SDKProvider in HomeLayout keyed by server ID
- [ ] For in DirectoryLayout keyed by dir + server ID
- [ ] Terminal panel closes on server switch
- [ ] Navigate to "/" on server switch
- [ ] Build passes
