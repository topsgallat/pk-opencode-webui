# OpenCode Server Password Support

## TL;DR
> **Summary**: Add first-class support for password-protected upstream OpenCode servers by introducing a same-origin proxy auth session, per-server saved credentials in the browser, inline re-prompt on auth failure, and auth-aware reconnect behavior across HTTP, SSE, WebSocket, and probe flows.
> **Deliverables**:
> - Per-server password persistence and migration-safe storage model
> - Settings UI for password entry plus inline auth recovery prompt
> - Shared proxy auth-session bridge used by both dev and production servers
> - Auth injection for HTTP, SSE, PTY WebSocket, and server probing
> - Automated Bun + Playwright coverage for protected upstream flows
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 3 → 4 → 5 → 7

## Context
### Original Request
Support pk-opencode-webui when the upstream OpenCode server is configured with a password.

### Interview Summary
- Passwords should be saved per server target by default.
- If a saved password is missing or rejected, the UI should show an inline re-prompt and retry after update.
- No additional user decisions are required for the first version.

### Metis Review (gaps addressed)
- Defined one auth transport for fetch, EventSource, WebSocket, and probe traffic instead of inventing separate mechanisms.
- Included dev/prod parity so `app-prefixable/dev.ts` and `docker/serve-ui.ts` do not diverge.
- Explicitly distinguish `401 auth required/invalid` from `network unreachable`.
- Paused SSE/global reconnect loops on auth failure and required credential update before retry.
- Avoided putting passwords in URLs, `x-opencode-target`, `window.__OPENCODE__`, or logs.

## Work Objectives
### Core Objective
Allow the web UI to connect reliably to password-protected OpenCode backends, including non-default multi-server targets, without requiring manual header hacks or breaking SSE / PTY / proxy behavior.

### Deliverables
- Browser-side per-server auth storage keyed by server id, with migration-safe defaults.
- Auth session sync endpoint on the same-origin Bun proxy that stores target credentials in memory and identifies browser sessions via HttpOnly cookie.
- Shared proxy auth helper used by both `app-prefixable/dev.ts` and `docker/serve-ui.ts`.
- Settings dialog support for password entry/editing and protected-server probe messaging.
- Inline auth prompt shown on 401-style failures, with deduped server-level state.
- Auth-aware retry/reconnect behavior for request, SSE, global-events, sync, and terminal flows.
- Automated tests and evidence artifacts for success and failure paths.

### Definition of Done (verifiable conditions with commands)
- `cd app-prefixable && bun run build`
- `cd app-prefixable && bun run lint`
- `cd app-prefixable && bun test tests/api-contract.test.ts tests/api-auth-contract.test.ts`
- `cd /home/sgallat/pk-opencode-webui && bun test tests/proxy-auth.test.ts`
- `cd /home/sgallat/pk-opencode-webui && bunx playwright test tests/playwright/server-auth.spec.ts`
- Protected default and remote target servers both work for session fetches, SSE streams, and PTY connect when the saved password is correct.
- Wrong password yields one inline prompt and reconnects stay paused until credentials change.

### Must Have
- Same-origin proxy session bridge; no password transport in browser-visible query strings by default.
- Password storage persisted per server record in browser storage.
- Inline auth recovery without forcing users into Settings for every retry.
- Probe semantics that treat 401 as reachable/auth-required, not unreachable.
- Dev/prod parity.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No OAuth/general secret-manager scope expansion.
- No fake encryption claims for localStorage.
- No password fields embedded into server URL strings.
- No infinite SSE/global reconnect loops with stale credentials.
- No auth support limited to solo mode only.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after using Bun unit/integration tests plus Playwright browser QA.
- QA policy: Every task includes agent-executed happy-path and failure-path scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: auth data model, settings UX, proxy auth-session bridge

