export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { dialectFor } from "./v2/dialect"
import { applyV2Response, planV2Request } from "./v2/routes"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & {
  directory?: string
  targetUrl?: string
  onResponseError?: (error: { status: number; message?: string; data?: unknown }) => void
}) {
  if (!config?.fetch) {
    // Provide a fetch-compatible implementation. Avoid assigning a strict
    // "typeof fetch" annotated value because the global fetch may carry
    // extra properties (preconnect, etc.) depending on runtime. Create a
    // plain function and coerce to the expected type when passing to the
    // generated client.
    const customFetch = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init)
      const headers = new Headers(request.headers)
      if (config?.targetUrl) {
        headers.set("x-opencode-target", config.targetUrl)
      }
      const next = new Request(request, { headers }) as Request & { timeout?: boolean }
      next.timeout = false
      const dialect = config?.baseUrl ? await dialectFor(config.baseUrl, config.targetUrl) : "v1"
      let response: Response
      try {
        const plan = dialect === "v2" ? await planV2Request(next) : ({ kind: "passthrough" as const })
        if (plan.kind === "local") {
          response = new Response(JSON.stringify(plan.payload), {
            status: plan.status,
            headers: { "Content-Type": "application/json" },
          })
        } else if (plan.kind === "rewrite") {
          const buildUpstream = (url: string, reqInit: RequestInit) => {
            const mergedHeaders: Record<string, string> = {}
            next.headers.forEach((value, key) => {
              mergedHeaders[key.toLowerCase()] = value
            })
            for (const [key, value] of Object.entries((reqInit.headers ?? {}) as Record<string, string>)) {
              mergedHeaders[key.toLowerCase()] = value
            }
            const upstream = new Request(new URL(url, next.url), { ...reqInit, headers: mergedHeaders }) as Request & { timeout?: boolean }
            upstream.timeout = false
            return upstream
          }
          if (plan.pre) {
            try {
              await fetch(buildUpstream(plan.pre.url, plan.pre.init))
            } catch (e) {
              console.error("[sdk] v2 pre-request failed:", plan.pre.url, e)
            }
          }
          response = await applyV2Response(plan, await fetch(buildUpstream(plan.url, plan.init)))
        } else {
          response = await fetch(next)
        }
      } catch (e) {
        console.error("[sdk] v2 request failed:", next.method, next.url, e)
        throw e
      }
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
    }
    // Coerce to the declared fetch type in the generated client. Use a two-step
    // cast via unknown to avoid `as any` while keeping type-safety at call
    // sites; this is safe because the function matches the runtime fetch
    // behaviour used by the client.
    config = {
      ...config,
      fetch: (customFetch as unknown) as typeof fetch,
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
