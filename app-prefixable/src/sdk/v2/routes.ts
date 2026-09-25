import {
  eventFromV2,
  isV2EventEnvelope,
  messageFromV2,
  messageListFromV2,
  sessionFromV2,
} from "./translate"

type Dict = Record<string, unknown>

function dropDirectoryQuery(search: string): string {
  const params = new URLSearchParams(search)
  params.delete("directory")
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

function jsonInit(method: string, url: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json()
  } catch {
    return undefined
  }
}

function unwrapData(payload: unknown): unknown {
  return payload && typeof payload === "object" && "data" in (payload as Dict)
    ? (payload as Dict).data
    : payload
}

function promptBodyFromV1(body: unknown, sessionID: string): RouteToResult {
  const raw = (body ?? {}) as Dict
  const parts = Array.isArray(raw.parts) ? raw.parts : []
  const legacy = (raw.part ?? {}) as Dict
  const texts: string[] = []
  const files: Array<{ uri: string; name?: string }> = []
  if (typeof legacy.text === "string") texts.push(legacy.text)
  for (const item of parts) {
    const p = (item ?? {}) as Dict
    if (p.type === "text" && typeof p.text === "string") texts.push(p.text)
    if (p.type === "file" && typeof p.url === "string") {
      files.push({ uri: p.url, name: typeof p.filename === "string" ? p.filename : undefined })
    }
  }
  const prompt: Dict = { text: texts.join("\n\n"), files }
  let pre: RouteToResult["pre"]
  const model = (raw.model ?? {}) as Dict
  if (typeof model.providerID === "string" && typeof model.modelID === "string" && model.modelID) {
    const ref: Dict = { providerID: model.providerID, id: model.modelID }
    if (typeof raw.variant === "string" && raw.variant) ref.variant = raw.variant
    pre = { url: api(`/session/${sessionID}/model`, ""), init: jsonInit("POST", "", { model: ref }) }
  }
  return {
    url: api(`/session/${sessionID}/prompt`, ""),
    init: jsonInit("POST", "", prompt),
    pre,
  }
}

function locationFromV2(payload: unknown): unknown {
  const raw = (payload ?? {}) as Dict
  const directory = typeof raw.directory === "string" ? raw.directory : ""
  return { cwd: directory, root: directory }
}

function messagesFromV2Response(payload: unknown, url: URL): unknown {
  const segments = url.pathname.split("/").filter(Boolean)
  const sessionID = segments.length >= 2 ? segments[segments.length - 2] : (segments[0] ?? "")
  return messageListFromV2(unwrapData(payload), sessionID)
}

function promptResponseFromV1(payload: unknown, url: URL): unknown {
  const segments = url.pathname.split("/").filter(Boolean)
  const sessionID = segments.length >= 2 ? segments[segments.length - 2] : (segments[0] ?? "")
  const item = messageFromV2(unwrapData(payload), sessionID)
  return { info: item.info, parts: item.parts }
}

type RouteToResult = {
  url: string
  init: RequestInit
  pre?: { url: string; init: RequestInit }
}

type RouteDef = {
  method: string
  pattern: RegExp
  to: (args: { params: string[]; url: URL; body: unknown }) => RouteToResult
  from?: (payload: unknown, input: { url: URL }) => unknown
  respond?: (input: { url: URL; body: unknown }) => { status: number; payload: unknown }
}

const api = (path: string, query: string) => `/api${path}${dropDirectoryQuery(query)}`

