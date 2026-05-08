# Fullscreen Preview for .md and .html Files

## TL;DR
> **Summary**: Add fullscreen toggle button to Markdown (.md) and HTML (.html) preview modes in file-viewer.tsx, allowing users to expand preview to fill the entire viewport.
> **Deliverables**: Fullscreen overlay with preview content, toggle button, ESC/X close handler
> **Effort**: Short
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3

## Context
### Original Request
User wants fullscreen preview for .md and .html files. Currently previews are constrained to the review panel area. User wants ability to expand to full viewport, similar to how EditorDialog works.

### Interview Summary
- .md preview (Markdown component) needs fullscreen toggle
- .html preview (iframe) needs fullscreen toggle
- Fullscreen fills entire viewport
- Close via X button or ESC key
- Uses Maximize2/Minimize2 icons from lucide-solid

### Metis Review (gaps addressed)
Metis consultation timed out - proceeding with self-analysis.

## Work Objectives
### Core Objective
Add fullscreen preview mode for .md and .html file types in file-viewer.tsx

### Deliverables
1. Maximize2 button appears in header when preview mode is active (.md + markdownPreview, or .html + htmlPreview)
2. Clicking Maximize2 shows fullscreen overlay with preview content
3. Fullscreen overlay has X button and ESC key handler to close
4. Minimize2 button in fullscreen to exit

### Definition of Done (verifiable conditions with commands)
- [ ] Maximize2 button visible when .md file is in preview mode
- [ ] Maximize2 button visible when .html file is in preview mode
- [ ] Click Maximize2 → fullscreen overlay appears with preview content
- [ ] X button in fullscreen overlay closes it
- [ ] ESC key closes fullscreen overlay
- [ ] Minimize2 button in fullscreen exits to normal view
- [ ] Fullscreen content fills viewport appropriately

### Must Have
- Fullscreen toggle for .md preview (Markdown component)
- Fullscreen toggle for .html preview (iframe)
- ESC key handler
- X close button in fullscreen overlay
- Proper z-index (z-[100] to match other dialogs)

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT modify EditorDialog
- Must NOT change existing preview logic (only add fullscreen layer)
- Must NOT add new dependencies (use existing lucide-solid)
- Must NOT break existing preview/edit toggle

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: Manual QA with Playwright + visual verification
- QA policy: Every task has agent-executed scenarios
- Evidence: .sisyphus/evidence/task-{N}-{slug}.{ext}

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Single task - Add fullscreen state and button
Wave 2: Single task - Implement fullscreen overlay
Wave 3: Single task - Add ESC key handler and final styling

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|------|------------|--------|
| 1    | -          | 2      |
| 2    | 1          | 3      |
| 3    | 2          | -      |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → visual-engineering
- Wave 2 → 1 task → visual-engineering
- Wave 3 → 1 task → visual-engineering

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add fullscreen state and Maximize2 button to file-viewer.tsx header

  **What to do**: 
  1. Import `Maximize2`, `Minimize2`, `X` from `lucide-solid`
  2. Add `const [fullscreenPreview, setFullscreenPreview] = createSignal(false)`
  3. In the header div (line ~221), add Show when condition to display Maximize2 button:
     - Show when: `isMarkdown() && markdownPreview()` OR `isHtml() && htmlPreview()`
     - Button onClick: `() => setFullscreenPreview(true)`
     - Icon: Maximize2 with class "w-3.5 h-3.5"
  4. Add Minimize2 button inside fullscreen overlay (Task 2 will create the overlay)

  **Must NOT do**: 
  - Do NOT modify existing Pencil/Edit button
  - Do NOT change markdownPreview or htmlPreview toggle logic

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI component modification with SolidJS signals
  - Skills: [] - No special skills needed
  - Omitted: [] - N/A

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Task 2 | Blocked By: None

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/src/components/file-viewer.tsx:221-247` - Header button area to add Maximize2
  - Icons: `lucide-solid` - Maximize2, Minimize2, X icons
  - Existing pattern: `app-prefixable/src/components/file-viewer.tsx:222-234` - Show when pattern for preview toggle

  **Acceptance Criteria** (agent-executable only):
  - [ ] File contains import for Maximize2, Minimize2, X from lucide-solid
  - [ ] fullscreenPreview signal exists
  - [ ] Maximize2 button appears when .md file is in preview mode (markdownPreview() === true)
  - [ ] Maximize2 button appears when .html file is in preview mode (htmlPreview() === true)
  - [ ] Clicking Maximize2 sets fullscreenPreview to true

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Maximize2 button appears for .md preview
    Tool: Playwright
    Steps: 
    1. Navigate to app
    2. Open a .md file
    3. Verify preview mode is active (not source)
    4. Check header for Maximize2 button
    Expected: Maximize2 button is visible in file-viewer header
    Evidence: .sisyphus/evidence/task-1-maximize-button-md.png

  Scenario: Maximize2 button appears for .html preview
    Tool: Playwright
    Steps:
    1. Navigate to app
    2. Open a .html file
    3. Verify preview mode is active
    4. Check header for Maximize2 button
    Expected: Maximize2 button is visible in file-viewer header
    Evidence: .sisyphus/evidence/task-1-maximize-button-html.png
  ```

  **Commit**: YES/NO | Message: `feat: add fullscreen state and maximize button for preview` | Files: [app-prefixable/src/components/file-viewer.tsx]

