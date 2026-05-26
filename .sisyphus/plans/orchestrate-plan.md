## TODOs

- [x] Browser verification: run automated Playwright test that loads the UI, triggers the SSE connection and key proxied API calls, and records whether the browser experiences ERR_CONTENT_DECODING_FAILED. (Primary implementation/verification task.)

- [x] Fix settings.tsx ReferenceError: ensure createSignal declarations used by the Global Custom Providers block are declared before the block so /settings loads without runtime errors (app-prefixable/src/pages/settings.tsx)

## Final Verification Wave

- [x] F1: Security review — APPROVE
- [x] F2: QA functional review — APPROVE
- [x] F3: Performance review — PASS
- [x] F4: UX/visual review — APPROVE
