import { dialectFor } from "./dialect"
import { applyV2Response, planV2Request, type Send } from "./routes"

export async function dialectAwareFetch(
  url: string,
  baseUrl: string,
  targetUrl?: string,
  init?: RequestInit,
): Promise<Response> {
  const dialect = await dialectFor(baseUrl, targetUrl)
  const request = new Request(url, init)
  if (dialect !== "v2") return fetch(request)
  const plan = await planV2Request(request)
  if (plan.kind === "passthrough") return fetch(request)
  if (plan.kind === "local") {
    return new Response(JSON.stringify(plan.payload), {
      status: plan.status,
      headers: { "Content-Type": "application/json" },
    })
  }
  const send: Send = (u, reqInit = {}) => {
    const mergedHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      mergedHeaders[key.toLowerCase()] = value
    })
    for (const [key, value] of Object.entries((reqInit.headers ?? {}) as Record<string, string>)) {
      mergedHeaders[key.toLowerCase()] = value
    }
    if (plan.kind === "rewrite" && plan.stripDirectoryHeader) delete mergedHeaders["x-opencode-directory"]
    return fetch(new Request(new URL(u, request.url), { ...reqInit, headers: mergedHeaders }))
  }
  if (plan.kind === "custom") return plan.run(send)
  const upstreamInit: RequestInit = { ...plan.init }
  if (plan.stripDirectoryHeader) {
    const headers = new Headers(upstreamInit.headers)
    headers.delete("x-opencode-directory")
    upstreamInit.headers = headers
  }
  const upstream = new Request(new URL(plan.url, request.url), upstreamInit)
  return applyV2Response(plan, await fetch(upstream))
}