const ROUTES: RouteDef[] = [
  {
    method: "GET",
    pattern: /^\/session\/status$/,
    to: ({ url }) => ({ url: api("/session/active", url.search), init: { method: "GET" } }),
  },
  {
    method: "GET",
    pattern: /^\/session$/,
    to: ({ url }) => ({ url: api("/session", url.search), init: { method: "GET" } }),
    from: (payload) => {
      const data = unwrapData(payload)
      return Array.isArray(data) ? data.map(sessionFromV2) : []
    },
  },
  {
    method: "POST",
    pattern: /^\/session$/,
    to: ({ body }) => {
      const raw = (body ?? {}) as Dict
      const out: Dict = {}
      if (typeof raw.parentID === "string") out.parentID = raw.parentID
      if (typeof raw.title === "string") out.title = raw.title
      return { url: "/api/session", init: jsonInit("POST", "", out) }
    },
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/message$/,
    to: ({ url, params }) => ({ url: api(`/session/${params[0]}/message`, url.search), init: { method: "GET" } }),
    from: (payload, { url }) => messagesFromV2Response(payload, url),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/prompt_async$/,
    to: ({ params, body }) => promptBodyFromV1(body, params[0]),
    from: (payload, { url }) => promptResponseFromV1(payload, url),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/prompt$/,
    to: ({ params, body }) => promptBodyFromV1(body, params[0]),
    from: (payload, { url }) => promptResponseFromV1(payload, url),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/abort$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}/interrupt`, ""), init: jsonInit("POST", "", {}) }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/summarize$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/compact`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/command$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/command`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/unrevert$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}/revert`, ""), init: { method: "DELETE" } }),
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/revert$/,
    to: ({ params, body }) => ({
      url: api(`/session/${params[0]}/revert/commit`, ""),
      init: jsonInit("POST", "", body ?? {}),
    }),
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/diff$/,
    to: ({ url, params }) => ({ url: api(`/session/${params[0]}/diff`, url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}`, ""), init: { method: "GET" } }),
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "PATCH",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params, body }) => {
      const raw = (body ?? {}) as Dict
      const out: Dict = {}
      if (typeof raw.title === "string") out.title = raw.title
      return { url: api(`/session/${params[0]}`, ""), init: jsonInit("PATCH", "", out) }
    },
    from: (payload) => sessionFromV2(unwrapData(payload)),
  },
  {
    method: "DELETE",
    pattern: /^\/session\/([^/]+)$/,
    to: ({ params }) => ({ url: api(`/session/${params[0]}`, ""), init: { method: "DELETE" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/config$/,
    to: ({ url }) => ({ url: api("/config", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/path$/,
    to: ({ url }) => ({ url: api("/location", url.search), init: { method: "GET" } }),
    from: locationFromV2,
  },
  {
    method: "GET",
    pattern: /^\/agent$/,
    to: ({ url }) => ({ url: api("/agent", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/skill$/,
    to: ({ url }) => ({ url: api("/skill", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/file\/content$/,
    to: ({ url }) => {
      const path = url.searchParams.get("path") ?? ""
      return { url: `/api/fs/read${path}?${dropDirectoryQuery(url.search)}`, init: { method: "GET" } }
    },
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/file$/,
    to: ({ url }) => ({ url: api("/fs/list", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/find\/file$/,
    to: ({ url }) => {
      const params = new URLSearchParams(url.search)
      params.delete("directory")
      const pattern = params.get("pattern") ?? ""
      params.delete("pattern")
      params.set("query", pattern)
      return { url: `/api/fs/find?${params.toString()}`, init: { method: "GET" } }
    },
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/vcs$/,
    to: ({ url }) => ({ url: api("/vcs", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/vcs\/diff$/,
    to: ({ url }) => ({ url: api("/vcs/diff", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "GET",
    pattern: /^\/pty$/,
    to: ({ url }) => ({ url: api("/pty", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "POST",
    pattern: /^\/pty$/,
    to: ({ url, body }) => ({ url: api("/pty", url.search), init: jsonInit("POST", "", body ?? {}) }),
    from: unwrapData,
  },
  {
    method: "DELETE",
    pattern: /^\/pty\/([^/]+)$/,
    to: ({ params }) => ({ url: api(`/pty/${params[0]}`, ""), init: { method: "DELETE" } }),
  },
  {
    method: "GET",
    pattern: /^\/pty\/([^/]+)\/connect$/,
    to: ({ url, params }) => ({ url: api(`/pty/${params[0]}/connect`, url.search), init: { method: "GET" } }),
  },
  {
    method: "GET",
    pattern: /^\/mcp$/,
    to: ({ url }) => ({ url: api("/mcp", url.search), init: { method: "GET" } }),
    from: unwrapData,
  },
  {
    method: "POST",
    pattern: /^\/mcp\/([^/]+)\/(connect|disconnect)$/,
    to: ({ params }) => ({
      url: api(`/experimental/mcp/${params[0]}/${params[1]}`, ""),
      init: jsonInit("POST", "", {}),
    }),
  },
  {
    method: "POST",
    pattern: /^\/instance\/dispose$/,
    respond: () => ({ status: 200, payload: { ok: true } }),
    to: () => ({ url: "", init: {} }),
  },
]

function matchRoute(method: string, pathname: string): { def: RouteDef; params: string[] } | undefined {
  for (const def of ROUTES) {
    if (def.method !== method) continue
    const match = def.pattern.exec(pathname)
    if (match) return { def, params: match.slice(1) }
  }
  return undefined
}

export type V2RequestResult =
  | { kind: "passthrough" }
  | { kind: "local"; status: number; payload: unknown }
  | {
      kind: "rewrite"
      url: string
      init: RequestInit
      pre?: { url: string; init: RequestInit }
      from?: RouteDef["from"]
      input: { url: URL }
    }

export async function planV2Request(request: Request): Promise<V2RequestResult> {
  const url = new URL(request.url)
  const match = matchRoute(request.method, url.pathname)
  if (!match) return { kind: "passthrough" }
  const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await parseBody(request) : undefined
  const input = { url, body }
  if (match.def.respond) {
    const local = match.def.respond(input)
    return { kind: "local", status: local.status, payload: local.payload }
  }
  const target = match.def.to({ params: match.params, url, body })
  return {
    kind: "rewrite",
    url: target.url,
    init: { ...target.init, headers: { ...(target.init.headers ?? {}) } },
    pre: target.pre,
    from: match.def.from,
    input: { url },
  }
}

export async function applyV2Response(plan: V2RequestResult, response: Response): Promise<Response> {
  if (plan.kind !== "rewrite" || !plan.from || !response.ok) return response
  const payload = await response.clone().json().catch(() => undefined)
  if (payload === undefined) return response
  const mapped = plan.from(payload, plan.input)
  return new Response(JSON.stringify(mapped), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
