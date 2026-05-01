# Mobile Server Switch Correctness Plan

## TL;DR

> **Quick Summary**: Rebuild server switching around a strict selected-server state boundary so mobile project/session/chat data cannot leak across OpenCode servers. The work starts with an audit that traces every state source, then patches provider remounts, storage keys, route resets, and QA with two distinguishable servers.
>
> **Deliverables**:
> - Verified server-state boundary for mobile and desktop
> - Server-scoped project/session/chat persistence
> - Mobile switch flow that immediately leaves old server chat and loads selected server data
> - Two-server browser QA evidence
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: T1/T2 audit → T4 boundary patch → T6 mobile flow → T8 QA

---

## Context

### Original Request
The user wants mobile server switching to work correctly: after selecting another server, projects, sessions, and chats should immediately belong to the selected server. Current behavior still shows and opens old server data.

### Interview Summary
**Key Discussions**:
- Server button is visible on mobile after previous fix.
- Actual data isolation remains broken: session, project, and chat do not change after server switch.
- User requested a fresh correction plan rather than another ad hoc patch.

**Research Findings**:
- Prior architecture uses same-origin proxy plus selected `targetUrl` for remote servers.
- Existing provider keying exists in `HomeLayout` and `DirectoryLayout`, but stale mobile state indicates a missing or misplaced boundary.
- `GlobalEventsProvider`, recent projects, route indexes, `lastSession`, and mobile-local session loading are likely stale state sources.
- Metis consultation timed out twice; this plan compensates with explicit audit and review tasks.

### Metis Review
**Identified Gaps** (addressed):
- Metis unavailable due timeout: added discovery wave before implementation.
- Hidden stale state risk: all storage and providers must be audited, not only mobile UI.
- QA risk: must test with two servers containing distinguishable data.

---

## Work Objectives

### Core Objective
Make selected server a hard state boundary across the app so mobile switching cannot display or interact with project/session/chat data from a previously selected server.

### Concrete Deliverables
- A documented state-source map for server-derived data.
- Patched app/provider boundaries where selected server changes remount or refresh all server-derived state.
- Server-scoped persistence keys for project recents, last session, notification/session state if needed.
- Mobile server switch action that routes to the selected server's safe landing state and reloads sessions/projects.
- Browser QA evidence proving two-server isolation.

### Definition of Done
- [ ] Build passes: `cd app-prefixable && bun run build.ts`
- [ ] Mobile browser QA shows server A data, switches to server B, then shows only server B projects/sessions/chats.
- [ ] Direct old server-A session URL after switching to server B redirects or errors safely; it must not show cached server-A chat.
- [ ] Network requests after switch target selected server only.

### Must Have
- Server switch must affect projects, sessions, chat messages, event status, and session list immediately.
- No stale session messages from old server may remain visible after switch.
- Mobile and desktop must use the same underlying state-boundary semantics.

### Must NOT Have (Guardrails)
- Do not add another superficial UI-only switch.
- Do not hardcode server URLs or colors.
- Do not break same-origin proxy / prefix-aware routing.
- Do not require manual refresh after server switch.
- Do not store server-specific state under server-blind localStorage keys.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES - build scripts exist; browser QA via Playwright should be used.
- **Automated tests**: Tests-after where practical; primary proof is browser/network QA.
- **Framework**: Bun build, Playwright browser QA.

### QA Policy
Every implementation task includes agent-executed QA. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```text
Wave 1 (Audit + foundations, parallel):
├── T1: Map all server-derived state and storage keys [deep]
├── T2: Trace provider/router remount boundaries [deep]
├── T3: Establish two-server QA fixture and observability [unspecified-high]

Wave 2 (Implementation, parallel where safe):
├── T4: Introduce canonical server key and boundary utilities (depends: T1, T2) [unspecified-high]
├── T5: Scope persistence keys by server (depends: T1, T4) [quick]
├── T6: Fix mobile switch route/state reset (depends: T2, T4) [quick]
├── T7: Make global events/projects target-aware or server-scoped (depends: T1, T4) [deep]

Wave 3 (Integration + verification):
├── T8: End-to-end two-server browser QA (depends: T4-T7) [unspecified-high]
├── T9: Regression hardening and cleanup (depends: T8) [quick]

Wave FINAL:
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA via browser automation (unspecified-high + playwright)
└── F4: Scope fidelity check (deep)
```

