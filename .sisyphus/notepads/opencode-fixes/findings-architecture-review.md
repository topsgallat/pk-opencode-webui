
## Compose Security Fix (2026-03-28)

- docker-compose.solo.yml revised to eliminate all host path/config/cache leakage:
  - HOME now set to /home/opencode (container-local)
  - XDG_CACHE_HOME set to /tmp/.cache (container-local, ephemeral)
  - All host volume mounts (e.g., /home/sgallat:/home/sgallat) removed
- Rationale:
  - Host home/config/cache mounts expose sensitive user data (SSH keys, tokens, credentials) and break container isolation
  - Hardcoded host paths break portability and violate reviewer mandates
  - serve-ui.ts and shell entrypoints already enforce forbidden path logic at runtime; this compose fix ensures compliance at startup
  - Zero host volume mounts is the correct default for a UI server that does not require host filesystem access
- Validation:
  - docker compose config and docker inspect confirm no host paths or volumes are present
  - Container env shows HOME and XDG_CACHE_HOME are container-local
  - Reviewer can verify by inspecting compose config and container env
- This change brings the compose config into full compliance with security and portability requirements as documented in previous notepad entries and reviewer mandates.
