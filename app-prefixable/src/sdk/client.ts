export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & { directory?: string; targetUrl?: string }) {
  if (!config?.fetch) {
    const customFetch: typeof fetch = (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const headers = new Headers(request.headers)
      if (config?.targetUrl) {
        headers.set("x-opencode-target", config.targetUrl)
      }
      const next = new Request(request, { headers }) as Request & { timeout?: boolean }
      next.timeout = false
      return fetch(next)
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
