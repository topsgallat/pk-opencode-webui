Timestamp: 2026-03-30
- Primary fix approach: strip Accept-Encoding from proxied requests and materialize upstream response bodies before returning them to avoid Bun re-compressing streamed responses.
- Added gzip magic check before gunzip; wrapped deflate/br in try/catch.
- Verified via curl that Content-Encoding is no longer present for JSON endpoints in many cases.
- Browser verification (Playwright) confirmed the fix works: no ERR_CONTENT_DECODING_FAILED errors were observed.
- The proxied endpoints (/session, /provider, /path, /mcp) load successfully with correct Content-Length and no Content-Encoding.
