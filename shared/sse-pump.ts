// Re-pump a fetch response body through an explicit reader loop.
//
// Bun can buffer small chunks when a fetch response body is aliased directly
// into a new Response (observed with SSE proxies: tiny keepalive/heartbeat
// frames never reached the client while large bursts did, so idle browser
// connections were dropped and reconnected in a loop). Reading chunk-by-chunk
// and enqueueing into a fresh ReadableStream forces each chunk out as it
// arrives.
export function pumpResponseBody(
  response: Response,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const body = response.body
  if (!body) return new Response(null, { status: 502 })

  const reader = body.getReader()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) controller.enqueue(value)
          }
          controller.close()
        } catch {
          if (!closed) {
            try {
              controller.close()
            } catch {
              // consumer already gone
            }
          }
        }
      })()
    },
    cancel() {
      closed = true
      reader.cancel().catch(() => {})
    },
  })

  return new Response(stream, { status: init?.status ?? response.status, headers: init?.headers })
}
