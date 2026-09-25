import { dialectFor } from "./dialect"
import { applyV2Response, planV2Request } from "./routes"

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
  const upstream = new Request(new URL(plan.url, request.url), plan.init)
  return applyV2Response(plan, await fetch(upstream))
}