Wave 2: proxy injection/reconnect handling, automated tests, Playwright recovery flow, docs copy polish if needed

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 5, 6, 7
- 2 blocks 5, 7
- 3 blocks 4, 5, 6, 7
- 4 blocks 5, 6, 7
- 5 blocks 7
- 6 independent after 1+3+4
- 7 after 2+4+5+6

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → unspecified-high, visual-engineering, unspecified-high
- Wave 2 → 4 tasks → unspecified-high, quick, unspecified-high, visual-engineering
- Final Verification → 4 tasks → oracle, unspecified-high, unspecified-high, deep

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Add browser-side server auth model and migration rules

  **What to do**: Extend the multi-server model so each server record can have separately persisted auth metadata stored outside the plain `ServerConfig` list. Use server id as the persistent browser key and keep `ServerConfig` itself focused on `id/name/url/isDefault`. Add a new helper module for reading/writing per-server auth metadata (`password`, optional `username`, auth-invalid flag metadata if needed), plus migration logic that initializes missing entries safely and clears deleted-server entries. When a server URL is edited, keep the saved password attached to that same server id, but mark it for revalidation on next use.
  **Must NOT do**: Do not append passwords to URLs, do not add passwords to `opencode.servers`, and do not claim encryption for browser storage.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: shared state/model change with multiple downstream consumers.
  - Skills: `[]` - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Data model first, not presentation-heavy.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2,5,6,7 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/src/utils/servers.ts:11-16` - current `ServerConfig` shape to keep lean.
  - Pattern: `app-prefixable/src/utils/servers.ts:102-128` - server save/update pattern.
  - Pattern: `app-prefixable/src/context/server.tsx:54-71` - existing server-scoped migration style.
  - Pattern: `app-prefixable/src/context/server.tsx:84-147` - storage sync and selected-server lifecycle.
  - Pattern: `app-prefixable/src/utils/extended-api.ts:117-170` - simple localStorage-backed helper style already used in repo.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Saving a server stores non-secret config in `opencode.servers` and auth data in a separate key namespace.
  - [ ] Editing a server URL keeps the password bound to the same server id and does not duplicate auth entries.
  - [ ] Deleting a server removes its auth entry.
  - [ ] Fresh startup with no auth entries does not crash server selection or settings views.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Server auth storage follows server id
    Tool: Bash
    Steps: Run a focused Bun test that seeds localStorage with one server, saves auth metadata, edits the server URL, reloads helpers, and asserts the auth record is still retrievable by server id.
    Expected: Auth metadata survives URL edit, plain server list contains no password field.
    Evidence: .sisyphus/evidence/task-1-server-auth-model.txt

  Scenario: Deleted server clears auth state
    Tool: Bash
    Steps: Run a Bun test that creates two server records, saves auth for both, deletes one, then inspects storage keys.
    Expected: Deleted server auth entry is gone; remaining server entry is untouched.
    Evidence: .sisyphus/evidence/task-1-server-auth-model-error.txt
  ```

  **Commit**: YES | Message: `feat(server): persist per-server auth metadata` | Files: `app-prefixable/src/utils/servers.ts`, `app-prefixable/src/context/server.tsx`, new auth helper file(s)

