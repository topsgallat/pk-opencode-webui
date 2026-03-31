# Learnings

## Storage
- `PROJECTS_STORAGE_KEY = "opencode.projects"` (localStorage)
- Format: `Project[]` where `Project = { worktree: string; name?: string }`
- Already defined at top of `mobile-layout.tsx` (line 47) — do NOT add a second declaration
- `layout.tsx` has `saveProjects()` which writes this key; mobile just reads it

## Navigation
- `base64Encode(worktree)` → `dirSlug`
- Navigate to a project: `navigate("/" + base64Encode(worktree) + "/session")`
- The `handleProjectSelect` in `layout.tsx` calls `addProject(worktree)` then navigates

## UX Pattern: Bottom Sheet
- `menuSession` bottom sheet (lines 351–421 of mobile-layout.tsx) is the established pattern
- Use: `fixed inset-0 z-50` overlay + `absolute bottom-0 left-0 right-0 rounded-t-2xl` sheet
- Backdrop: `bg-black/40`
- Sheet handle: `w-10 h-1 rounded-full` centered at top
- Safe area: `padding-bottom: env(safe-area-inset-bottom, 16px)`

## Wiring
- `layout.tsx` line 2002: `<MobileLayout onOpenProject={() => setProjectDialogOpen(true)}>`
- `MobileLayout` calls `props.onOpenProject?.()` when project button is tapped (line 215)
- Plan: add `showProjectHistory` signal, intercept tap → show history sheet → "Browse..." calls `props.onOpenProject?.()`

## Code Style (from AGENTS.md)
- No `let` — use `const` + ternary
- No `else` — early return
- No `any`, no `try/catch` unless necessary
- No unnecessary destructuring
- Single-word var names preferred
- CSS variables only for colors
- No hardcoded paths — use `prefix()` / `base64Encode` for navigation

## Completion
- Successfully added the mobile project history bottom sheet.
- Re-used `PROJECTS_STORAGE_KEY` and duplicated the exact layout style from `menuSession`.
- Handled empty histories by bypassing the sheet entirely.
- Highlighted the active directory using the provided `useSDK().directory` reactive value.
