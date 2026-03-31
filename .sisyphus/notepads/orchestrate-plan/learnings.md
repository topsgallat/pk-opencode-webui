Timestamp: 2026-03-30
- Primary fix approach: strip Accept-Encoding from proxied requests and materialize upstream response bodies before returning them to avoid Bun re-compressing streamed responses.
- Added gzip magic check before gunzip; wrapped deflate/br in try/catch.
- Verified via curl that Content-Encoding is no longer present for JSON endpoints in many cases.
- Browser verification (Playwright) confirmed the fix works: no ERR_CONTENT_DECODING_FAILED errors were observed.
- The proxied endpoints (/session, /provider, /path, /mcp) load successfully with correct Content-Length and no Content-Encoding.

Proxy strips Accept-Encoding and materializes upstream bodies; ensure Brotli/deflate fallbacks do not remove Content-Encoding when forwarding compressed bytes.
Static file serving builds filePath by concatenation; use path.resolve and prefix check to enforce DIST_DIR boundary.

- High-impact: proxy in docker/serve-ui.ts materializes upstream bodies, strips Accept-Encoding, and applies gzip magic guard; ensure Brotli/deflate fallbacks preserve Content-Encoding or fail explicitly.
- High-impact: static file serving concatenates DIST_DIR + path without path.resolve guard; add normalization and prefix-check to prevent traversal.

Verification note: Playwright verification completed successfully on 2026-03-30 — the SSE/API decoding test passed and no ERR_CONTENT_DECODING_FAILED was observed. Smoke curl checks confirm Content-Length is set for /provider, entry.js is served gzipped when requested, and hashed chunks return immutable cache headers.
Healthcheck switched from wget to curl -fsS -o /dev/null for ui-only compose
