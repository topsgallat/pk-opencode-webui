import { describe, expect, test } from "bun:test"
import { eventFromV2, isV2EventEnvelope, messageFromV2, messageListFromV2, sessionFromV2 } from "./translate"
import { planV2Request } from "./routes"

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
    const { info, parts } = messageFromV2(V2_ASSISTANT, "ses_1")
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
    const { info, parts } = messageFromV2(V2_USER, "ses_1")
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
    const { info, parts } = messageFromV2(inbox, "ses_1")
    expect(info.role).toBe("user")
    if (parts[0].type !== "text") throw new Error("expected text")
    expect(parts[0].text).toBe("hi")
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

  test("maps v1 prompt part body to v2 text body", async () => {
    const plan = await planV2Request(new Request("http://ui/session/ses_1/prompt_async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part: { type: "text", text: "hello" } }),
    }))
    if (plan.kind !== "rewrite") throw new Error("expected rewrite")
    expect(plan.url).toBe("/api/session/ses_1/prompt")
    const body = JSON.parse(String(plan.init.body))
    expect(body.text).toBe("hello")
  })

  test("instance dispose is served locally", async () => {
    const plan = await planV2Request(new Request("http://ui/instance/dispose", { method: "POST" }))
    expect(plan.kind).toBe("local")
  })

  test("unknown paths pass through untouched", async () => {
    const plan = await planV2Request(new Request("http://ui/auth/anthropic", { method: "PUT" }))
    expect(plan.kind).toBe("passthrough")
  })
})
