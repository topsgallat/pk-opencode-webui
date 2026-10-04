import { describe, expect, test } from "bun:test"
import { eventFromV2, isV2EventEnvelope, messageFromV2, messageListFromV2, sessionFromV2 } from "./translate"
import { applyV2Response, planV2Request } from "./routes"

const V2_SESSION = {
  id: "ses_f2b7fe64bffe0ltIeXOxYQLLhY",
  projectID: "80a7002c2cedc213fa96b16859ce938d6e7acf88",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1790271560121, updated: 1790271560121 },
  title: "pkui-dialect-probe",
  location: { directory: "/home/sgallat" },
}

const V2_ASSISTANT = {
  id: "msg_0d481596f001SCnVcQD8e3NVbm",
  time: { created: 1790271641981, streamed: 1790271644020, completed: 1790271644022 },
  type: "assistant",
  agent: "build",
  model: { id: "space-bunny-free", providerID: "opencode" },
  content: [
    {
      type: "reasoning",
      text: "We need answer exactly \"ok\". Need no tool.",
      state: { reasoningField: "reasoning_content" },
      time: { created: 1790271643900, completed: 1790271644016 },
    },
    { type: "text", text: "ok" },
  ],
  finish: "stop",
  rawFinish: "stop",
  cost: 0,
  tokens: { input: 5995, output: 1, reasoning: 13, cache: { read: 477, write: 0 } },
}

const V2_USER = {
  id: "msg_0d4815951001eyyBr9R7zjFwfn",
  time: { created: 1790271641961 },
  text: "reply with exactly: ok",
  type: "user",
}

describe("sessionFromV2", () => {
  test("maps captured v2 session to v1 shape", () => {
    const s = sessionFromV2(V2_SESSION)
    expect(s.id).toBe(V2_SESSION.id)
    expect(s.directory).toBe("/home/sgallat")
    expect(s.title).toBe("pkui-dialect-probe")
    expect(s.time.created).toBe(1790271560121)
    expect(s.time.updated).toBe(1790271560121)
    expect(s.version).toBeTruthy()
  })

  test("fills defaults for missing fields", () => {
    const s = sessionFromV2({ id: "ses_x" })
    expect(s.title).toBe("New Session")
    expect(s.directory).toBe("")
    expect(s.version).toBeTruthy()
  })
})

describe("messageFromV2", () => {
  test("assistant message becomes info + ordered parts", () => {
    const item = messageFromV2(V2_ASSISTANT, "ses_1")
    if (!item) throw new Error("expected message")
    const { info, parts } = item
    if (info.role !== "assistant") throw new Error("expected assistant")
    expect(info.modelID).toBe("space-bunny-free")
    expect(info.providerID).toBe("opencode")
    expect(info.time.completed).toBe(1790271644022)
    expect(info.tokens.output).toBe(1)
    expect(parts.map((p) => p.type)).toEqual(["reasoning", "text"])
    const text = parts[1]
    if (text.type !== "text") throw new Error("expected text part")
    expect(text.text).toBe("ok")
  })

  test("user message gets a synthetic text part", () => {
    const item = messageFromV2(V2_USER, "ses_1")
    if (!item) throw new Error("expected message")
    const { info, parts } = item
    if (info.role !== "user") throw new Error("expected user")
    expect(parts[0].type).toBe("text")
    if (parts[0].type !== "text") throw new Error("expected text")
    expect(parts[0].text).toBe("reply with exactly: ok")
  })

  test("inbox user payload shape (prompt response) is handled", () => {
    const inbox = {
      id: "msg_x",
      sessionID: "ses_1",
      time: { created: 1 },
      type: "user",
      payload: { text: "hi", delivery: "steer" },
    }
    const item = messageFromV2(inbox, "ses_1")
    if (!item) throw new Error("expected message")
    expect(item.info.role).toBe("user")
    if (item.parts[0].type !== "text") throw new Error("expected text")
    expect(item.parts[0].text).toBe("hi")
  })

  test("timeline entries without a v1 counterpart are skipped", () => {
    expect(messageFromV2({ id: "msg_1", type: "model-switched", time: { created: 1 }, model: { id: "m", providerID: "p" } }, "ses_1")).toBeUndefined()
    expect(messageFromV2({ id: "msg_2", type: "agent-switched", time: { created: 1 }, agent: "plan" }, "ses_1")).toBeUndefined()
  })

  test("messageListFromV2 reverses newest-first to chronological", () => {
    const list = messageListFromV2([V2_ASSISTANT, V2_USER], "ses_1")
    expect(list[0].info.id).toBe(V2_USER.id)
    expect(list[1].info.id).toBe(V2_ASSISTANT.id)
  })
})

