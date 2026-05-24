# Learnings

## 2026-05-08
- SolidJS `<Show when={...}>` must receive a boolean/accessor value, not an arrow function wrapper that returns a function object.
- Fullscreen overlay patterns in this repo use `fixed inset-0 z-[100]`, `Portal`, and CSS variables for background/theme consistency.
- Existing dialog patterns (`editor-dialog.tsx`, `confirm-dialog.tsx`) listen for Escape on `document` and clean up with `onCleanup`.
- User-provided HTML preview should be sandboxed consistently in both inline and fullscreen modes.
- Security review flagged path traversal risk in file-save path construction as the main blocking issue to watch for in nearby code.
- Context mining found the fullscreen implementation diverges from dialog conventions when it skips `Portal` / dialog ARIA patterns.
- Code quality review did not find blockers, but noted the file-viewer should keep an eye on small reuse/performance cleanups if touched again.
- QA report shows browser verification is currently blocked by API auth, so manual UI proof may need a backend/auth fix before it can pass.
- Dialog parity matters: `Portal` + `role="dialog"` + `aria-modal="true"` + focus restoration matches the repo’s existing modal pattern.
- Save-path safety can be enforced locally by normalizing paths before calling the write API and rejecting escapes outside `sdk.directory`.
