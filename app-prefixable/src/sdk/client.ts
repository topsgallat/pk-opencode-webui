export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & {
  directory?: string
  targetUrl?: string
  onResponseError?: (error: { status: number; message?: string; data?: unknown }) => void
}) {
  if (!config?.fetch) {
    const customFetch: typeof fetch = (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const headers = new Headers(request.headers)
      if (config?.targetUrl) {
        headers.set("x-opencode-target", config.targetUrl)
      }
      const next = new Request(request, { headers }) as Request & { timeout?: boolean }
      next.timeout = false
      return fetch(next).then(async (response) => {
        if (!response.ok && config?.onResponseError) {
          const text = await response.clone().text().catch(() => "")
          let data: unknown
          try {
            data = text ? JSON.parse(text) : undefined
          } catch {
            data = text || undefined
          }
          const message = typeof data === "string"
            ? data
            : typeof data === "object" && data && "message" in data && typeof (data as { message?: unknown }).message === "string"
              ? (data as { message: string }).message
              : response.statusText || undefined
          config.onResponseError({
            status: response.status,
            message,
            data,
          })
        }
        return response
      })
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