### Dependency Matrix
- **T1**: blocks T4, T5, T7
- **T2**: blocks T4, T6
- **T3**: blocks T8
- **T4**: blocked by T1, T2; blocks T5, T6, T7, T8
- **T5**: blocked by T1, T4; blocks T8
- **T6**: blocked by T2, T4; blocks T8
- **T7**: blocked by T1, T4; blocks T8
- **T8**: blocked by T3-T7; blocks T9 and final review
- **T9**: blocked by T8

### Agent Dispatch Summary
- **Wave 1**: T1 → `deep`, T2 → `deep`, T3 → `unspecified-high`
- **Wave 2**: T4 → `unspecified-high`, T5 → `quick`, T6 → `quick`, T7 → `deep`
- **Wave 3**: T8 → `unspecified-high`, T9 → `quick`
- **FINAL**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` + `playwright`, F4 → `deep`

---

## TODOs

- [ ] 1. Map all server-derived state and storage keys

  **What to do**:
  - Search and document every use of server selection, client/provider state, session lists, message caches, project recents, last-session keys, notification keys, and event subscriptions.
  - Classify each source as global, per-directory, or per-server.
  - Identify every place currently using server-blind persistence.

  **Must NOT do**:
  - Do not patch code in this task except temporary diagnostics that are removed before completion.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires full code-path analysis across router, providers, localStorage, and event streams.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` - not a visual design task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 with T2, T3
  - **Blocks**: T4, T5, T7
  - **Blocked By**: None

  **References**:
  - `app-prefixable/src/context/server.tsx` - Selected server state and server list refresh.
  - `app-prefixable/src/context/sdk.tsx` - Target URL derivation and OpenCode client creation.
  - `app-prefixable/src/context/sync.tsx` - Session/message/provider store and SSE bootstrap.
  - `app-prefixable/src/context/events.tsx` - Event/status subscription state.
  - `app-prefixable/src/context/global-events.tsx` - Cross-project event badges that may sit outside server target boundary.
  - `app-prefixable/src/context/recent-projects.tsx` - Project persistence likely shared across servers.
  - `app-prefixable/src/pages/session.tsx` - Message rendering, last-session persistence, route-driven session sync.
  - `app-prefixable/src/pages/mobile-layout.tsx` - Mobile-local session list and switch UI.

  **Acceptance Criteria**:
  - [ ] Produce `.sisyphus/evidence/task-1-state-map.md` listing all server-derived state and whether it is correctly server-scoped.
  - [ ] Every risky storage key has an owner file and proposed fix.

  **QA Scenarios**:
  ```text
  Scenario: State map covers all server-related files
    Tool: Bash
    Preconditions: Repository checked out on dev branch.
    Steps:
      1. Run content searches for `useServer`, `selectedServer`, `opencode.lastSession`, `opencode.projects`, `EventSource`, `session.list`, and `createOpencodeClient`.
      2. Compare search output against `.sisyphus/evidence/task-1-state-map.md`.
    Expected Result: Every matched state-bearing file appears in the map.
    Failure Indicators: Any matched file omitted from the state map.
    Evidence: .sisyphus/evidence/task-1-state-map.md

  Scenario: No premature code patch in audit task
    Tool: Bash
    Preconditions: Task 1 complete.
    Steps:
      1. Run `git diff --stat`.
      2. Confirm only evidence markdown changed for Task 1.
    Expected Result: No source code changes from Task 1.
    Evidence: .sisyphus/evidence/task-1-diff.txt
  ```

  **Commit**: NO