describe("eventFromV2", () => {
  test("detects v2 envelope", () => {
    expect(isV2EventEnvelope({ id: "evt_1", type: "server.connected", data: {} })).toBe(true)
    expect(isV2EventEnvelope({ type: "session.created", properties: { info: {} } })).toBe(false)
  })

  test("session.created maps to v1 info event", () => {
    const event = eventFromV2({
      id: "evt_1",
      created: 1790271641904,
      type: "session.created",
      data: { sessionID: "ses_9", title: "probe", location: { directory: "/home/x" } },
    })
    expect(event?.type).toBe("session.created")
    const props = (event as { properties: { info: { id: string } } }).properties
    expect(props.info.id).toBe("ses_9")
  })

  test("execution started/succeeded map to session.status busy/idle", () => {
    const busy = eventFromV2({ type: "session.execution.started", data: { sessionID: "ses_9" } })
    expect(busy?.type).toBe("session.status")
    const status = (busy as { properties: { status: { type: string } } }).properties.status
    expect(status.type).toBe("busy")

    const idle = eventFromV2({ type: "session.execution.succeeded", data: { sessionID: "ses_9" } })
    const idleStatus = (idle as { properties: { status: { type: string } } }).properties.status
    expect(idleStatus.type).toBe("idle")
  })

  test("text deltas map to message.part.delta with stable partID", () => {
    const started = eventFromV2({
      type: "session.text.started",
      created: 1,
      data: { sessionID: "ses_9", assistantMessageID: "msg_1", ordinal: 0 },
    })
    const delta = eventFromV2({
      type: "session.text.delta",
      data: { sessionID: "ses_9", assistantMessageID: "msg_1", ordinal: 0, delta: "ok" },
    })
    expect(delta?.type).toBe("message.part.delta")
    const props = (delta as { properties: { partID: string; delta: string } }).properties
    expect(props.delta).toBe("ok")
    const startedPart = (started as { properties: { part: { id: string } } }).properties.part
    expect(props.partID).toBe(startedPart.id)
  })

  test("step.ended carries cost/tokens into message.updated", () => {
    const event = eventFromV2({
      type: "session.step.ended",
      created: 1790271644022,
      data: {
        sessionID: "ses_9",
        assistantMessageID: "msg_1",
        finish: "stop",
        cost: 0,
        tokens: { input: 5995, output: 1, reasoning: 13, cache: { read: 477, write: 0 } },
      },
    })
    expect(event?.type).toBe("message.updated")
    const info = (event as { properties: { info: { tokens: { input: number } } } }).properties.info
    expect(info.tokens.input).toBe(5995)
  })

  test("unknown v2 events are dropped", () => {
    expect(eventFromV2({ type: "session.instructions.updated", data: {} })).toBeUndefined()
  })

  test("session.next.* prefix (dev-line builds) is normalized", () => {
    const delta = eventFromV2({
      type: "session.next.text.delta",
      data: { timestamp: 1791114479859, sessionID: "ses_9", assistantMessageID: "msg_1", ordinal: 0, delta: "hi" },
    })
    expect(delta?.type).toBe("message.part.delta")
    const props = (delta as { properties: { delta: string } }).properties
    expect(props.delta).toBe("hi")
  })

  test("step.failed maps to session.error", () => {
    const event = eventFromV2({
      type: "session.next.step.failed",
      data: { timestamp: 1, sessionID: "ses_9", assistantMessageID: "msg_1", error: { type: "unknown", message: "boom" } },
    })
    expect(event?.type).toBe("session.error")
  })

  test("prompt admitted maps to a user message echo", () => {
    const event = eventFromV2({
      type: "session.next.prompt.admitted",
      data: { timestamp: 1791114473019, sessionID: "ses_9", messageID: "msg_7", prompt: { text: "count to 3" }, delivery: "steer" },
    })
    expect(event?.type).toBe("message.updated")
    const props = (event as unknown as { properties: { info: { id: string; role: string }; parts: Array<{ type: string; text: string }> } }).properties
    expect(props.info.id).toBe("msg_7")
    expect(props.info.role).toBe("user")
    expect(props.parts[0].text).toBe("count to 3")
  })

  test("tool events map to v1 tool parts", () => {
    const started = eventFromV2({
      type: "session.next.tool.input.started",
      data: { timestamp: 1, sessionID: "ses_9", assistantMessageID: "msg_1", callID: "call_1", name: "bash" },
    })
    expect(started?.type).toBe("message.part.updated")
    const startedPart = (started as { properties: { part: { state: { status: string } } } }).properties.part
    expect(startedPart.state.status).toBe("pending")

    eventFromV2({
      type: "session.next.tool.called",
      data: { timestamp: 2, sessionID: "ses_9", assistantMessageID: "msg_1", callID: "call_1", tool: "bash", input: { command: "ls" } },
    })
    const done = eventFromV2({
      type: "session.next.tool.success",
      data: { timestamp: 3, sessionID: "ses_9", assistantMessageID: "msg_1", callID: "call_1", structured: { exit: 0 }, content: [{ type: "text", text: "out" }] },
    })
    expect(done?.type).toBe("message.part.updated")
    const part = (done as { properties: { part: { callID: string; state: { status: string; output: string; input: Record<string, string> } } } }).properties.part
    expect(part.callID).toBe("call_1")
    expect(part.state.status).toBe("completed")
    expect(part.state.output).toBe("out")
    // Input from the earlier `called` event is carried into the terminal state.
    expect(part.state.input.command).toBe("ls")
  })
})