- [x] 2. Implement fullscreen overlay with preview content

  **What to do**:
  1. After the main content div (before EditorDialog), add a Show when={fullscreenPreview()}:
  2. Create fullscreen overlay div:
     ```tsx
     <Show when={fullscreenPreview()}>
       <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
         <div class="w-full h-full bg-white dark:bg-gray-900 relative">
           <button
             class="absolute top-4 right-4 z-10 p-2 hover:bg-black/10 rounded"
             onClick={() => setFullscreenPreview(false)}
           >
             <X class="w-5 h-5" />
           </button>
           <button
             class="absolute top-4 right-16 z-10 p-2 hover:bg-black/10 rounded"
             onClick={() => setFullscreenPreview(false)}
           >
             <Minimize2 class="w-5 h-5" />
           </button>
           <div class="w-full h-full overflow-auto">
             // Preview content here
           </div>
         </div>
       </div>
     </Show>
     ```
  3. Inside the preview content div, add conditional rendering:
     - When isMarkdown() && markdownPreview(): render `<Markdown content={fileContent()} class="p-8 max-w-4xl mx-auto" />`
     - When isHtml() && htmlPreview(): render `<iframe src={htmlBlobUrl()} sandbox="" class="w-full h-full border-0" title="HTML preview" />`
  4. Ensure overlay is outside the main scrollable area (after the main div closing tag)

  **Must NOT do**:
  - Do NOT modify the normal (non-fullscreen) preview rendering
  - Do NOT change EditorDialog

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Complex UI layout with overlay and conditional rendering
  - Skills: [] - No special skills needed
  - Omitted: [] - N/A

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 3 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app-prefixable/src/components/confirm-dialog.tsx:94` - Fixed overlay pattern (fixed inset-0 z-[100])
  - Pattern: `app-prefixable/src/components/file-viewer.tsx:279-282` - Markdown preview rendering
  - Pattern: `app-prefixable/src/components/file-viewer.tsx:270-276` - HTML iframe rendering
  - Overlay bg: `bg-black/50` for backdrop (common pattern in project)

  **Acceptance Criteria** (agent-executable only):
  - [ ] Fullscreen overlay appears when fullscreenPreview() is true
  - [ ] Overlay uses fixed inset-0 z-[100] pattern
  - [ ] X button closes fullscreen (sets fullscreenPreview to false)
  - [ ] Minimize2 button closes fullscreen
  - [ ] Markdown content renders correctly in fullscreen
  - [ ] HTML iframe renders correctly in fullscreen
  - [ ] Overlay has semi-transparent backdrop (bg-black/50)

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Fullscreen overlay shows Markdown preview
    Tool: Playwright
    Steps:
    1. Navigate to app
    2. Open a .md file
    3. Click Maximize2 button
    4. Verify fullscreen overlay appears
    5. Verify Markdown content is visible
    Expected: Fullscreen overlay with Markdown preview content
    Evidence: .sisyphus/evidence/task-2-fullscreen-markdown.png

  Scenario: Fullscreen overlay shows HTML preview
    Tool: Playwright
    Steps:
    1. Navigate to app
    2. Open a .html file
    3. Click Maximize2 button
    4. Verify fullscreen overlay appears
    5. Verify iframe with HTML content is visible
    Expected: Fullscreen overlay with HTML iframe
    Evidence: .sisyphus/evidence/task-2-fullscreen-html.png

  Scenario: X button closes fullscreen
    Tool: Playwright
    Steps:
    1. Open .md file, click Maximize2
    2. Click X button in overlay
    Expected: Fullscreen overlay closes, returns to normal view
    Evidence: .sisyphus/evidence/task-2-close-x.png
  ```

  **Commit**: YES/NO | Message: `feat: implement fullscreen overlay for preview modes` | Files: [app-prefixable/src/components/file-viewer.tsx]

