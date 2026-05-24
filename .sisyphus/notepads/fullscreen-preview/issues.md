# Issues

## 2026-05-08
- The fullscreen preview button condition was written as `when={() => ...}` which is always truthy in SolidJS and can show the button outside the intended modes.
- The fullscreen HTML iframe needs to preserve the same security expectations as the normal HTML preview.
- Escape close may need extra care when focus moves into the preview iframe.
- The fullscreen overlay originally duplicated close affordances; one close control is enough for the final implementation.
- Security review also flagged path traversal in file saving as a separate high-priority issue to keep in mind for adjacent file-viewer logic.
- Context mining flagged missing Portal / dialog semantics as a likely source of stacking and accessibility regressions.
- QA was blocked by OpenCode API auth; browser verification still needs a rerun once the UI can be exercised end-to-end.
- If the backend auth issue persists, browser QA can only prove the app shell and the code path, not the full preview interaction.