- [ ] 2. Trace provider/router remount boundaries

  **What to do**:
  - Trace actual component tree from `App` through `Router`, `ServerProvider`, `GlobalEventsProvider`, `HomeLayout`, `DirectoryLayout`, `Layout`, and `MobileLayout`.
  - Identify which providers remount when selected server changes and which remain alive.
  - Decide the minimal safe boundary: either move `ServerProvider` higher/lower, key a router subtree, or introduce a canonical server boundary component.

  **Must NOT do**:
  - Do not assume existing `<For each={[server.selectedServer()?.id]}>` is sufficient until verified in the rendered tree.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires SolidJS reactivity and routing lifecycle reasoning.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `playwright` - this task is static/dynamic tracing, not browser QA.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 with T1, T3
  - **Blocks**: T4, T6
  - **Blocked By**: None

  **References**:
  - `app-prefixable/src/app.tsx` - Provider ordering around Router and ServerProvider.
  - `app-prefixable/src/pages/directory-layout.tsx` - Directory-scoped provider keying.
  - `app-prefixable/src/pages/home-layout.tsx` - Home provider keying and desktop switch behavior.
  - `app-prefixable/src/pages/layout.tsx` - Mobile fallback selection.
  - `app-prefixable/src/pages/mobile-layout.tsx` - Mobile persistent tab state.

  **Acceptance Criteria**:
  - [ ] Produce `.sisyphus/evidence/task-2-remount-boundary.md` with the current tree and proposed corrected tree.
  - [ ] Identify exact components that must unmount on server switch.

  **QA Scenarios**:
  ```text
  Scenario: Boundary trace includes mobile route
    Tool: Bash
    Preconditions: Task 2 complete.
    Steps:
      1. Review `.sisyphus/evidence/task-2-remount-boundary.md`.
      2. Confirm it includes `MobileLayout`, `Session`, `SyncProvider`, `EventProvider`, and `GlobalEventsProvider`.
    Expected Result: Mobile path is explicitly traced end-to-end.
    Evidence: .sisyphus/evidence/task-2-remount-boundary.md

  Scenario: Proposed boundary explains stale chat prevention
    Tool: Bash
    Preconditions: Task 2 complete.
    Steps:
      1. Search the boundary document for `messages`, `sessions`, and `projects`.
      2. Confirm each has an unmount/refresh mechanism.
    Expected Result: All three data classes are covered.
    Evidence: .sisyphus/evidence/task-2-boundary-check.txt
  ```

  **Commit**: NO