- [x] 3. Add ESC key handler and final styling

  **What to do**:
  1. Add ESC key handler using createEffect:
     ```tsx
     createEffect(() => {
       if (!fullscreenPreview()) return
       const handler = (e: KeyboardEvent) => {
         if (e.key === "Escape") setFullscreenPreview(false)
       }
       document.addEventListener("keydown", handler)
       onCleanup(() => document.removeEventListener("keydown", handler))
     })
     ```
  2. Adjust fullscreen content styling:
     - Markdown: Add `max-w-4xl mx-auto` for readability, `p-8` padding
     - HTML iframe: Use `h-full` instead of fixed height
  3. Ensure dark mode compatibility: overlay inner div uses `bg-white dark:bg-gray-900`
  4. Add smooth transition (optional): `transition-opacity duration-200` to overlay

  **Must NOT do**:
  - Do NOT add ESC handler for non-fullscreen state
  - Do NOT modify other keyboard shortcuts

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Keyboard event handling + styling polish
  - Skills: [] - No special skills needed
  - Omitted: [] - N/A

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: None | Blocked By: Task 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: SolidJS createEffect + onCleanup for event listeners
  - Styling: Tailwind dark: prefix for dark mode (used throughout project)
  - Event handler: `document.addEventListener("keydown", handler)` for ESC

  **Acceptance Criteria** (agent-executable only):
  - [ ] ESC key closes fullscreen overlay when open
  - [ ] ESC handler is removed when fullscreen closes (onCleanup)
  - [ ] Markdown preview in fullscreen has appropriate max-width and padding
  - [ ] Dark mode works correctly in fullscreen overlay
  - [ ] No console errors related to event listeners

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: ESC key closes fullscreen overlay
    Tool: Playwright
    Steps:
    1. Navigate to app
    2. Open .md file, click Maximize2
    3. Press ESC key
    Expected: Fullscreen overlay closes
    Evidence: .sisyphus/evidence/task-3-esc-key.png

  Scenario: Dark mode fullscreen
    Tool: Playwright
    Steps:
    1. Enable dark mode in settings
    2. Open .html file, click Maximize2
    3. Verify overlay background is dark
    Expected: Fullscreen overlay uses dark:bg-gray-900
    Evidence: .sisyphus/evidence/task-3-dark-mode.png
  ```

  **Commit**: YES/NO | Message: `feat: add ESC key handler and polish fullscreen preview` | Files: [app-prefixable/src/components/file-viewer.tsx]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep
## Commit Strategy
- Commit 1: `feat: add fullscreen state and maximize button for preview`
- Commit 2: `feat: implement fullscreen overlay for preview modes`
- Commit 3: `feat: add ESC key handler and polish fullscreen preview`
- All commits to `dev` branch
- Push after each commit (user confirmed push access works)

## Success Criteria
- Maximize2 button visible in header when .md or .html file is in preview mode
- Clicking Maximize2 opens fullscreen overlay with correct preview content
- X button and ESC key both close fullscreen overlay
- Fullscreen overlay uses correct z-index (z-[100]) and backdrop
- Markdown content is readable in fullscreen (appropriate width/padding)
- HTML iframe fills fullscreen properly
- Dark mode compatibility maintained
- No regressions to existing preview/edit functionality
