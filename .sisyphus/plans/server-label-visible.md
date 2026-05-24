# Server Label — Always-Visible Placement

## TL;DR
> **Summary**: Move server name label from the hidden 64px sidebar icon strip to always-visible locations: sidebar panel header (desktop) and Sessions tab header (mobile).
> **Deliverables**: Server name badge in desktop sidebar header + server name in mobile Sessions tab header
> **Effort**: Quick
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3 → build verify

## Context
### Original Request
ชื่อเซิฟเวอร์ต้องมองเห็นได้ง่าย ไม่ต้องเข้าเมนูไปเพื่อดูชื่อเซิฟเวอร์

### Interview Summary
- Desktop: server name in **top bar / sidebar header** — visible at all times next to project name
- Mobile: server name in **Sessions tab header** (e.g. "Local • Sessions")
- Previous implementation put label next to Server icon inside the 64px-wide icon strip — text was clipped/invisible due to container overflow

### Current State (broken)
- `layout.tsx` line ~2154: `<span class="text-xs font-medium max-w-28 truncate">` placed OUTSIDE sidebar panel, inside the 64px icon-strip — not visible
- `home-layout.tsx` line ~254: same pattern, same problem
- `mobile-layout.tsx` line ~670: label only shows when `server.servers().length > 1` AND is in the bottom tab bar (small, easy to miss)

### Target State
- **Desktop (layout.tsx)**: Add server name badge inside the **sidebar panel header** (line ~2266, the `px-3 h-12 flex items-center gap-2` div that shows project name). Badge appears inline with project name.
- **Desktop home (home-layout.tsx)**: No sidebar panel header exists on home page. Keep server icon in icon strip but remove the overflowing span. Server name is not critical on home page.
- **Mobile (mobile-layout.tsx)**: In `SessionsTab()` header, add server name as a small badge or subtitle next to or below the project name button, always visible regardless of server count.

## Work Objectives
### Core Objective
Server name must be immediately visible without navigating any menu, on both desktop session view and mobile Sessions tab.

### Definition of Done
- [ ] `bun run build.ts` completes with 0 errors from `app-prefixable/`
- [ ] Desktop: sidebar header shows project name + server badge inline (e.g. `pk-opencode-webui [Local]`)
- [ ] Mobile: Sessions tab header shows server name (e.g. small pill badge or subtitle row)
- [ ] No regressions to existing layout structure

### Must NOT Have
- Do NOT hardcode server names
- Do NOT break the existing server dropdown (clicking Server icon still opens dropdown)
- Do NOT change routing or server-switch logic
- Do NOT modify any files outside `app-prefixable/src/pages/`
- Follow AGENTS.md code style: no `let`, no `else`, prefer single-word vars, use existing CSS vars

## TODOs

- [ ] 1. Desktop: Add server badge in sidebar panel header (layout.tsx)

  **What to do**:
  - File: `app-prefixable/src/pages/layout.tsx`
  - Find the "Project Header with collapse toggle" section (~line 2265-2295)
  - The section contains a `<div class="min-w-0 flex-1">` with project name and directory path
  - Change the project name row from a single `<div class="text-sm font-medium truncate">` to a flex row containing both the project name AND a server badge span
  - Server badge: `<span class="text-xs shrink-0 px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--surface-inset)", color: "var(--text-interactive-base)" }} title={server.selectedServer()?.url}>{selectedServerLabel()}</span>`
  - Wrap project name + badge in: `<div class="flex items-center gap-1.5 min-w-0">`
  - `selectedServerLabel` memo already exists at line ~287: `createMemo(() => server.selectedServer()?.name || server.selectedServer()?.url || "Server")`

  **Exact oldString to replace** (lines 2273-2286 approx):
  ```
                  <div class="min-w-0 flex-1">
                    <div
                      class="text-sm font-medium truncate"
                      style={{ color: "var(--text-strong)" }}
                    >
                      {projectName()}
                    </div>
                    <div
                      class="text-xs truncate"
                      style={{ color: "var(--text-weak)" }}
                    >
                      {directory?.replace(/^\/home\/[^/]+/, "~") || ""}
                    </div>
                  </div>
  ```

  **Replace with**:
  ```
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <div
                        class="text-sm font-medium truncate"
                        style={{ color: "var(--text-strong)" }}
                      >
                        {projectName()}
                      </div>
                      <span
                        class="text-xs shrink-0 px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--surface-inset)", color: "var(--text-interactive-base)" }}
                        title={server.selectedServer()?.url}
                      >
                        {selectedServerLabel()}
                      </span>
                    </div>
                    <div
                      class="text-xs truncate"
                      style={{ color: "var(--text-weak)" }}
                    >
                      {directory?.replace(/^\/home\/[^/]+/, "~") || ""}
                    </div>
                  </div>
  ```

  **Must NOT do**: Do not touch any other part of layout.tsx. Do not change the server dropdown.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [Task 2, Task 3] | Blocked By: []

  **References**:
  - File: `app-prefixable/src/pages/layout.tsx` lines 2265-2295
  - `selectedServerLabel` memo: line ~287

  **Acceptance Criteria**:
  - [ ] `bun run build.ts` exits 0 from `app-prefixable/`
  - [ ] No TypeScript errors in layout.tsx (check with `bun tsc --noEmit` if available, else trust build)

  **Commit**: YES | Message: `feat(ui): show server name badge in desktop sidebar header` | Files: `app-prefixable/src/pages/layout.tsx`

