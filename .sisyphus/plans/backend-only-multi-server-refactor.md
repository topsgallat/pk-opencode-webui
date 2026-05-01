# Backend-only multi-server refactor

## Goal

Refactor multi-server support so one local `pk-opencode-webui` instance can control multiple raw `opencode serve` backends.

Configured servers must remain **OpenCode backend URLs**, not remote `pk-opencode-webui` instance URLs.

## Product model

- `server` means `opencode serve` base URL
- one local web UI switches target backend via existing target-aware SDK/client plumbing
- remote-safe features may use only backend-native APIs
- UI-local `/api/ext/*` helpers must never pretend to operate on a remote backend

## Non-goals

- requiring `pk-opencode-webui` on remote machines
- redefining servers as remote web UI instances
- remote filesystem browsing via SSH/mounts/tunnels
- broad upstream backend API redesign in this refactor
- solving every local-only feature beyond making remote behavior truthful

## Architecture guardrails

1. Never browse, read, infer, or mutate UI-host filesystem state for a non-local backend.
2. Treat canonical backend URL as the only server identity for state, storage, recents, session restoration, and reconnect logic.
3. Never silently fall back from backend-native behavior to UI-local `/api/ext/*` behavior for remote backends.
4. If a remote backend lacks capability, fail closed with an explicit disabled/unsupported state.
5. All target-aware HTTP/SSE/WS flows must continue to route through existing `x-opencode-target` / target plumbing.

## Current-state summary

### Already aligned with backend-only model

- `app-prefixable/src/context/sdk.tsx`
  - derives `targetUrl` from selected server
- `app-prefixable/src/sdk/client.ts`
  - injects `x-opencode-target`
- `app-prefixable/src/app.tsx`
  - server-scoped remount boundary and storage scoping
- target-aware backend flows already exist across sessions, events, terminal, sync, and other server-switched APIs

### Not aligned

- `shared/extended-api.ts`
  - `/api/ext/*` endpoints are implemented on the local UI server only
- `app-prefixable/src/components/project-dialog.tsx`
  - mixes backend `path.get()` with UI-local directory browsing helpers
- `app-prefixable/src/utils/extended-api.ts`
  - local ext helper surface still looks generic enough to be misused in remote flows
- `app-prefixable/src/pages/logs.tsx`
  - log access is UI-local unless redesigned backend-native
- any remote flow that still uses `/api/ext/*` directly or through fallback paths

## Canonical backend identity

Use normalized backend URL as the canonical server identity.

Normalization rules:

- trim whitespace
- require `http://` or `https://`
- strip trailing slash
- preserve origin + path prefix if user configured one
- use normalized URL for storage keys and capability checks

## Capability model

Introduce a small capability layer so feature gating is centralized instead of scattered.

Suggested capabilities:

- `isRemoteBackend`
- `canBrowseDirectories`
- `canCreateDirectories`
- `canUseLocalExtFileOps`
- `canReadLocalLogs`
- `canEditLocalInstructionFiles`

Initial rules:

- local/default backend: current local ext capabilities allowed
- remote backend: local ext capabilities disabled unless redesigned backend-native

## Feature classification

### Remote-safe now (backend-native)

- sessions/chat/events
- global events and server-scoped badge state
- terminal / PTY
- clone via PTY
- `path.get()`
- `/project`
- `/project/current`
- server-scoped localStorage state (recent projects, last session, drafts, prompts, permissions, sidebar state)

### Local-only for now

- `/api/ext/list-dirs`
- `/api/ext/mkdir`
- `/api/ext/file`
- `/api/ext/dir`
- `/api/ext/log-files`
- `/api/ext/log-file`
- any config/file editing flow that depends on UI-host file access

## Phased implementation

### Phase 1 — codify backend-only semantics

#### Changes

- update server-related copy in UI and docs to consistently mean OpenCode backend URL
- add a short architecture note describing backend-native vs UI-local features
- add canonical URL normalization helper and use it in server identity/storage

#### Files

- `app-prefixable/src/utils/servers.ts`
- `app-prefixable/src/context/server.tsx`
- `app-prefixable/src/pages/settings.tsx`
- `README.md`
- `AGENTS.md` if internal workflow notes need alignment

#### Acceptance criteria

- no copy implies configured servers are remote web UI instances
- canonical backend identity is defined and used consistently

### Phase 2 — central capability gating

#### Changes

- add `server-capabilities` helper/context
- consume it in all remote-sensitive UI paths

#### Files

- new: `app-prefixable/src/utils/server-capabilities.ts` or `app-prefixable/src/context/server-capabilities.tsx`
- `app-prefixable/src/components/project-dialog.tsx`
- `app-prefixable/src/pages/logs.tsx`
- `app-prefixable/src/context/file.tsx`
- `app-prefixable/src/context/terminal.tsx`
- `app-prefixable/src/pages/settings.tsx`

#### Acceptance criteria

- remote/local gating logic lives in one place
- no remote-sensitive screen relies on ad hoc `targetUrl` checks alone

