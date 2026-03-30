Verification notes for F3 Final Re-Review

Date: 2026-03-29

Summary:
- ConfirmDialog: file-tree.tsx now uses ConfirmDialog component instead of window.confirm. Delete flow sets deleteTarget and opens ConfirmDialog; onConfirm calls handleDelete and closes dialog.
- aria-expanded: directory toggle button includes aria-expanded={expanded()} and updates when expanded() changes.
- viewport meta: index.html viewport meta no longer contains user-scalable=no; current content: "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover".
- Terminal WebSocket error banner: terminal.tsx shows a visible banner (role="alert") when setShowBanner is true; includes Dismiss and Retry buttons. Retry closes WS and calls connect() to re-establish.

Developer notes:
- lsp_diagnostics reported only hints (unused variables / deprecated icon) in the changed files; no errors.
- Attempted to run local build via the automation tool but environment returned posix_spawn error. Repository context indicates a successful build in recent commit message: "Build passes: 698 files, \"Done!\"". Recommend running local "bun run build.ts" in CI or dev machine to re-verify if needed.
2026-03-30T03:14:00Z | Applied minimal patch: captured menu() into local const before setContextMenu(null) in file-tree.tsx handlers; guarded new-file-dialog focus timeout and clearTimeout on cleanup to avoid focusing after close. Prevents "Stale read from <Show>" and dangling focus timeout.
