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

export type Send = (url: string, init?: RequestInit) => Promise<Response>

type RouteDef = {
  method: string
  pattern: RegExp
  to: (args: { params: string[]; url: URL; body: unknown }) => RouteToResult
  from?: (payload: unknown, input: { url: URL }) => unknown
  respond?: (input: { url: URL; body: unknown }) => { status: number; payload: unknown }
  custom?: (args: { params: string[]; url: URL; body: unknown; send: Send }) => Promise<Response>
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })
}

function str2(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function dict2(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {}
}

async function jsonOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

async function providerListCustom({ send }: { send: Send }): Promise<Response> {
  const [provRes, modelRes, defRes] = await Promise.all([
    send("/api/provider"),
    send("/api/model"),
    send("/api/model/default").catch(() => undefined),
  ])
  if (!provRes.ok) return new Response(provRes.body, { status: provRes.status, headers: provRes.headers })
  const providers = (unwrapData(await jsonOf(provRes)) ?? []) as Dict[]
  const models = modelRes.ok ? ((unwrapData(await jsonOf(modelRes)) ?? []) as Dict[]) : []
  const def = defRes?.ok ? ((unwrapData(await jsonOf(defRes)) ?? {}) as Dict) : {}
  const all = providers.map((p) => {
    const pid = str2(p.id)
    const modelMap: Dict = {}
    for (const m of models) {
      if (str2(m.providerID) !== pid) continue
      const mid = str2(m.modelID) || str2(m.id)
      modelMap[`${pid}/${mid}`] = {
        ...m,
        id: `${pid}/${mid}`,
        providerID: pid,
        api: { id: `${pid}/${mid}`, url: str2(dict2(m.settings).baseURL), npm: str2(m.package) },
      }
    }
    return { id: pid, name: str2(p.name) || pid, source: "custom", env: [], options: {}, models: modelMap }
  })
  const body: Dict = { all, connected: [] }
  const defPid = str2(def.providerID)
  if (defPid) body.default = { [defPid]: str2(def.modelID) || str2(def.id) }
  return jsonResponse(body)
}

async function providerAuthCustom({ send }: { send: Send }): Promise<Response> {
  const res = await send("/api/integration")
  const list = res.ok ? ((unwrapData(await jsonOf(res)) ?? []) as Dict[]) : []
  const out: Dict = {}
  for (const item of list) {
    const methods = Array.isArray(item.methods) ? (item.methods as Dict[]) : []
    out[str2(item.id)] = methods.map((m) => ({ type: str2(m.type) === "key" ? "api" : str2(m.type) }))
  }
  return jsonResponse(out)
}

async function authSetCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const providerID = params[0] ?? ""
  const raw = dict2(body)
  const auth = raw.auth ? dict2(raw.auth) : raw
  const base = providerID.split(":")[0]
  const label = providerID.includes(":") ? providerID.split(":").slice(1).join(":") : undefined
  if (str2(auth.type) !== "api") {
    return jsonResponse({ error: "unsupported auth type for V2" }, 400)
  }
  const payload: Dict = { key: str2(auth.key) }
  if (label) payload.label = label
  return send(`/api/integration/${base}/connect/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function permissionFromV2List(payload: unknown): unknown {
  const list = unwrapData(payload)
  if (!Array.isArray(list)) return []
  return list.map((r) => {
    const p = dict2(r)
    return {
      id: str2(p.id),
      sessionID: str2(p.sessionID),
      permission: str2(p.action),
      patterns: Array.isArray(p.resources) ? p.resources : [],
      metadata: dict2(p.metadata),
      always: Array.isArray(p.save) ? p.save : [],
    }
  })
}

async function permissionReplyCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const sessionID = params[0] ?? ""
  const permissionID = params[1] ?? ""
  const response = str2(dict2(body).response) || "once"
  const listRes = await send(`/api/session/${sessionID}/permission`)
  const list = listRes.ok ? ((unwrapData(await jsonOf(listRes)) ?? []) as Dict[]) : []
  const entry = list.find((r) => str2(r.id) === permissionID)
  const payload: Dict = {
    id: permissionID,
    action: str2(entry?.action) || "reply",
    resources: Array.isArray(entry?.resources) ? entry.resources : [],
  }
  if (response === "always") payload.save = ["always"]
  if (response === "reject") payload.metadata = { rejected: true }
  return send(`/api/session/${sessionID}/permission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function questionFromV2List(payload: unknown): unknown {
  const list = unwrapData(payload)
  if (!Array.isArray(list)) return []
  return list.map((f) => {
    const form = dict2(f)
    const fields = Array.isArray(form.fields) ? (form.fields as Dict[]) : []
    const options = fields.flatMap((field) =>
      Array.isArray(field.options)
        ? (field.options as Dict[]).map((o) => ({ label: str2(o.label), description: str2(o.description) || undefined }))
        : [],
    )
    return {
      id: str2(form.id),
      sessionID: str2(form.sessionID),
      questions: [
        {
          question: str2(form.title),
          header: str2(form.title),
          options,
          multiple: fields.some((field) => field.type === "multiselect"),
        },
      ],
    }
  })
}

async function findForm(send: Send, requestID: string): Promise<Dict | undefined> {
  const res = await send("/api/form")
  const list = res.ok ? ((unwrapData(await jsonOf(res)) ?? []) as Dict[]) : []
  return list.find((f) => str2(f.id) === requestID)
}

async function questionReplyCustom({ params, body, send }: { params: string[]; body: unknown; send: Send }): Promise<Response> {
  const requestID = params[0] ?? ""
  const form = await findForm(send, requestID)
  if (!form) return jsonResponse({ error: "form not found" }, 404)
  const sessionID = str2(form.sessionID)
  const fields = Array.isArray(form.fields) ? (form.fields as Dict[]) : []
  const rawAnswers = Array.isArray(dict2(body).answers) ? (dict2(body).answers as unknown[][]) : []
  const answer: Dict = {}
  fields.forEach((field, i) => {
    answer[str2(field.key) || String(i)] = rawAnswers[i] ?? rawAnswers[0] ?? []
  })
  return send(`/api/session/${sessionID}/form/${requestID}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  })
}

async function questionRejectCustom({ params, send }: { params: string[]; send: Send }): Promise<Response> {
  const requestID = params[0] ?? ""
  const form = await findForm(send, requestID)
  if (!form) return jsonResponse({ error: "form not found" }, 404)
  await send(`/api/session/${str2(form.sessionID)}/form/${requestID}`, { method: "DELETE" })
  return jsonResponse(true)
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
    respond: () => ({ status: 200, payload: {} }),
    to: () => ({ url: "", init: {} }),
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
    from: (payload) => {
      const data = unwrapData(payload)
      if (!Array.isArray(data)) return data ?? {}
      return Object.fromEntries(data.map((entry) => [str2(dict2(entry).name), entry]))
    },
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
  {
    method: "GET",
    pattern: /^\/provider$/,
    custom: providerListCustom,
    to: () => ({ url: "/api/provider", init: { method: "GET" } }),
  },
  {
    method: "GET",
    pattern: /^\/provider\/auth$/,
    custom: ({ send }) => providerAuthCustom({ send }),
    to: () => ({ url: "/api/integration", init: { method: "GET" } }),
  },
  {
    method: "PUT",
    pattern: /^\/auth\/(.+)$/,
    custom: ({ params, body, send }) => authSetCustom({ params, body, send }),
    to: ({ params }) => ({ url: `/api/credential/${params[0]}`, init: { method: "PATCH" } }),
  },
  {
    method: "DELETE",
    pattern: /^\/auth\/(.+)$/,
    to: ({ params }) => ({ url: `/api/credential/${params[0]}`, init: { method: "DELETE" } }),
    from: () => true,
  },
  {
    method: "GET",
    pattern: /^\/permission$/,
    to: ({ url }) => ({ url: api("/permission/request", url.search), init: { method: "GET" } }),
    from: permissionFromV2List,
  },
  {
    method: "POST",
    pattern: /^\/session\/([^/]+)\/permissions\/([^/]+)$/,
    custom: ({ params, body, send }) => permissionReplyCustom({ params, body, send }),
    to: ({ params }) => ({
      url: api(`/session/${params[0]}/permission`, ""),
      init: jsonInit("POST", "", { id: params[1] }),
    }),
  },
  {
    method: "GET",
    pattern: /^\/question$/,
    to: ({ url }) => ({ url: api("/form", url.search), init: { method: "GET" } }),
    from: questionFromV2List,
  },
  {
    method: "POST",
    pattern: /^\/question\/([^/]+)\/reply$/,
    custom: ({ params, body, send }) => questionReplyCustom({ params, body, send }),
    to: ({ params }) => ({ url: api(`/form/${params[0]}`, ""), init: jsonInit("POST", "", {}) }),
  },
  {
    method: "POST",
    pattern: /^\/question\/([^/]+)\/reject$/,
    custom: ({ params, send }) => questionRejectCustom({ params, send }),
    to: ({ params }) => ({ url: api(`/form/${params[0]}`, ""), init: { method: "DELETE" } }),
  },
  {
    method: "POST",
    pattern: /^\/config$/,
    to: ({ body }) => ({
      url: "/api/experimental/config",
      init: jsonInit("PATCH", "", { shell: dict2(dict2(body).config).shell ?? null }),
    }),
  },
  {
    method: "POST",
    pattern: /^\/mcp$/,
    to: ({ body }) => {
      const raw = dict2(body)
      return { url: `/api/experimental/mcp/${str2(raw.name)}`, init: jsonInit("PUT", "", raw.config ?? {}) }
    },
    from: () => true,
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
  | { kind: "custom"; run: (send: Send) => Promise<Response> }
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
  if (match.def.custom) {
    const def = match.def
    const params = match.params
    return { kind: "custom", run: (send) => def.custom!({ params, url, body, send }) }
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
