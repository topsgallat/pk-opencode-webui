# Fullscreen Preview QA Test Plan

## Test Scenarios

### Happy Path (P0 - 7 scenarios)
1. **MD-Preview-Fullscreen-Open**: Open .md file → preview mode → Maximize2 button visible → click → fullscreen overlay appears
2. **MD-Fullscreen-Close-X**: Fullscreen open → click X button → fullscreen closes
3. **MD-Fullscreen-Close-Escape**: Fullscreen open → press Escape → fullscreen closes
4. **HTML-Preview-Fullscreen-Open**: Open .html file → preview mode → Maximize2 button visible → click → fullscreen with iframe appears
5. **HTML-Fullscreen-Close-X**: HTML fullscreen open → click X → closes correctly
6. **Fullscreen-Viewport-Fill**: Fullscreen overlay fills entire viewport (check inset-0 class)
7. **Fullscreen-Content-Render**: Content renders correctly in fullscreen (matches non-fullscreen)

### State Transitions (P0 - 4 scenarios)
8. **MD-Toggle-Source-Preview**: Toggle markdown source/preview → Maximize2 button shows/hides correctly
9. **Fullscreen-Reopen**: Open fullscreen → close → reopen → still works
10. **File-Switch**: Switch between .md and .html files → fullscreen button updates correctly
11. **Preview-Toggle-While-Fullscreen**: Toggle preview mode while fullscreen is open → fullscreen closes or updates

### Regression (P1 - 4 scenarios)
12. **Edit-Button-After-Fullscreen**: Edit button still works after fullscreen use
13. **Preview-Edit-Toggle-After-Fullscreen**: Preview/edit toggle works after fullscreen
14. **File-Content-Preserved**: File content renders correctly in fullscreen (no data loss)
15. **Multiple-Files-Fullscreen**: Multiple files open → fullscreen works for each

### Non-Previewable Files (P1 - 5 scenarios)
16. **TS-No-Fullscreen-Button**: .ts file → no Maximize2 button in source mode
17. **TS-No-Fullscreen-Button-Preview**: .ts file → no Maximize2 button (no preview mode)
18. **JS-No-Fullscreen-Button**: .js file → no Maximize2 button
19. **Image-No-Fullscreen-Button**: Image file → no Maximize2 button
20. **Binary-No-Fullscreen-Button**: Binary file → no Maximize2 button

### Boundary/Error (P2 - 5 scenarios)
21. **Rapid-Fullscreen-Toggle**: Rapid click fullscreen toggle → no errors, stable state
22. **Large-Content-Fullscreen**: Large content in fullscreen → scrollable
23. **Multiple-Escape-Presses**: Multiple Escape presses → no errors
24. **Click-Outside-Fullscreen**: Click outside fullscreen overlay → should NOT close (only X and Escape)
25. **Fullscreen-Z-Index**: Fullscreen overlay z-index → should be above other elements (z-[100])

### UX (P1 - 5 scenarios)
26. **Fullscreen-Backdrop**: Fullscreen overlay has semi-transparent backdrop (bg-black/50)
27. **X-Button-Position**: X button is positioned at top-right
28. **Fullscreen-Content-Readable**: Content in fullscreen is readable (proper padding, font-size)
29. **Markdown-Render-Fullscreen**: Markdown renders correctly in fullscreen
30. **HTML-Iframe-Fullscreen**: HTML iframe loads correctly in fullscreen

### Reflection Additions (P1 - 5 scenarios)
31. **Fullscreen-Viewport-Inset**: Verify fullscreen overlay uses inset-0 class to fill viewport
32. **X-Button-Aria-Label**: Verify X button has proper aria-label="Close Fullscreen"
33. **Escape-Handler-Cleanup**: Verify Escape key handler is properly cleaned up on component unmount
34. **Iframe-Sandbox-Preserved**: Verify iframe sandbox attribute is preserved in fullscreen
35. **Fullscreen-Scroll-Small-Viewport**: Verify content is scrollable in fullscreen on small viewports

## Test Execution Plan

### P0 Tests (Must Pass)
- MD-Preview-Fullscreen-Open
- MD-Fullscreen-Close-X
- MD-Fullscreen-Close-Escape
- HTML-Preview-Fullscreen-Open
- Fullscreen-Viewport-Fill
- Fullscreen-Content-Render
- MD-Toggle-Source-Preview
- Fullscreen-Reopen
- File-Switch
- Preview-Toggle-While-Fullscreen

### P1 Tests (Should Pass)
- Edit-Button-After-Fullscreen
- Preview-Edit-Toggle-After-Fullscreen
- TS-No-Fullscreen-Button
- JS-No-Fullscreen-Button
- Fullscreen-Backdrop
- X-Button-Position
- Markdown-Render-Fullscreen
- X-Button-Aria-Label
- Escape-Handler-Cleanup

### P2 Tests (Nice to Have)
- Rapid-Fullscreen-Toggle
- Large-Content-Fullscreen
- Multiple-Escape-Presses
- Click-Outside-Fullscreen
- Fullscreen-Z-Index

## Evidence Collection
- Screenshots: `.sisyphus/outputs/qa-screenshots/fullscreen-preview/`
- Console logs: `.sisyphus/outputs/qa-logs/fullscreen-preview-console.log`
- Test report: `.sisyphus/outputs/fullscreen-preview-qa-report.json`
