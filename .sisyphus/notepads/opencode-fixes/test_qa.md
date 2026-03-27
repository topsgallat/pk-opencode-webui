# Test QA Notepad (Explicit, Reviewer Evidence)

- Manual and automated test instructions provided for all startup checks, Compose config, and persistence.
- Reviewer can trigger Compose startup in a clean environment, verify enforcement of path/user rules in the logs, and trigger controlled failures for forbidden cases.
- serve-ui.ts behavior fully testable by changing env/user at runtime and confirming exit code/log output.

---

## Security & Portability Review: pk-opencode-webui (2026-03-27)

### Status: REJECT

### 1. Security Analysis
- **Rootless Operation**: 
    - `docker/kubeflow/Dockerfile` correctly implements `USER jovyan` and UID 1000.
    - `docker/Dockerfile` (Generic) currently runs as `root` (no USER instruction). **CRITICAL REJECT**.
- **Privilege Escalation**:
    - `docker/kubeflow/Dockerfile` removes SUID/SGID bits. Excellent.
- **Path Enforcement**:
    - `serve-ui.ts` contains hardcoded checks against `/home/user` and `/home/sgallat`.
    - Portability Issue: These checks are too specific and will fail in environments with different host home paths.
- **Credential Safety**:
    - `docker-compose.yml` mounts `/home/sgallat:/home/sgallat`. This is a massive security risk if unintended for generic use.

### 2. Portability Analysis
- **Base Path Prefixing**:
    - `serve-ui.ts` handles `NB_PREFIX` and `BASE_PATH` correctly for reverse proxy support.
- **OpenCode CLI Pinning**:
    - `docker/Dockerfile` pins to `1.2.6`.
    - `docker/kubeflow/Dockerfile` uses `latest` via `curl | bash`. **REJECT** for lack of reproducibility.
- **Multi-arch Support**:
    - `s6-overlay` installation logic handles `x86_64` and `aarch64` dynamically. Good.

### 3. Startup Verification
- **Process Supervision**: Uses `s6-overlay` (v3.1.6.2).
- **Solo Mode**: `serve-ui.ts` manages both API and UI, but the root/home checks are brittle.

## Required Fixes for Approval
1. **Generic Dockerfile**: Add `USER` instruction and setup non-root user.
2. **CLI Pinning**: Pin OpenCode version in `docker/kubeflow/Dockerfile` to match generic one.
3. **Path Sanitization**: Generalize the forbidden path check in `serve-ui.ts` or make it configurable.
4. **Compose Cleanup**: Remove or comment out the specific `/home/sgallat` volume mount in the main `docker-compose.yml`.