- [ ] 2. Desktop home: Remove overflowing server label span from icon strip (home-layout.tsx)

  **What to do**:
  - File: `app-prefixable/src/pages/home-layout.tsx`
  - Find the `<div class="relative flex items-center gap-2">` block around line 242 that contains the Server icon button AND the `<span class="text-xs font-medium max-w-28 truncate">` label
  - Remove ONLY the `<span>` label element (lines ~254-260). The Server icon button and dropdown remain untouched.
  - The `selectedServerLabel` memo (line 34) can stay — it is still used for the button `title` attribute.

  **Exact oldString to remove**:
  ```
                    <span
                      class="text-xs font-medium max-w-28 truncate"
                      style={{ color: "var(--text-weak)" }}
                      title={selectedServerLabel()}
                    >
                      {selectedServerLabel()}
                    </span>
  ```
  Replace with nothing (delete the span).

  **Must NOT do**: Do not touch the Server dropdown. Do not change layout structure.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [Task 3] | Blocked By: []

  **References**:
  - File: `app-prefixable/src/pages/home-layout.tsx` lines ~242-294

  **Acceptance Criteria**:
  - [ ] `bun run build.ts` exits 0 from `app-prefixable/`

  **Commit**: YES | Message: `fix(ui): remove invisible server label from home icon strip` | Files: `app-prefixable/src/pages/home-layout.tsx`

- [ ] 3. Mobile: Add server name badge in Sessions tab header (mobile-layout.tsx)

  **What to do**:
  - File: `app-prefixable/src/pages/mobile-layout.tsx`
  - In `SessionsTab()` function (~line 269), find the header `<div class="flex items-center justify-between px-4 py-3 shrink-0">` (line ~273)
  - The left side has an `<button onClick={openProjectHistory} ...>` with project name. Add a small server badge directly below (or inline after) the project name, INSIDE that button element, after the project name span.
  - Add a `<span>` badge showing `selectedServerLabel()` — small, subtle, always visible regardless of server count
  - Badge style: `class="text-[10px] font-medium mt-0.5 block truncate" style={{ color: "var(--text-interactive-base)" }}`

  **Exact location** — inside the project name button (around line 278-288):
  ```tsx
  <button
      onClick={openProjectHistory}
      class="flex items-center gap-2 max-w-[70%] rounded-md px-2 py-1.5 -ml-2 active:opacity-70 transition-opacity text-left min-w-0"
      style={{ background: "var(--surface-inset)" }}
      aria-label="Switch Project"
  >
      <OpenCodeLogo class="w-5 h-5 shrink-0 rounded" />
      <span class="font-semibold text-sm truncate" style={{ color: "var(--text-strong)" }}>
          {projectName() || "Select Project..."}
      </span>
      <ChevronDown class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
  </button>
  ```

  Add server label AFTER the project name span and BEFORE ChevronDown:
  ```tsx
      <span class="font-semibold text-sm truncate" style={{ color: "var(--text-strong)" }}>
          {projectName() || "Select Project..."}
      </span>
      <span class="text-[10px] shrink-0 px-1 py-0.5 rounded font-medium"
          style={{ background: "var(--surface-inset)", color: "var(--text-interactive-base)", border: "1px solid var(--border-base)" }}
          title={server.selectedServer()?.url}
      >
          {selectedServerLabel()}
      </span>
      <ChevronDown class="w-4 h-4 shrink-0" style={{ color: "var(--icon-weak)" }} />
  ```

  **Must NOT do**: Do not change the `Show when={server.servers().length > 1}` server tab condition. Do not touch server switch logic.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [] | Blocked By: []

  **References**:
  - File: `app-prefixable/src/pages/mobile-layout.tsx` lines ~269-300
  - `selectedServerLabel` memo: line ~74

  **Acceptance Criteria**:
  - [ ] `bun run build.ts` exits 0 from `app-prefixable/`
  - [ ] Server name badge visible in Sessions tab header without entering any menu

  **Commit**: YES | Message: `feat(ui): show server name badge in mobile Sessions tab header` | Files: `app-prefixable/src/pages/mobile-layout.tsx`

- [ ] 4. Final build verify + push

  **What to do**:
  - Run `bun run build.ts` from `app-prefixable/` — must exit 0
  - Run `git push` to push all 3 commits to origin

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: []

  **Acceptance Criteria**:
  - [ ] Build exits 0
  - [ ] `git log --oneline -5` shows all 3 commits pushed

  **Commit**: NO (push only)

## Final Verification Wave
- [ ] F1. Build passes clean — check `bun run build.ts` output
- [ ] F2. Server label visible in desktop sidebar header without entering any dropdown
- [ ] F3. Server label visible in mobile Sessions tab header without entering any menu
- [ ] F4. No regressions — server dropdown still works, layout unchanged otherwise

## Commit Strategy
3 commits total (one per file), then push.

## Success Criteria
- Server name is always visible on desktop (sidebar header) and mobile (Sessions tab header) without user interaction