### Phase 3 — refactor Open Project to backend-native remote mode

#### Desired behavior

For local/default backend:

- keep current directory browsing
- keep create-folder via local ext helper

For remote backend:

- show backend-known projects via `/project`
- show server-scoped recent projects
- allow manual path entry (`/path/to/project`, `~/repo`)
- do not browse UI-host directory tree
- do not create folders through local ext helpers

#### Changes

- split `ProjectDialog` into explicit local vs remote browse behavior
- keep fuzzy search, but remote mode searches known backend projects + typed path
- adjust helper copy and empty states so remote behavior is truthful
- ensure switching backend clears stale picker state

#### Files

- `app-prefixable/src/components/project-dialog.tsx`
- `app-prefixable/src/pages/project-picker.tsx`
- `app-prefixable/src/pages/home-layout.tsx` if open-project launch copy or state needs alignment
- `app-prefixable/src/pages/layout.tsx` if project-open entrypoints need alignment

#### Acceptance criteria

- remote Open Project performs no `/api/ext/list-dirs` call
- remote Open Project results are scoped to selected backend
- manual path entry opens against selected backend
- switching backends rebinds picker state without stale results

### Phase 4 — remove false remote behavior from local-only features

#### Logs

- if logs still depend on `/api/ext/log-files` and `/api/ext/log-file`, mark them local-only
- hide or disable logs for remote backends with explicit message
- separately fix any misleading target-aware signatures in helper layer if needed for clarity

#### File helpers

- audit fallback paths in `context/file.tsx`
- remote mode must not fall back to `/api/ext/file` or `/api/ext/dir`
- local mode may retain those fallbacks

#### Terminal helpers

- audit any directory-creation or local ext usage in terminal-related helpers
- keep PTY functionality remote-safe
- disable ext-backed prep steps on remote if present

#### Settings / instruction editors / local config editors

- any UI that edits local files via ext helpers must be local-only unless a backend-native API already exists

#### Files

- `app-prefixable/src/pages/logs.tsx`
- `app-prefixable/src/utils/extended-api.ts`
- `app-prefixable/src/context/file.tsx`
- `app-prefixable/src/context/terminal.tsx`
- `app-prefixable/src/pages/settings.tsx`

#### Acceptance criteria

- no remote flow reads or mutates UI-host filesystem/config by accident
- disabled states are explicit, not broken

### Phase 5 — storage and switch-state hardening

#### Changes

- audit all remaining localStorage/sessionStorage keys for backend scoping
- ensure normalized backend URL identity is used where server identity matters
- clear or rebind transient UI state on target switch for project picker, logs, and any ext-backed panels

#### Files

- `app-prefixable/src/app.tsx`
- `app-prefixable/src/context/server.tsx`
- `app-prefixable/src/context/recent-projects.tsx`
- `app-prefixable/src/pages/session.tsx`
- `app-prefixable/src/pages/home-layout.tsx`
- `app-prefixable/src/pages/layout.tsx`
- any remaining server-scoped contexts discovered during implementation

#### Acceptance criteria

- recent projects, drafts, and restored session state never leak between backends
- target switch never leaves stale project/log/session UI from previous backend

### Phase 6 — docs and UX honesty pass

#### Changes

- document which features are remote-safe vs local-only
- add user-facing messaging for unsupported remote actions
- update troubleshooting docs around expected remote behavior

#### Files

- `README.md`
- `docker/README.md` if wording needs alignment
- in-app copy across settings/project/logs screens

#### Acceptance criteria

- user can understand why some actions are unavailable on remote backends
- docs no longer imply remote backends expose local UI ext capabilities

## Verification strategy

### Verification tools

- static verification: `read`, `grep`, `lsp_diagnostics` if available
- build verification: `cd app-prefixable && bun run build.ts`
- browser verification: Playwright/browser devtools network inspection
- API verification: targeted HTTP requests against local UI and selected backend where applicable

### Phase-by-phase executable QA

#### Phase 1 — semantics and canonical identity

##### Tool

- `read`
- `grep`
- optional browser manual check in Settings

##### Setup

- configure at least two backend entries that differ by URL formatting if possible
  - example: one with trailing slash, one without

##### Steps

1. Inspect server identity/normalization code and settings copy.
2. Add/edit servers in Settings using variant URL forms.
3. Reload the page.
4. Verify the same normalized backend key is reused in storage/state logic.

##### Expected result

- user-facing copy says backend/OpenCode server, not remote UI instance
- normalized backend identity is consistently used for storage scoping
- no duplicate state buckets are created solely because of trailing slash differences

#### Phase 2 — capability gating

##### Tool

- `read`
- `grep`
- Playwright or manual browser UI inspection

##### Setup

- one local/default backend
- one remote backend

##### Steps

1. Open each remote-sensitive screen: project dialog, logs, settings areas that touch local files, any ext-backed panels.
2. Switch between local and remote backend.
3. Observe visible actions and disabled states.

##### Expected result