- [ ] 3. Establish two-server QA fixture and observability

  **What to do**:
  - Start or identify two OpenCode servers reachable through the UI proxy.
  - Seed or select distinguishable data: server A project/session/chat names differ from server B.
  - Define network assertions for selected target: HTTP header `x-opencode-target` or `?target=` for SSE/WS.

  **Must NOT do**:
  - Do not rely on two aliases pointing to the same backend as the only proof.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires environment setup, browser/network observation, and evidence capture.
  - **Skills**: [`playwright`]
    - `playwright`: Browser-driven mobile viewport and network verification.
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` - not design work.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 with T1, T2
  - **Blocks**: T8
  - **Blocked By**: None

  **References**:
  - `app-prefixable/dev.ts` - Development proxy target override behavior.
  - `docker/serve-ui.ts` - Production proxy target override behavior.
  - `app-prefixable/src/utils/path.ts:appendTargetParam` - SSE/WS target query handling.

  **Acceptance Criteria**:
  - [ ] Evidence lists server A URL, server B URL, and their distinct visible sessions/chats.
  - [ ] Evidence includes at least one network request after switching that targets server B.

  **QA Scenarios**:
  ```text
  Scenario: Two distinguishable servers are available
    Tool: Bash + curl
    Preconditions: Dev UI can reach both servers.
    Steps:
      1. Query server A session list through proxy target override.
      2. Query server B session list through proxy target override.
      3. Save response bodies.
    Expected Result: Responses are both successful and distinguishable.
    Evidence: .sisyphus/evidence/task-3-two-server-fixture.json

  Scenario: Mobile viewport can observe target routing
    Tool: Playwright
    Preconditions: UI running with two configured servers.
    Steps:
      1. Open app in mobile viewport.
      2. Switch to server B.
      3. Capture network requests for `/session` and `/event`.
    Expected Result: Requests after switch include server B target routing.
    Evidence: .sisyphus/evidence/task-3-network-targets.json
  ```

  **Commit**: NO

- [ ] 4. Introduce canonical selected-server boundary

  **What to do**:
  - Implement a single canonical server key utility or memo used consistently for remounts and persistence.
  - Ensure all server-derived providers/components unmount or reset when the key changes.
  - Prefer a centralized boundary near the provider tree over scattered resets.

  **Must NOT do**:
  - Do not key only the visible mobile button or only `MobileLayout`; the boundary must cover chat/session stores.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Cross-cutting provider/router change.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `playwright` - verification comes in T8.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 foundation
  - **Blocks**: T5, T6, T7, T8
  - **Blocked By**: T1, T2

  **References**:
  - `app-prefixable/src/context/server.tsx` - Source of selected server id.
  - `app-prefixable/src/app.tsx` - Candidate for server-bound subtree.
  - `app-prefixable/src/pages/directory-layout.tsx` - Existing keying that may need correction or relocation.
  - `app-prefixable/src/pages/home-layout.tsx` - Existing keying that must remain compatible.

  **Acceptance Criteria**:
  - [ ] One canonical server key is used for remounting all server-derived state.
  - [ ] `SyncProvider` and `EventProvider` are guaranteed to recreate on server switch.
  - [ ] No duplicate or competing server keys remain.

  **QA Scenarios**:
  ```text
  Scenario: Provider state remounts on selected server change
    Tool: Playwright
    Preconditions: Dev app running with two configured servers.
    Steps:
      1. Open mobile app on server A and record visible session title A.
      2. Switch to server B.
      3. Observe session list loading/replacement without page refresh.
    Expected Result: Server A session title disappears and server B data appears.
    Evidence: .sisyphus/evidence/task-4-remount-mobile.png

  Scenario: Old chat store is not retained
    Tool: Playwright
    Preconditions: Server A chat open; server B has different or no matching session.
    Steps:
      1. Open server A chat with unique text `SERVER_A_ONLY_CHAT`.
      2. Switch to server B.
      3. Search visible DOM text for `SERVER_A_ONLY_CHAT`.
    Expected Result: Text is absent after switch.
    Evidence: .sisyphus/evidence/task-4-chat-absence.json
  ```

  **Commit**: YES
  - Message: `fix: isolate app state by selected server`
  - Files: Determined by T1/T2, likely provider/router files.
  - Pre-commit: `cd app-prefixable && bun run build.ts`

- [ ] 5. Scope persistence keys by server

  **What to do**:
  - Update server-specific localStorage/sessionStorage keys to include canonical server key.
  - Migrate or safely ignore old server-blind keys to avoid reopening stale sessions.
  - Include last session, project recents if server-specific, pinned/archived UI state if audit says server-derived.

  **Must NOT do**:
  - Do not globally delete user data unless the plan documents why; prefer scoped migration or fallback.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused storage-key updates after T1 identifies exact keys.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` - no UI design.

  **Parallelization**:
  - **Can Run In Parallel**: YES, after T4
  - **Parallel Group**: Wave 2 with T6/T7 if file ownership does not conflict
  - **Blocks**: T8
  - **Blocked By**: T1, T4

  **References**:
  - `app-prefixable/src/app.tsx:getLastSessionHref` - Last-session redirect.
  - `app-prefixable/src/pages/session.tsx` - Last-session read/write/clear.
  - `app-prefixable/src/pages/mobile-layout.tsx` - Mobile last-session read and project history.
  - `app-prefixable/src/context/recent-projects.tsx` - Recent projects persistence.
  - `app-prefixable/src/pages/layout.tsx` - Sidebar/pinned/session UI storage keys.

  **Acceptance Criteria**:
  - [ ] No server-derived key remains server-blind.
  - [ ] Old server-blind lastSession no longer auto-opens stale chat after switching.

  **QA Scenarios**:
  ```text
  Scenario: Last session is isolated per server
    Tool: Playwright
    Preconditions: Server A and B each have distinct last sessions.
    Steps:
      1. Open session A on server A.
      2. Switch to server B and open session B.
      3. Switch back to server A.
    Expected Result: Server A restores session A; server B restores session B; neither shows the other.
    Evidence: .sisyphus/evidence/task-5-last-session-isolation.json

  Scenario: Old unscoped key cannot force stale chat
    Tool: Playwright + browser localStorage
    Preconditions: Browser dev context available.
    Steps:
      1. Set old key `opencode.lastSession.<dir>` to a server A session id.
      2. Select server B and navigate to project session index.
      3. Observe route and visible chat.
    Expected Result: Old unscoped key is ignored or cleared; server A chat not displayed.
    Evidence: .sisyphus/evidence/task-5-old-key-ignored.json
  ```

  **Commit**: YES
  - Message: `fix: scope session persistence by server`
  - Files: Storage users identified by T1.
  - Pre-commit: `cd app-prefixable && bun run build.ts`