describe("planV2Request", () => {
  test("rewrites session list", async () => {
    const plan = await planV2Request(new Request("http://ui/session?directory=/home/x"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/session")
  })

  test("rewrites abort to interrupt", async () => {
    const plan = await planV2Request(new Request("http://ui/session/ses_1/abort", { method: "POST" }))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/session/ses_1/interrupt")
  })

  test("maps v1 prompt part body to the v2 wrapped prompt body", async () => {
    const plan = await planV2Request(new Request("http://ui/session/ses_1/prompt_async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part: { type: "text", text: "hello" } }),
    }))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/session/ses_1/prompt")
    const body = JSON.parse(String(plan.init.body))
    expect(body.prompt.text).toBe("hello")
  })

  test("prompt response (admitted input) maps to a v1 user message", async () => {
    const plan = await planV2Request(new Request("http://ui/session/ses_1/prompt_async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part: { type: "text", text: "hello" } }),
    }))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      data: { admittedSeq: 3, id: "msg_9", sessionID: "ses_1", prompt: { text: "hello" }, delivery: "steer", timeCreated: 1234 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const body = await res.json()
    expect(body.info.role).toBe("user")
    expect(body.info.id).toBe("msg_9")
    expect(body.parts[0].text).toBe("hello")
  })

  test("session status maps the v2 active record to a v1 status map", async () => {
    const plan = await planV2Request(new Request("http://ui/session/status"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      data: { ses_1: { type: "running" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const map = await res.json()
    expect(map.ses_1.type).toBe("busy")
  })

  test("path maps the v2 location to a v1 path info with home", async () => {
    const plan = await planV2Request(new Request("http://ui/path"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      directory: "/home/opencode",
      project: { id: "p1", directory: "/home/opencode", canonical: "/home/opencode" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const info = await res.json()
    expect(info.home).toBe("/home/opencode")
    expect(info.cwd).toBe("/home/opencode")
    expect(info.root).toBe("/home/opencode")
  })

  test("file list maps relative v2 entries to absolute v1 nodes", async () => {
    const plan = await planV2Request(new Request("http://ui/file?path=.&directory=%2Fhome%2Fopencode"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      location: { directory: "/home/opencode" },
      data: [
        { path: "e2e-proj/", type: "directory" },
        { path: "notes.txt", type: "file" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const list = await res.json() as Array<{ path: string; type: string; absolute: string }>
    expect(list[0].absolute).toBe("/home/opencode/e2e-proj/")
    expect(list[0].type).toBe("directory")
    expect(list[1].absolute).toBe("/home/opencode/notes.txt")
  })

  test("instance dispose is served locally", async () => {
    const plan = await planV2Request(new Request("http://ui/instance/dispose", { method: "POST" }))
    expect(plan.kind).toBe("local")
  })

  test("clamps list limits to the V2 cap of 200", async () => {
    const messages = await planV2Request(new Request("http://ui/session/ses_1/message?limit=300&directory=/x"))
    if (messages.kind !== "rewrite") throw new Error("expected rewrite")
    expect(messages.url).toBe("/api/session/ses_1/message?limit=200")

    const list = await planV2Request(new Request("http://ui/session?roots=true&limit=500"))
    if (list.kind !== "rewrite") throw new Error("expected rewrite")
    expect(list.url).toBe("/api/session?limit=200")
  })

  test("session share returns an explicit V2 gap error", async () => {
    const plan = await planV2Request(new Request("http://ui/session/ses_1/share", { method: "POST" }))
    expect(plan.kind).toBe("local")
    if (plan.kind !== "local") throw new Error("expected local")
    expect(plan.status).toBe(400)
  })

  test("unknown paths pass through untouched", async () => {
    const plan = await planV2Request(new Request("http://ui/tui/submit-prompt", { method: "POST" }))
    expect(plan.kind).toBe("passthrough")
  })

  test("permission list maps V2 requests to V1 PermissionRequest", async () => {
    const plan = await planV2Request(new Request("http://ui/permission?directory=/home/x"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/permission/request")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      data: [{ id: "per_1", sessionID: "ses_1", action: "edit", resources: ["/tmp/a"], save: ["always"], metadata: {} }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const list = (await res.json()) as Array<{ id: string; permission: string; patterns: string[]; always: string[] }>
    expect(list[0].id).toBe("per_1")
    expect(list[0].permission).toBe("edit")
    expect(list[0].patterns).toEqual(["/tmp/a"])
    expect(list[0].always).toEqual(["always"])
  })

  test("question list maps V2 forms to V1 QuestionRequest", async () => {
    const plan = await planV2Request(new Request("http://ui/question"))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/form")
    const res = await applyV2Response(plan, new Response(JSON.stringify({
      data: [{ id: "frm_1", sessionID: "ses_1", title: "Pick one", fields: [{ type: "multiselect", key: "choice", options: [{ value: "a", label: "A" }] }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const list = (await res.json()) as Array<{ id: string; questions: Array<{ question: string; options: unknown[] }> }>
    expect(list[0].id).toBe("frm_1")
    expect(list[0].questions[0].question).toBe("Pick one")
    expect(list[0].questions[0].options.length).toBe(1)
  })
})