- [ ] 2. Extend Settings server management and inline auth prompt UX

  **What to do**: Update the Add/Edit Server flow to capture an optional password field and optional username field defaulting to `opencode` when omitted. Keep password masked, never re-render the actual stored value in plain text, and show protected-server probe results as “reachable, authentication required” for 401 responses. Add a shared inline auth prompt component/state path used when requests fail due to auth, so the user can update the password and retry immediately without leaving the current screen.
  **Must NOT do**: Do not navigate users away to Settings-only recovery, and do not prefill exported/debug output with passwords.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: modal/form/prompt UX with stateful recovery flow.
  - Skills: [`frontend-ui-ux`] - Helpful for compact, non-disruptive auth prompt design.
  - Omitted: [`playwright`] - Implementation task, not browser automation.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,7 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/src/pages/settings.tsx:84-169` - existing server dialog state/save flow.
  - Pattern: `app-prefixable/src/pages/settings.tsx:2647-2697` - current Add/Edit Server modal form fields/actions.
  - Pattern: `app-prefixable/src/context/mcp.tsx:209-342` - existing auth-required messaging pattern.
  - Pattern: `app-prefixable/src/context/providers.tsx:252-292` - auth submission flow and UI callback expectations.
  - Pattern: `shared/extended-api.ts:441-466` - current probe endpoint behavior to align UI messaging with new response shape.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Add/Edit Server UI accepts password and optional username without storing secrets in the server URL.
  - [ ] Probe warning distinguishes unreachable network errors from 401 auth-required responses.
  - [ ] Inline prompt can update credentials for the current server and trigger a retry callback.
  - [ ] Only one auth prompt is visible per server at a time.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Settings dialog saves protected server cleanly
    Tool: Playwright
    Steps: Open Settings → Servers, add a remote server URL plus password, save, reopen edit dialog, and inspect visible fields plus localStorage-backed non-secret server config.
    Expected: Password field stays masked/empty-on-edit per design, server URL remains unchanged, no password appears in server list payload.
    Evidence: .sisyphus/evidence/task-2-server-ui.png

  Scenario: Inline prompt dedupes on repeated auth failure
    Tool: Playwright
    Steps: Configure a protected server with a wrong password, trigger two failing actions quickly (session fetch + background refresh), and observe the auth recovery UI.
    Expected: One prompt appears for the server; retries remain blocked until credentials are updated.
    Evidence: .sisyphus/evidence/task-2-server-ui-error.png
  ```

  **Commit**: YES | Message: `feat(ui): add protected server auth fields and recovery prompt` | Files: `app-prefixable/src/pages/settings.tsx`, new prompt component/context file(s)

