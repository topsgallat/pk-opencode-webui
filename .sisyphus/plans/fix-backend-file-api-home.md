# Fix Backend /file API for Home Directory

## TL;DR
> **Summary**: OpenCode backend `/file` API returns empty array `[]` for home directory because `path.join(ctx.directory, dir)` mishandles absolute paths.
> **Deliverables**: Patched `/tmp/opencode-ref/packages/opencode/src/file/index.ts` (or upstream repo), verified fix with curl.
> **Effort**: Quick
> **Parallel**: NO
> **Critical Path**: Fix `list` function → Rebuild server → Restart → Verify with curl

## Context
### Original Request
User reported: "~/ shows only ~/, typing ~/ gives No matching directories or paths, / shows directory in /home/sgallat"

### Investigation Summary
- Frontend correctly sends `GET /file?path=/home/opencode` (absolute path)
- Backend `/file` API returns `[]` for home directory
- Root cause found in OpenCode upstream code at `/tmp/opencode-ref/packages/opencode/src/file/index.ts`

### Metis Review (gaps addressed)
- Confirmed bug is in backend, not frontend
- `toRemoteListPath` frontend fix already committed (`2e842bf`)
- Need to fix `list` function in backend to handle absolute paths correctly

## Work Objectives
### Core Objective
Fix OpenCode backend `File.list()` function to correctly handle absolute paths (including home directory).

### Deliverables
1. Patched `list` function in `/tmp/opencode-ref/packages/opencode/src/file/index.ts`
2. Rebuilt and restarted OpenCode server
3. Verified fix with `curl http://192.168.1.173:4096/file?path=/home/opencode` returns directory listing

### Definition of Done
- `curl "http://192.168.1.173:4096/file?path=/home/opencode"` returns JSON array with at least home directory entry
- Frontend project picker shows directories when typing `~/`
- No regression in other directory listings

### Must Have
- Fix absolute path handling in `list` function
- Handle both absolute and relative paths correctly
- Maintain security check (`Instance.containsPath`)

### Must NOT Have (guardrails)
- Do NOT break `Instance.containsPath` security check
- Do NOT change API contract (still expect `path` query parameter)
- Do NOT modify frontend code (already fixed in `2e842bf`)

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test: `curl "http://192.168.1.173:4096/file?path=/home/opencode"` should return non-empty array
- Test: `curl "http://192.168.1.173:4096/file?path=/"` should work
- Test: Frontend project picker with `~/` should show directories
- Evidence: `.sisyphus/evidence/task-1-curl-output.txt`

## Execution Strategy
### Parallel Execution Waves
> Target: 2-3 tasks per wave.

Wave 1: Fix backend code
Wave 2: Rebuild + restart server
Wave 3: Verify fix

### Dependency Matrix
- Task 1 (Fix code) → Task 2 (Rebuild) → Task 3 (Verify)

