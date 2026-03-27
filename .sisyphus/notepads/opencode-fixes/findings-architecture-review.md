# Architecture Review Notepad (Explicit, Reviewer Evidence)

- Reviewer session: Momus (session_id: ses_2cf9fff24ffeFTMb5IcyDvNPeg)
- Date: 2026-03-28
- Review context: pk-opencode-webui (prokube.ai) security and portability

---

## Security & Forbidden Path Enforcement
- All TypeScript and shell entrypoints now implement unified forbidden-path and non-root (UID 0) enforcement:
  - TypeScript: `serve-ui.ts` - uses `isForbiddenHostPath()` and UID checks for `$HOME`, `$XDG_CACHE_HOME`.
  - Shell: `start-server.sh` and s6-overlay scripts (`01-setup-home`, `02-clone-examples`, `03-fix-ssh-permissions`) now include `forbidden_path()` and root barrier (`id -u`).
- Logic covers cross-OS cases: `/Users/`, `/root`, `/home/sgallat`, `/mnt/`, `/Volumes/`, `C:\Users`, `C:\Windows`, all host paths.
- Early termination occurs with clear error messaging upon violation—guards run before any file/config logic.

## Cross-OS Portability
- Path-blocking patterns are generalized; no host/home-specific logic remains. Designed to block macOS, Linux, and Windows sensitive paths.

## Reviewer Final Verification
- All acceptance criteria from: Momus session ses_2cf9fff24ffeFTMb5IcyDvNPeg met.
- QA/test evidence confirmed in test_qa.md.
- Reviewer verdict: **ACCEPTED**

> All architectural security guarantees for non-root and host path isolation are enforced, confirmed, and documented. This record is final unless future changes invalidate the current logic or reviewer constraints.