- [ ] 3. Implement same-origin proxy auth session bridge shared by dev and prod servers

  **What to do**: Create a shared Bun-side auth-session helper used by both `app-prefixable/dev.ts` and `docker/serve-ui.ts`. Add same-origin endpoints (for example under `/api/ext/server-auth`) to sync credentials from browser storage into an in-memory proxy session map keyed by canonical target URL and identified by an HttpOnly cookie session id. Support POST/PUT sync and DELETE clear operations, validate target URL protocol, default username to `opencode`, and never log passwords. Make browser startup and selected-server changes call this sync path before opening SSE/WS for that target.
  **Must NOT do**: Do not use `auth_token` query fallback as the primary mechanism and do not store proxy-session credentials on disk.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: shared backend/proxy architecture with security-sensitive state handling.
  - Skills: `[]` - No external-doc skill needed for implementation.
  - Omitted: [`git-master`] - No git work in task scope.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4,5,6,7 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `docker/serve-ui.ts:216-249` - target override normalization and upstream URL building.
  - Pattern: `docker/serve-ui.ts:365-497` - API proxy request handling points.
  - Pattern: `docker/serve-ui.ts:565-611` - PTY WebSocket proxy path.
  - Pattern: `app-prefixable/dev.ts:35-57` - dev proxy target building.
  - Pattern: `app-prefixable/dev.ts:78-136` - dev WebSocket/SSE/API proxy flow.
  - Pattern: `shared/extended-api.ts:441-466` - existing local Bun endpoint pattern for probe handling.
  - Pattern: `app-prefixable/src/sdk/client.ts:8-24` - current client-side target propagation, which should remain target-only.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A same-origin auth-session endpoint can sync credentials for a target and set a session cookie.
  - [ ] The proxy can resolve stored credentials by target URL without the browser sending password on every request.
  - [ ] Dev and prod servers share the same auth-session logic.
  - [ ] Clearing auth for a target removes it from the proxy session.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Auth session sync sets browser-scoped proxy session
    Tool: Bash
    Steps: Run a Bun integration test that POSTs target/password to the local auth endpoint, captures Set-Cookie, then issues a second request with the cookie to inspect resolved proxy auth state via a test-only helper.
    Expected: Session cookie is HttpOnly; target credentials resolve server-side; password is absent from response bodies.
    Evidence: .sisyphus/evidence/task-3-proxy-auth-session.txt

  Scenario: Clearing target auth invalidates proxy-side lookup
    Tool: Bash
    Steps: In the same Bun integration suite, sync credentials, DELETE the target auth entry, then attempt a protected proxy call.
    Expected: Proxy no longer injects auth for that target and the protected call returns auth-required status.
    Evidence: .sisyphus/evidence/task-3-proxy-auth-session-error.txt
  ```

  **Commit**: YES | Message: `feat(proxy): add per-session upstream auth bridge` | Files: `docker/serve-ui.ts`, `app-prefixable/dev.ts`, `shared/extended-api.ts`, new shared proxy helper file(s)

- [ ] 4. Inject auth into HTTP, SSE, WebSocket, and probe flows with 401-aware semantics

  **What to do**: Update proxy request handling so all upstream traffic for protected servers consults the auth-session map and injects `Authorization: Basic ...` server-side. Apply this to regular API fetches, `/event` SSE requests, PTY WebSocket upgrades, and `/api/ext/probe-server`. Change probe behavior so 401 returns a structured “reachable/auth-required” response. Preserve existing target override behavior and compression/SSE handling. For default `API_URL` traffic, keep solo-mode support but route it through the same shared auth resolver so protected default backends also work in ui-only/dev scenarios.
  **Must NOT do**: Do not special-case only loopback targets, and do not break existing unprotected servers.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: proxy correctness across protocols and environments.
  - Skills: `[]` - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Network/proxy focus.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5,6,7 | Blocked By: 3

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `docker/serve-ui.ts:244-249` - current `shouldAttachProxyAuth` logic to replace/generalize.
  - Pattern: `docker/serve-ui.ts:375-405` - current SSE proxy path.
  - Pattern: `docker/serve-ui.ts:412-493` - current regular API proxy path.
  - Pattern: `docker/serve-ui.ts:570-571` - current WebSocket auth injection hook.
  - Pattern: `app-prefixable/dev.ts:95-136` - dev API/SSE proxy path currently lacking auth.
  - Pattern: `shared/extended-api.ts:441-466` - probe implementation needing auth-aware behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Protected upstream requests succeed for both default and target-selected servers when credentials are synced.
  - [ ] 401 from probe returns a machine-readable auth-required result, not unreachable.
  - [ ] SSE and PTY WebSocket use the same auth-session data as standard HTTP requests.
  - [ ] Unprotected upstreams continue working without requiring credentials.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Proxy injects Authorization across all transport types
    Tool: Bash
    Steps: Run an integration test suite with a protected fixture upstream that records headers for HTTP, SSE handshake, and PTY WebSocket upgrade while requests flow through both dev and prod proxy entrypoints.
    Expected: Each transport reaches upstream with the expected Basic Authorization header; unprotected fixture receives no forced auth.
    Evidence: .sisyphus/evidence/task-4-proxy-injection.txt

  Scenario: Probe returns auth-required, not unreachable
    Tool: Bash
    Steps: Call `/api/ext/probe-server` against a protected fixture without synced credentials and then with wrong credentials.
    Expected: Response shape marks server reachable but auth-required/invalid; no generic network error text is emitted.
    Evidence: .sisyphus/evidence/task-4-proxy-injection-error.txt
  ```

  **Commit**: YES | Message: `fix(proxy): authenticate protected upstream transports` | Files: `docker/serve-ui.ts`, `app-prefixable/dev.ts`, `shared/extended-api.ts`