### Agent Dispatch Summary
- Wave 1: 1 task (quick category)
- Wave 2: 1 task (quick category)
- Wave 3: 1 task (quick category)

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Fix `list` function to handle absolute paths correctly

  **What to do**: 
  - Edit `/tmp/opencode-ref/packages/opencode/src/file/index.ts` line 589
  - Change: `const resolved = dir ? path.join(ctx.directory, dir) : ctx.directory`
  - To: `const resolved = dir ? (path.isAbsolute(dir) ? dir : path.join(ctx.directory, dir)) : ctx.directory`
  - This ensures absolute paths (like `/home/opencode`) are used as-is, not joined with `ctx.directory`

  **Must NOT do**: 
  - Do NOT remove the `Instance.containsPath` security check
  - Do NOT change how `ctx.directory` is used elsewhere

  **Recommended Agent Profile**:
  - Category: `quick` - Simple one-line fix
  - Skills: `[]` - No special skills needed
  - Omitted: `git-master` - Not modifying git repos

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Task 2 | Blocked By: None

  **References** (executor has NO interview context - be exhaustive):
  - Bug Location: `/tmp/opencode-ref/packages/opencode/src/file/index.ts:589`
  - Current code: `const resolved = dir ? path.join(ctx.directory, dir) : ctx.directory`
  - `ctx.directory`: The project directory (e.g., `/home/opencode`)
  - `dir`: The path from API query (e.g., `/home/opencode` or `home/opencode`)
  - Node.js `path.isAbsolute()`: Returns true if path starts with `/` (Unix) or drive letter (Windows)

  **Acceptance Criteria** (agent-executable only):
  - [ ] After fix, `path.join(ctx.directory, "/home/opencode")` no longer produces `/home/opencode/home/opencode`
  - [ ] `path.isAbsolute(dir)` check added before `path.join`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Absolute path handling
    Tool: Bash
    Steps: node -e "const path = require('path'); console.log(path.join('/home/opencode', '/home/opencode'))"
    Expected: Should NOT produce `/home/opencode/home/opencode` (bug)
    Evidence: .sisyphus/evidence/task-1-bug-demo.txt

  Scenario: Fixed absolute path handling
    Tool: Bash
    Steps: node -e "const path = require('path'); const dir = '/home/opencode'; const resolved = path.isAbsolute(dir) ? dir : path.join('/home/opencode', dir); console.log(resolved);"
    Expected: Should print `/home/opencode`
    Evidence: .sisyphus/evidence/task-1-fix-demo.txt
  ```

  **Commit**: NO (editing upstream code at /tmp/opencode-ref) | Message: N/A | Files: N/A

- [ ] 2. Rebuild and restart OpenCode server

  **What to do**: 
  - Navigate to `/tmp/opencode-ref`
  - Rebuild the project: `bun run build` or equivalent
  - Restart the OpenCode server on port 4096
  - Verify server is running: `curl http://192.168.1.173:4096/path`

  **Must NOT do**: 
  - Do NOT modify frontend code
  - Do NOT push to GitHub (upstream repo is read-only clone)

  **Recommended Agent Profile**:
  - Category: `quick` - Build + restart
  - Skills: `[]`
  - Omitted: `git-master` - No git operations needed

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 3 | Blocked By: Task 1

  **References**:
  - Build tool: Likely `bun` or `npm` at `/tmp/opencode-ref`
  - Server restart: Need to kill existing process on 4096 and start new one
  - May need to run `opencode serve` from a test directory

  **Acceptance Criteria**:
  - [ ] Server rebuilt successfully
  - [ ] Server running on port 4096
  - [ ] `curl http://192.168.1.173:4096/path` returns JSON

  **QA Scenarios**:
  ```
  Scenario: Server rebuild
    Tool: Bash
    Steps: cd /tmp/opencode-ref && bun run build
    Expected: Build succeeds (exit 0)
    Evidence: .sisyphus/evidence/task-2-build-log.txt

  Scenario: Server restart
    Tool: Bash
    Steps: pkill -f "opencode serve"; cd /home/sgallat && nohup opencode serve &
    Expected: Server starts on port 4096
    Evidence: .sisyphus/evidence/task-2-server-start.txt
  ```

  **Commit**: NO | Message: N/A | Files: N/A

- [ ] 3. Verify /file API returns correct results for home directory

  **What to do**: 
  - Test: `curl "http://192.168.1.173:4096/file?path=/home/opencode"`
  - Expected: Non-empty JSON array with directory entries
  - Test frontend: Navigate to `http://192.168.1.173:8090`, click "Open Project", type `~/`
  - Expected: Directory listing shows entries (not "No matching directories or paths")

  **Must NOT do**: 
  - Do NOT modify any code (verification only)

  **Recommended Agent Profile**:
  - Category: `quick` - Verification
  - Skills: `[]`
  - Omitted: N/A

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: None | Blocked By: Task 2

  **References**:
  - API endpoint: `GET /file?path=<absolute-path>`
  - Frontend URL: `http://192.168.1.173:8090`
  - Previous test result: `.sisyphus/outputs/project-picker-debug.json`

  **Acceptance Criteria**:
  - [ ] `curl "http://192.168.1.173:4096/file?path=/home/opencode"` returns non-empty array
  - [ ] `curl "http://192.168.1.173:4096/file?path=/"` works correctly

  **QA Scenarios**:
  ```
  Scenario: API returns directory listing
    Tool: Bash
    Steps: curl -s "http://192.168.1.173:4096/file?path=/home/opencode" | head -100
    Expected: JSON array with at least 1 entry
    Evidence: .sisyphus/evidence/task-3-curl-output.json

  Scenario: Frontend project picker works with ~/
    Tool: playwright_browser_navigate
    Steps: Navigate to http://192.168.1.173:8090, click "Open Project", type ~/, wait 2s
    Expected: Directory listing shows entries (not empty)
    Evidence: .sisyphus/evidence/task-3-picker-screenshot.png
  ```

  **Commit**: NO | Message: N/A | Files: N/A

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep
## Commit Strategy
- No commits needed (editing upstream code at /tmp/opencode-ref, not our repo)
- Our repo already has frontend fix committed as `2e842bf` (dev branch)

## Success Criteria
- `curl "http://192.168.1.173:4096/file?path=/home/opencode"` returns non-empty JSON array
- Frontend project picker shows directories when typing `~/`
- No regression in other directory listings (test with `/`, `/home`, etc.)