- local backend shows local ext-backed controls where intended
- remote backend hides/disables those controls before interaction
- gating behavior is consistent across screens, not implemented ad hoc per screen

#### Phase 3 — remote Open Project backend-native flow

##### Tool

- Playwright or manual browser testing with network tab
- backend `/project` endpoint available on remote server

##### Setup

- local UI server running
- backend A and backend B running
- each backend should have distinguishable known projects if possible

##### Steps

1. Select backend A.
2. Open Project dialog.
3. Observe the displayed results.
4. Inspect network requests while typing/searching in the dialog.
5. Select a backend-known project from backend A and open it.
6. Enter a manual path and open it.
7. Switch to backend B and repeat.

##### Expected result

- results shown for backend A differ from backend B when their `/project` data differs
- remote Open Project sends backend-native requests only
- remote Open Project sends **no** `/api/ext/list-dirs` request
- manual path entry opens against the currently selected backend
- dialog content rebinds after backend switch with no stale results from previous backend

#### Phase 4 — local-only feature truthfulness

##### Tool

- Playwright or manual browser testing with network tab
- `grep` / `read` for fallback auditing

##### Setup

- one local/default backend
- one remote backend

##### Steps

1. On remote backend, open Logs.
2. Try any ext-backed file/local config flows.
3. Try any terminal helper path that previously depended on ext helpers.
4. Inspect network traffic for `/api/ext/*` requests.

##### Expected result

- remote Logs is hidden or explicitly marked unsupported/local-only
- remote ext-backed file/local config flows are disabled or blocked clearly
- remote interactions do not dispatch `/api/ext/log-files`, `/api/ext/log-file`, `/api/ext/file`, `/api/ext/dir`, `/api/ext/mkdir`, or `/api/ext/list-dirs`
- local backend may still use ext endpoints where intended

#### Phase 5 — switch-state hardening

##### Tool

- Playwright or manual browser testing
- browser storage inspection

##### Setup

- backend A and backend B both configured

##### Steps

1. Open backend A, project X, and create visible recent/session state.
2. Switch to backend B and open backend B project Y.
3. Switch back to backend A.
4. Inspect recent projects, restored session, draft state, and project dialog contents.

##### Expected result

- recent projects remain scoped to selected backend
- restored session/draft state is backend-scoped
- switching backends does not leave stale project/log/session UI from previous backend

#### Phase 6 — docs and UX honesty

##### Tool

- `read`
- manual browser copy check

##### Steps

1. Inspect README/settings/help copy.
2. Open remote-disabled features in UI.

##### Expected result

- docs clearly distinguish backend-native vs local-only features
- remote-disabled features explain why they are unavailable

### Cross-cutting verification matrix

#### Local backend

- Open Project browses directories via `/api/ext/list-dirs`
- Create new folder works via `/api/ext/mkdir`
- Clone works
- Logs work if local-only implementation remains enabled
- Terminal works

#### Remote backend

- Open Project shows backend-known projects and/or accepts manual path
- Create folder is hidden or disabled before dispatch
- Logs are hidden/disabled or explicitly local-only
- Terminal works
- Clone works on remote backend
- no UI-host directory tree is shown
- no remote flow silently dispatches local ext requests

#### Switching

- switch A -> B -> A
- recent projects remain server-scoped
- Open Project results change per backend
- session restore/drafts remain server-scoped
- no stale remote/local states persist

### Technical verification

- run build: `cd app-prefixable && bun run build.ts`
- run diagnostics on changed TS/TSX files if language server is available
- verify with browser/network inspection that remote Open Project never hits `/api/ext/list-dirs`
- verify with browser/network inspection that disabled remote features do not dispatch local ext requests

## Implementation slices / commit plan

1. `refactor: normalize backend server identity and codify semantics`
2. `refactor: add backend capability gating for remote-safe features`
3. `fix: make remote Open Project backend-native`
4. `fix: disable local ext-backed logs and file operations on remote backends`
5. `fix: harden server-scoped state on target switch`
6. `docs: clarify backend-only multi-server behavior`

## Risks

### Critical

- hidden `/api/ext/*` fallback remains in a remote path
- same backend reachable via multiple URL aliases splits recents/state
- target switch during in-flight remote request leaves stale UI state

### Moderate

- `/project` may not cover every project discovery use case users expect from directory browsing
- path normalization differences across platforms may affect manual path UX
- user confusion if disabled states are too subtle

## Open questions to validate during implementation

1. Is `/project` + recents + manual path enough for the core Open Project use case?
2. Which exact settings/instruction-editing flows still rely on local ext helpers?
3. Should logs be hidden completely on remote backends or shown with explicit unsupported messaging?
4. Do any polling/SSE/WS reconnect paths still miss target propagation outside the SDK client path?

## Definition of done

- one local `pk-opencode-webui` can target multiple raw `opencode serve` backends
- backend-native features work per selected backend
- remote flows never silently use UI-local `/api/ext/*`
- Open Project is truthful and usable on remote backends
- local-only features are clearly gated
- build passes and switch-state behavior is verified