- [ ] 5. Add client-side auth state, sync timing, and reconnect gating

  **What to do**: Add a client auth coordinator that syncs the selected server’s saved credentials to the proxy on app startup, selected-server changes, and password updates. Centralize auth-failure classification for SDK fetches and long-lived channels. When auth becomes invalid for a server, stop automatic reconnect loops in `events`, `global-events`, and `sync`, surface one inline re-prompt, and resume only after successful credential update/resync. Ensure terminal/PTy flows surface a clear auth-recovery path instead of endless generic connect failures.
  **Must NOT do**: Do not keep retrying stale credentials every 3 seconds, and do not scatter duplicate auth-failure parsing in every component.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting state orchestration across networking contexts.
  - Skills: `[]` - No special skill required.
  - Omitted: [`playwright`] - Verification belongs in later QA tasks.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1,2,3,4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/src/context/sdk.tsx:20-57` - selected server / target URL propagation.
  - Pattern: `app-prefixable/src/context/events.tsx:79-126` - SSE reconnect loop to gate on auth-invalid state.
  - Pattern: `app-prefixable/src/context/global-events.tsx:116-149` - per-directory SSE connection setup.
  - Pattern: `app-prefixable/src/context/sync.tsx:171-209` - sync reconnect loop.
  - Pattern: `app-prefixable/src/components/terminal.tsx:133-164` - PTY WebSocket connection UX.
  - Pattern: `app-prefixable/src/utils/path.ts:72-77` - existing target URL propagation for same-origin routes.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Startup and selected-server switches sync saved auth before opening long-lived streams.
  - [ ] A wrong password produces one server-scoped auth-invalid state and pauses reconnects.
  - [ ] Updating credentials clears auth-invalid state and resumes failed channel types.
  - [ ] PTY connect failures caused by auth route users into the same recovery prompt.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: SSE reconnect pauses on auth failure
    Tool: Playwright
    Steps: Configure a protected server with an incorrect password, load a session page, observe one failed stream, wait longer than one reconnect interval, then inspect network activity and UI state.
    Expected: Auth prompt appears; repeated SSE reconnect attempts stop until credentials are updated.
    Evidence: .sisyphus/evidence/task-5-auth-reconnect.md

  Scenario: Corrected credentials resume channels
    Tool: Playwright
    Steps: From the auth-invalid state, update the password in the inline prompt and retry the action that previously failed.
    Expected: Session/status data reloads, SSE reconnects, and PTY connect can proceed without page refresh.
    Evidence: .sisyphus/evidence/task-5-auth-reconnect-error.md
  ```

  **Commit**: YES | Message: `feat(auth): gate reconnects on invalid server credentials` | Files: `app-prefixable/src/context/sdk.tsx`, `app-prefixable/src/context/events.tsx`, `app-prefixable/src/context/global-events.tsx`, `app-prefixable/src/context/sync.tsx`, `app-prefixable/src/components/terminal.tsx`, auth coordinator file(s)

