# Draft: Chat Scroll Redesign

## Requirements (confirmed)
- Redesign chat auto scroll to feel smooth during streaming replies.
- Eliminate shaking, bouncing, stuttering, and jumpy behavior.
- Rework the auto-scroll behavior instead of continuing incremental patches.
- While the user remains pinned to the bottom, auto-follow should stay pinned to the bottom continuously.
- If the user scrolls up at all to read older messages, auto-follow must stop immediately.

## Technical Decisions
- Auto-follow policy: keep pinned to bottom while the user is at bottom.
- User override policy: any intentional upward scroll immediately disables auto-follow until the user returns to bottom.
- Pending research: exact scroll controller, render triggers, and verification strategy.

## Research Findings
- Pending background exploration results.

## Open Questions
- What tolerance/snap behavior feels right on desktop vs mobile?
- Should smooth scrolling animation ever be used during token streaming, or only instant bottom pinning?

## Scope Boundaries
- INCLUDE: session chat timeline auto-follow behavior, streaming update handling, resize/render interactions, verification strategy.
- EXCLUDE: unrelated terminal scrolling, file tree scrolling, project picker scrolling.