- [ ] 6. Fix mobile switch route and local state reset

  **What to do**:
  - On mobile server selection, immediately close old chat context and navigate to a safe selected-server route.
  - Reset mobile-local tab/session-list/search/archive/menu state that can hold old server data.
  - Ensure mobile session list bootstraps from selected server after switch.

  **Must NOT do**:
  - Do not rely on user manually tapping Sessions or refreshing.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused mobile behavior once boundary exists.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` - no new visual design required.

  **Parallelization**:
  - **Can Run In Parallel**: YES, after T4
  - **Parallel Group**: Wave 2 with T5/T7 if no file conflicts
  - **Blocks**: T8
  - **Blocked By**: T2, T4

  **References**:
  - `app-prefixable/src/pages/mobile-layout.tsx` - Server bottom sheet, tabs, mobile session list.
  - `app-prefixable/src/pages/layout.tsx` - Desktop switch route behavior to compare.
  - `app-prefixable/src/pages/session.tsx` - Chat state that must unmount or clear.

  **Acceptance Criteria**:
  - [ ] Switching server on mobile leaves old chat view immediately.
  - [ ] Mobile session tab shows selected server sessions after loading.
  - [ ] Search/menu/archive state from old server is cleared.

  **QA Scenarios**:
  ```text
  Scenario: Mobile switch exits old chat immediately
    Tool: Playwright
    Preconditions: Mobile viewport; server A chat with unique visible text is open.
    Steps:
      1. Tap Server tab/button.
      2. Select server B.
      3. Wait up to 3 seconds for route/state update.
    Expected Result: URL is project session landing or selected-server route; old chat text absent.
    Evidence: .sisyphus/evidence/task-6-mobile-exit-old-chat.png

  Scenario: Mobile sessions reload from selected server
    Tool: Playwright
    Preconditions: Server B has unique session title `SERVER_B_ONLY_SESSION`.
    Steps:
      1. Switch from server A to server B.
      2. Open Sessions tab if not already visible.
      3. Assert `SERVER_B_ONLY_SESSION` is visible and server A-only title is absent.
    Expected Result: Only selected-server sessions are visible.
    Evidence: .sisyphus/evidence/task-6-mobile-session-list.json
  ```

  **Commit**: YES
  - Message: `fix: reset mobile view on server switch`
  - Files: `app-prefixable/src/pages/mobile-layout.tsx` and related route files if needed.
  - Pre-commit: `cd app-prefixable && bun run build.ts`

- [ ] 7. Make global events/projects server-aware

  **What to do**:
  - Audit and patch `GlobalEventsProvider` and project/recent-project logic so badges/project lists do not imply old server data is selected.
  - Decide whether projects are global shortcuts or per-server recents; implement consistently.
  - Ensure global event SSE uses selected target or is remounted under selected server.

  **Must NOT do**:
  - Do not leave project badges/status from server A visible while server B is selected.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cross-cutting event and project semantics need careful design.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `playwright` - verification in T8.

  **Parallelization**:
  - **Can Run In Parallel**: YES, after T4
  - **Parallel Group**: Wave 2 with T5/T6 if file ownership does not conflict
  - **Blocks**: T8
  - **Blocked By**: T1, T4

  **References**:
  - `app-prefixable/src/context/global-events.tsx` - Cross-project events/badges.
  - `app-prefixable/src/context/recent-projects.tsx` - Recent project storage.
  - `app-prefixable/src/pages/home-layout.tsx` - Project sidebar list and global event badges.
  - `app-prefixable/src/pages/mobile-layout.tsx` - Mobile project history.

  **Acceptance Criteria**:
  - [ ] Event/status badges correspond to selected server only.
  - [ ] Project history behavior is explicitly either per-server or global with no stale sessions.
  - [ ] Network stream after server switch targets selected server.

  **QA Scenarios**:
  ```text
  Scenario: Global events target selected server
    Tool: Playwright network capture
    Preconditions: Two servers configured.
    Steps:
      1. Select server A and capture global/event requests.
      2. Switch to server B and capture new event requests.
    Expected Result: Active event stream uses server B target after switch; server A stream is closed or inactive.
    Evidence: .sisyphus/evidence/task-7-global-events-target.json

  Scenario: Project history does not open stale server session
    Tool: Playwright
    Preconditions: Project exists in history and has different sessions per server.
    Steps:
      1. Select server B.
      2. Open project from mobile project history.
      3. Observe session landing and list.
    Expected Result: Project opens against server B only; no server A chat appears.
    Evidence: .sisyphus/evidence/task-7-project-history-server-scope.png
  ```

  **Commit**: YES
  - Message: `fix: make project events server aware`
  - Files: Event/project context files identified by T1.
  - Pre-commit: `cd app-prefixable && bun run build.ts`

- [ ] 8. End-to-end two-server browser QA

  **What to do**:
  - Run full mobile QA with two distinguishable servers.
  - Verify project list, session list, chat messages, SSE, HTTP, and terminal/WS if terminal is available on mobile path.
  - Capture screenshots and network evidence.

  **Must NOT do**:
  - Do not mark complete using build-only verification.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Hands-on browser QA and failure triage.
  - **Skills**: [`playwright`]
    - `playwright`: Required for mobile browser interactions and evidence.
  - **Skills Evaluated but Omitted**: `git-master` - commit work handled separately.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: T9, final verification
  - **Blocked By**: T3-T7

  **References**:
  - `.sisyphus/evidence/task-3-two-server-fixture.json` - Fixture data.
  - `app-prefixable/src/pages/mobile-layout.tsx` - Mobile interactions.
  - `app-prefixable/src/context/sdk.tsx` - Targeted requests.
  - `app-prefixable/dev.ts` - Proxy behavior in dev.

  **Acceptance Criteria**:
  - [ ] Browser evidence proves A → B → A switching without stale data.
  - [ ] Network evidence proves requests target the selected server after each switch.
  - [ ] No console errors during switch.

  **QA Scenarios**:
  ```text
  Scenario: Full mobile A to B switch
    Tool: Playwright
    Preconditions: Server A has `SERVER_A_ONLY_SESSION`; server B has `SERVER_B_ONLY_SESSION`.
    Steps:
      1. Open app in mobile viewport on server A.
      2. Open server A chat and assert `SERVER_A_ONLY_CHAT` visible.
      3. Switch to server B using mobile Server control.
      4. Assert `SERVER_A_ONLY_CHAT` absent and `SERVER_B_ONLY_SESSION` visible.
      5. Open server B chat and assert `SERVER_B_ONLY_CHAT` visible.
    Expected Result: Selected server data replaces old data with no manual refresh.
    Evidence: .sisyphus/evidence/task-8-mobile-a-to-b.webm

  Scenario: Full mobile B back to A switch
    Tool: Playwright
    Preconditions: Scenario above completed.
    Steps:
      1. Switch from server B back to server A.
      2. Assert server B-only text is absent.
      3. Assert server A session list/chat can be opened again.
    Expected Result: Switching is reversible and isolated.
    Evidence: .sisyphus/evidence/task-8-mobile-b-to-a.webm
  ```

  **Commit**: NO

- [ ] 9. Regression hardening and cleanup

  **What to do**:
  - Remove temporary diagnostics.
  - Run build and any available lint/type checks.
  - Commit final cleanup if QA found small issues.

  **Must NOT do**:
  - Do not hide failures with broad catches or stale fallback UI.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Final cleanup and verification.
  - **Skills**: [`git-master`]
    - `git-master`: Use only if creating final commit/push.
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` - no design changes.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 final task
  - **Blocks**: final verification
  - **Blocked By**: T8

  **References**:
  - All changed files from T4-T7.
  - `AGENTS.md` - Code style and git workflow.

  **Acceptance Criteria**:
  - [ ] `cd app-prefixable && bun run build.ts` passes.
  - [ ] Git diff contains no debug logs or temporary evidence-only code.
  - [ ] Relevant commits are pushed only if user requests push.

  **QA Scenarios**:
  ```text
  Scenario: Production build passes
    Tool: Bash
    Preconditions: All implementation patches applied.
    Steps:
      1. Run `cd app-prefixable && bun run build.ts`.
    Expected Result: Build exits 0 and reports JS build completed.
    Evidence: .sisyphus/evidence/task-9-build.txt

  Scenario: No debug leftovers
    Tool: Bash
    Preconditions: Cleanup complete.
    Steps:
      1. Search changed files for temporary debug markers and console logs introduced by this work.
      2. Review git diff.
    Expected Result: No temporary diagnostics remain.
    Evidence: .sisyphus/evidence/task-9-cleanup.txt
  ```

  **Commit**: YES if cleanup changes exist
  - Message: `fix: harden server switch regression coverage`
  - Files: Only cleanup/regression files.
  - Pre-commit: `cd app-prefixable && bun run build.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read this plan and verify every Must Have is implemented. Confirm stale server data cannot remain visible after switch. Output `VERDICT: APPROVE/REJECT`.

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run build, inspect changed files for over-broad resets, duplicate server key logic, unsafe storage migration, `any`, debug logs, and hardcoded URLs/colors. Output `VERDICT`.

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright`)
  Execute every QA scenario from T4-T8 in mobile viewport and save evidence under `.sisyphus/evidence/final-qa/`. Output scenario pass/fail table.

- [ ] F4. **Scope Fidelity Check** — `deep`
  Compare final diff to this plan. Ensure no unrelated UI redesign, proxy rewrite, or desktop regression slipped in. Output `VERDICT`.

---

## Commit Strategy

- `fix: isolate app state by selected server` - server boundary/provider changes, build required.
- `fix: scope session persistence by server` - storage key changes, build required.
- `fix: reset mobile view on server switch` - mobile route/state reset changes, build required.
- `fix: make project events server aware` - global events/project scope changes, build required.
- Optional cleanup commit only if T9 changes files.

---

## Success Criteria

### Verification Commands
```bash
cd app-prefixable && bun run build.ts
```

### Final Checklist
- [ ] Server A project/session/chat visible only when server A selected.
- [ ] Server B project/session/chat visible only when server B selected.
- [ ] A → B switch removes A-only chat text without manual refresh.
- [ ] B → A switch restores A data without B leakage.
- [ ] Network requests and SSE target selected server after every switch.
- [ ] No stale server-blind localStorage key can auto-open wrong chat.