- [ ] 6. Add Bun coverage for protected server contracts, proxy auth, and storage migration

  **What to do**: Add automated Bun tests covering storage migration rules, auth-session endpoints, protected upstream proxy behavior, and auth-aware contract checks. Create protected and unprotected fixture servers for HTTP, SSE, and WebSocket assertions. Extend API smoke coverage with an auth-specific contract file that passes credentials via the new same-origin bridge or explicit test harness setup rather than baking passwords into URLs.
  **Must NOT do**: Do not rely only on manual curl checks, and do not test only plain HTTP while skipping SSE/WS.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: mostly focused test-file additions once architecture is in place.
  - Skills: `[]` - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Non-visual task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1,3,4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/tests/api-contract.test.ts:16-120` - Bun test structure and server-availability gates.
  - Pattern: `tests/playwright/sse-verification.spec.ts:25-100` - existing SSE verification intent to mirror at lower test layers.
  - Pattern: `tests/playwright/qa-interactive.spec.ts:71-122` - endpoint-centric verification style.
  - Pattern: `shared/extended-api.ts:441-466` - probe endpoint that now needs auth-specific tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test` includes auth-session and proxy integration coverage for protected upstreams.
  - [ ] Auth contract test verifies a password-protected OpenCode-compatible fixture path.
  - [ ] Storage migration tests cover missing-auth, edited-URL, and deleted-server cases.
  - [ ] Test fixtures assert no password appears in serialized responses or logged test artifacts.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Bun auth suite passes end-to-end
    Tool: Bash
    Steps: Run `cd /home/sgallat/pk-opencode-webui && bun test tests/proxy-auth.test.ts && cd app-prefixable && bun test tests/api-auth-contract.test.ts`.
    Expected: Exit code 0; protected default and target upstream cases pass; migration assertions pass.
    Evidence: .sisyphus/evidence/task-6-auth-tests.txt

  Scenario: Wrong-password contract path fails correctly
    Tool: Bash
    Steps: Run the auth contract suite against a fixture configured with an intentionally wrong saved password.
    Expected: Tests assert auth-required handling instead of generic network failures; suite captures expected negative case.
    Evidence: .sisyphus/evidence/task-6-auth-tests-error.txt
  ```

  **Commit**: YES | Message: `test(auth): cover protected upstream server flows` | Files: `app-prefixable/tests/api-auth-contract.test.ts`, `tests/proxy-auth.test.ts`, related fixture files

- [ ] 7. Add Playwright E2E verification for protected-server recovery flow

  **What to do**: Add a dedicated Playwright scenario that configures a protected remote server, saves a wrong password, triggers auth failure, verifies the inline prompt, updates the password, retries, and confirms session fetch plus stream recovery. Include a second scenario for a protected server that is reachable but missing credentials at first connect.
  **Must NOT do**: Do not stop at visual prompt checks; verify network/result recovery too.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: browser-driven, UI-visible auth recovery flow.
  - Skills: [`playwright`] - Required for stable browser automation.
  - Omitted: [`frontend-ui-ux`] - Verification rather than design.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: none | Blocked By: 2,4,5,6

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `tests/playwright/qa-interactive.spec.ts:32-123` - screenshot/reporting style and proxy endpoint inspection.
  - Pattern: `tests/playwright/sse-verification.spec.ts:20-103` - long-lived event verification pattern.
  - Pattern: `app-prefixable/src/pages/settings.tsx:2647-2697` - server dialog selectors/fields likely to be exercised.
  - Pattern: `app-prefixable/src/context/events.tsx:88-126` - SSE URL/reconnect behavior that must visibly recover.
  - Pattern: `app-prefixable/src/components/terminal.tsx:137-164` - PTY connection path to smoke-test after auth fix.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Playwright can configure a protected server and verify wrong-password → prompt → corrected-password → success flow.
  - [ ] The suite verifies only one prompt appears for repeated failures.
  - [ ] The suite verifies successful recovery without full page reload.
  - [ ] Evidence artifacts are written under `.sisyphus/evidence/` or `.sisyphus/outputs/`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Inline re-prompt restores protected server access
    Tool: Playwright
    Steps: Add server `Remote Auth` at the protected fixture URL, enter wrong password `wrong-pass`, open a session view, observe failure, submit `s3cret` in the inline prompt, retry.
    Expected: Prompt appears once, session/status requests become 200, SSE reconnects, and terminal/session actions succeed without reload.
    Evidence: .sisyphus/evidence/task-7-playwright-auth.png

  Scenario: Missing password path prompts before loop
    Tool: Playwright
    Steps: Add the protected server with no password, select it, and attempt a session action.
    Expected: UI presents auth prompt immediately after auth-required response; background channels do not enter repeated reconnect noise.
    Evidence: .sisyphus/evidence/task-7-playwright-auth-error.png
  ```

  **Commit**: YES | Message: `test(e2e): verify protected server auth recovery` | Files: `tests/playwright/server-auth.spec.ts`, fixture/config updates

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit after each numbered task because storage, proxy, UI, reconnect logic, and tests are independently reviewable.
- Recommended sequence:
  1. `feat(server): persist per-server auth metadata`
  2. `feat(ui): add protected server auth fields and recovery prompt`
  3. `feat(proxy): add per-session upstream auth bridge`
  4. `fix(proxy): authenticate protected upstream transports`
  5. `feat(auth): gate reconnects on invalid server credentials`
  6. `test(auth): cover protected upstream server flows`
  7. `test(e2e): verify protected server auth recovery`

## Success Criteria
- A protected upstream OpenCode server can be added once and reused without manual header entry.
- The same saved credentials work for normal requests, SSE, PTY WebSocket, and probe flows.
- Wrong credentials produce an inline re-prompt and halt reconnect spam until corrected.
- Dev server and production Bun server behave the same for protected backends.
- All listed build, lint, Bun, and Playwright verification commands pass.
