# Decisions

## 2026-05-08
- Keep the fix scoped to `app-prefixable/src/components/file-viewer.tsx`.
- Preserve existing preview/edit behavior; only correct the fullscreen conditional, overlay behavior, and HTML preview safety.
- Use the same sandboxing approach for inline and fullscreen HTML previews.
