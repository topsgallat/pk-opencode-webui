## 2026-04-27
- TypeScript LSP diagnostics were unavailable because `typescript-language-server` is not installed in the environment.
- `bun x tsc --noEmit` reports existing unrelated errors in `src/pages/layout.tsx` and `src/utils/servers.ts`.
- The repository-level typecheck still fails after this change, but the failures are unrelated to `directory-layout.tsx`.
