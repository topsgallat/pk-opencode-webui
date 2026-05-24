# Session Agent/Model Restore

## TL;DR
> **Summary**: Make agent/model selection session-scoped so switching sessions immediately updates the visible UI and send-time payloads.
> **Deliverables**: session-scoped selection source of truth, restored UI on session change, verified behavior for switch/new/fork/delete.
> **Effort**: Short
> **Parallel**: NO
> **Critical Path**: session selection source → UI consumers → QA

## Context
### Original Request
- Remember the agent/model used by each session.
- When switching sessions, restore that session’s agent/model immediately.
- User confirmed the UI itself must change, not just send-time behavior.

### Interview Summary
- The previous localStorage-only attempt did not visibly change the UI on session switch.
- User is okay with moving away from the current global provider selection model.
- Best direction: session-scoped selection state, not a global mutable provider state.

### Metis Review (gaps addressed)
- Global `ProviderProvider` state is the mismatch.
- Need restore-before-render behavior.
- Need explicit handling for missing session entries and same-session reselects.

## Work Objectives
### Core Objective
Make `agent` and `model` behave like session-local state in the session view.

### Deliverables
- session-scoped selection store keyed by server + directory + session
- UI consumers wired to the session-scoped values
- restore flow on session change
- agent/model persistence on user changes
- QA evidence for switch/new/fork/delete cases

### Definition of Done (verifiable conditions with commands)
- `bun run build.ts` succeeds in `app-prefixable`
- session switch shows the restored agent/model in the header/pickers without manual reselection
- new/forked sessions inherit the expected selection
- deleted sessions do not leak stale selection into the next session

### Must Have
- restore immediately on session switch
- keep values isolated by server + directory + session ID
- no change to unrelated provider configuration behavior

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- no backend schema/API changes
- no rework of unrelated provider settings
- no “save only” fix that leaves the UI stale

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + targeted UI verification
- QA policy: every task must include agent-executed switch/new/fork/delete scenarios
- Evidence: `.sisyphus/evidence/session-agent-model-restore/*`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.

Wave 1: session-scoped state source and restore flow
Wave 2: wire consumers + verification

### Dependency Matrix (full, all tasks)
- Task 1 → Task 2

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → quick/deep
- Wave 2 → 1 task → quick/unspecified-high

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Make session-scoped agent/model the source of truth

  **What to do**: Introduce a session-keyed selection store and make the session switch flow restore the stored agent/model before the UI renders. Persist updates when the user changes agent/model, and ensure missing entries fall back to a deterministic default that is also written back for that session.

  **Must NOT do**: Do not leave the UI reading only from the old directory-scoped global selection state; do not change backend APIs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: touches state flow and restore timing across several UI consumers
  - Skills: `[]` - No special skill required
  - Omitted: `visual-engineering` - not primarily a styling task

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: task 2 | Blocked By: none

  **References**:
  - Pattern: `app-prefixable/src/pages/session.tsx` - session switch, send-time payloads, restore timing
  - Pattern: `app-prefixable/src/context/providers.tsx` - current selection ownership and UI consumers
  - Pattern: `app-prefixable/src/components/session-info.tsx` - visible agent/model header values
  - Pattern: `app-prefixable/src/components/command-palette.tsx` - command descriptions that reflect selection state
  - Test: `app-prefixable/src/components/session-sidebar.test.ts` - existing test style in the area

  **Acceptance Criteria**:
  - [ ] Switching from session A to session B updates the displayed agent/model immediately.
  - [ ] Returning to session A restores its previously used agent/model.
  - [ ] `bun run build.ts` passes after the change.

  **QA Scenarios**:
  ```
  Scenario: Switch between two sessions with different selections
    Tool: Playwright
    Steps: Open session A, choose agent/model X; open session B, choose agent/model Y; switch back to A using the sidebar.
    Expected: Header and pickers show X again without manual reselect.
    Evidence: .sisyphus/evidence/session-agent-model-restore/switch-back-to-a.md

  Scenario: Missing saved selection falls back deterministically
    Tool: Playwright
    Steps: Open a new session with no stored entry.
    Expected: UI shows the deterministic default and writes a session entry once a choice is made.
    Evidence: .sisyphus/evidence/session-agent-model-restore/missing-entry-fallback.md
  ```

  **Commit**: YES | Message: `fix: restore session agent and model immediately` | Files: [app-prefixable/src/pages/session.tsx, app-prefixable/src/context/providers.tsx, app-prefixable/src/components/session-info.tsx]

- [ ] 2. Verify edge-case session transitions

  **What to do**: Validate new session creation, forked session inheritance, deleted-session navigation, and same-session reselect behavior. Ensure no stale selection leaks across directory changes or after session deletion.

  **Must NOT do**: Do not broaden scope into unrelated navigation or sidebar refactors.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: verification-heavy, cross-flow QA
  - Skills: `[]` - No special skill required
  - Omitted: `deep` - not primarily a research task

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: task 1

  **References**:
  - Pattern: `app-prefixable/src/pages/session.tsx` - create/fork/delete navigation and restore logic
  - Pattern: `app-prefixable/src/pages/layout.tsx` - session navigation and current-session routing
  - Pattern: `app-prefixable/src/utils/notify.ts` - per-session localStorage pattern for cleanup ideas
  - Test: `app-prefixable/e2e/` - browser verification location

  **Acceptance Criteria**:
  - [ ] New sessions use the expected default selection.
  - [ ] Forked sessions inherit the source session selection.
  - [ ] Deleted/archived session navigation does not show a stale selection from the removed session.

  **QA Scenarios**:
  ```
  Scenario: Fork a session and verify inherited selection
    Tool: Playwright
    Steps: Open session A, set agent/model Z, fork from a message, open the forked session.
    Expected: Forked session shows Z on first render.
    Evidence: .sisyphus/evidence/session-agent-model-restore/fork-inherits-selection.md

  Scenario: Delete current session and navigate to neighbor
    Tool: Playwright
    Steps: Open session A and B with different selections, delete A, observe neighbor session.
    Expected: Neighbor session shows its own selection, not A’s stale values.
    Evidence: .sisyphus/evidence/session-agent-model-restore/delete-no-leak.md
  ```

  **Commit**: YES | Message: `test: cover session selection restore edge cases` | Files: [app-prefixable/e2e/session-selection.spec.ts]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit 1: implementation of session-scoped restore
- Commit 2: edge-case verification

## Success Criteria
- Session switch visibly updates the agent/model UI immediately.
- The restored selection is correct for each session.
- No stale selection leaks across create/fork/delete/navigation flows.
