/**
 * V2 → V1 translation: raw JSON in, V1-shaped JSON out.
 * Keeps the generated V1 SDK and the whole UI working against V2 servers.
 */

import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  ReasoningPart,
  Session,
  SessionStatus,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "../gen/types.gen.js"

type Dict = Record<string, unknown>

type V2Ref = { id?: string; providerID?: string }

type V2Time = { created?: number; updated?: number; streamed?: number; completed?: number; idle?: number }

type V2SessionRaw = {
  id?: string
  title?: string
  projectID?: string
  parentID?: string
  slug?: string
  version?: string
  location?: { directory?: string }
  time?: V2Time
  agent?: string
  model?: V2Ref
  cost?: number
}

type V2FileRaw = { url?: string; mime?: string; filename?: string; type?: string }

type V2ToolStateRaw = {
  status?: string
  input?: Dict | string
  metadata?: Dict
  error?: { message?: string } | string
  content?: Array<{ type?: string; text?: string }>
}

type V2ContentRaw = {
  type?: string
  text?: string
  id?: string
  name?: string
  ordinal?: number
  time?: { created?: number; ran?: number; completed?: number }
  state?: V2ToolStateRaw
}

type V2MessageRaw = {
  id?: string
  type?: string
  sessionID?: string
  time?: V2Time
  text?: string
  files?: V2FileRaw[]
  agent?: string
  model?: V2Ref
  cost?: number
  finish?: string
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  content?: V2ContentRaw[]
  payload?: { text?: string; files?: V2FileRaw[] }
}

type V2EventRaw = {
  id?: string
  type?: string
  created?: number
  data?: Dict
}

const VERSION_FALLBACK = "2.0.0"

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback
}

function toolOutputText(content?: Array<{ type?: string; text?: string }>): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter((chunk) => chunk?.type === "text" && typeof chunk.text === "string")
    .map((chunk) => chunk.text)
    .join("\n")
}

export function sessionFromV2(raw: unknown): Session {
  const s = dict(raw)
  const time = dict(s.time)
  const created = num(time.created)
  return {
    id: str(s.id),
    slug: str(s.slug) || str(s.id),
    projectID: str(s.projectID),
    directory: str(dict(s.location).directory),
    parentID: typeof s.parentID === "string" ? s.parentID : undefined,
    title: str(s.title) || "New Session",
    version: str(s.version) || VERSION_FALLBACK,
    time: {
      created,
      updated: num(time.updated, created),
    },
  }
}

function userMessageFromV2(raw: V2MessageRaw, sessionID: string): { info: UserMessage; parts: Part[] } {
  const created = num(raw.time?.created)
  const text = raw.text ?? raw.payload?.text ?? ""
  const files = raw.files ?? raw.payload?.files ?? []
  const messageID = str(raw.id)
  const parts: Part[] = [
    {
      id: `${messageID}-text`,
      sessionID,
      messageID,
      type: "text",
      text,
      time: { start: created },
    },
    ...files.map((file, index): Part => ({
      id: `${messageID}-file-${index}`,
      sessionID,
      messageID,
      type: "file",
      mime: str(file.mime) || "application/octet-stream",
      filename: typeof file.filename === "string" ? file.filename : undefined,
      url: str(file.url),
    })),
  ]
  const info: UserMessage = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created },
    agent: str(raw.agent) || "build",
    model: { providerID: str(raw.model?.providerID), modelID: str(raw.model?.id) },
  }
  return { info, parts }
}

function toolStateFromV2(content: V2ContentRaw, created: number): ToolState {
  const state = content.state ?? {}
  const status = str(state.status)
  const input = dict(state.input)
  const metadata = dict(state.metadata)
  const end = num(content.time?.completed, num(content.time?.ran, created))
  if (status === "streaming") {
    return { status: "pending", input: {}, raw: typeof state.input === "string" ? state.input : "" }
  }
  if (status === "error") {
    return {
      status: "error",
      input,
      error: typeof state.error === "string" ? state.error : str(dict(state.error).message) || "tool error",
      metadata,
      time: { start: created, end },
    }
  }
  if (status === "completed") {
    return {
      status: "completed",
      input,
      output: toolOutputText(state.content),
      title: str(metadata.title),
      metadata,
      time: { start: created, end },
    }
  }
  return { status: "running", input, metadata, time: { start: created } }
}

function assistantMessageFromV2(raw: V2MessageRaw, sessionID: string): { info: AssistantMessage; parts: Part[] } {
  const messageID = str(raw.id)
  const created = num(raw.time?.created)
  const completed = raw.time?.completed
  const parts: Part[] = (raw.content ?? []).map((chunk, index): Part => {
    const kind = str(chunk.type)
    const time = chunk.time ?? {}
    const start = num(time.created, created)
    if (kind === "reasoning") {
      const part: ReasoningPart = {
        id: `${messageID}-reasoning-${index}`,
        sessionID,
        messageID,
        type: "reasoning",
        text: str(chunk.text),
        time: { start, end: typeof time.completed === "number" ? time.completed : undefined },
      }
      return part
    }
    if (kind === "tool") {
      const part: ToolPart = {
        id: str(chunk.id) || `${messageID}-tool-${index}`,
        sessionID,
        messageID,
        type: "tool",
        callID: str(chunk.id) || `${messageID}-tool-${index}`,
        tool: str(chunk.name),
        state: toolStateFromV2(chunk, start),
      }
      return part
    }
    const part: TextPart = {
      id: `${messageID}-text-${index}`,
      sessionID,
      messageID,
      type: "text",
      text: str(chunk.text),
      time: { start, end: typeof time.completed === "number" ? time.completed : undefined },
    }
    return part
  })
  const info: AssistantMessage = {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created, completed: typeof completed === "number" ? completed : undefined },
    parentID: "",
    modelID: str(raw.model?.id),
    providerID: str(raw.model?.providerID),
    mode: str(raw.agent) || "build",
    agent: str(raw.agent) || "build",
    path: { cwd: "", root: "" },
    cost: num(raw.cost),
    tokens: {
      input: num(raw.tokens?.input),
      output: num(raw.tokens?.output),
      reasoning: num(raw.tokens?.reasoning),
      cache: { read: num(raw.tokens?.cache?.read), write: num(raw.tokens?.cache?.write) },
    },
    finish: typeof raw.finish === "string" ? raw.finish : undefined,
  }
  return { info, parts }
}

export function messageFromV2(raw: unknown, sessionID: string): { info: Message; parts: Part[] } | undefined {
  const m = raw as V2MessageRaw
  // V2 sessions interleave timeline entries (agent-switched, model-switched,
  // system, shell, compaction) that have no V1 counterpart — skip them.
  const kind = str(m.type)
  if (kind !== "assistant" && kind !== "user") return undefined
  return kind === "assistant"
    ? assistantMessageFromV2(m, sessionID)
    : userMessageFromV2(m, sessionID)
}

/** V2 messages come newest-first; V1 lists are chronological. */
export function messageListFromV2(payload: unknown, sessionID: string): Array<{ info: Message; parts: Part[] }> {
  const list = Array.isArray(payload) ? payload : []
  return list
    .map((raw) => messageFromV2(raw, sessionID))
    .filter((item): item is { info: Message; parts: Part[] } => !!item)
    .reverse()
}

export function isV2EventEnvelope(value: unknown): value is V2EventRaw {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const raw = value as Dict
  return typeof raw.type === "string" && "data" in raw && (typeof raw.id === "string" || raw.id === undefined)
}

function syntheticSession(raw: Dict, created: number): Session {
  return sessionFromV2({
    id: raw.sessionID ?? raw.id,
    title: raw.title,
    projectID: raw.projectID,
    location: raw.location,
    time: { created, updated: created },
  })
}

function statusEvent(sessionID: string, status: SessionStatus): Event {
  return { type: "session.status", properties: { sessionID, status } } as Event
}

function partUpdatedEvent(part: Part): Event {
  return { type: "message.part.updated", properties: { part } } as Event
}

function messageUpdatedEvent(info: Message): Event {
  return { type: "message.updated", properties: { info } } as Event
}

function messageCreatedEvent(info: Message, parts: Part[]): Event {
  // message.updated with parts: the sync store inserts unknown messages with
  // their parts, so this doubles as a create for freshly admitted prompts.
  return { type: "message.updated", properties: { info, parts } } as Event
}

function deltaEvent(sessionID: string, messageID: string, partID: string, field: string, delta: string): Event {
  return {
    type: "message.part.delta",
    properties: { sessionID, messageID, partID, field, delta },
  } as Event
}

// V2 tool events carry the input only on `called`; remember it so later
// success/failed updates can rebuild the full V1 tool state.
const toolInputs = new Map<string, { tool: string; input: Dict }>()

function rememberToolInput(callID: string, tool: string, input: Dict): void {
  if (toolInputs.size > 200 && !toolInputs.has(callID)) {
    const oldest = toolInputs.keys().next().value
    if (typeof oldest === "string") toolInputs.delete(oldest)
  }
  toolInputs.set(callID, { tool, input })
}

function toolPartEvent(sessionID: string, messageID: string, callID: string, tool: string, state: ToolState): Event {
  return partUpdatedEvent({
    id: callID,
    sessionID,
    messageID,
    type: "tool",
    callID,
    tool,
    state,
  })
}

function promotedUserMessage(sessionID: string, messageID: string, text: string, files: V2FileRaw[], created: number): Event {
  const { info, parts } = userMessageFromV2(
    { id: messageID, time: { created }, text, files },
    sessionID,
  )
  return messageCreatedEvent(info, parts)
}

function contentPartID(messageID: string, ordinal: unknown): string {
  return `${messageID}-c${typeof ordinal === "number" ? ordinal : 0}`
}

export function eventFromV2(raw: V2EventRaw): Event | undefined {
  // Newer V2 builds (npm dev/beta line) prefix events with "session.next." —
  // normalize so both generations dispatch through the same handlers.
  const type = str(raw.type).replace(/^session\.next\./, "session.")
  const data = dict(raw.data)
  const created = num(raw.created, num(data.timestamp))
  const sessionID = str(data.sessionID)
  const messageID = str(data.assistantMessageID) || str(data.inboxID)

  if (type === "server.connected") return { type, properties: {} } as Event
  if (type === "session.created") {
    return { type, properties: { info: syntheticSession(data, created) } } as Event
  }
  if (type === "session.deleted") {
    return { type: "session.deleted", properties: { info: syntheticSession({ id: sessionID }, created) } } as Event
  }
  if (type === "session.usage.updated") {
    return {
      type: "session.updated",
      properties: {
        info: {
          ...syntheticSession(data, created),
          cost: num(data.cost),
        },
      },
    } as Event
  }
  if (type === "session.execution.started") return statusEvent(sessionID, { type: "busy" })
  if (type === "session.execution.succeeded" || type === "session.execution.interrupted") {
    return statusEvent(sessionID, { type: "idle" })
  }
  if (type === "session.execution.failed" || type === "session.step.failed") {
    return { type: "session.error", properties: { sessionID, error: data.error } } as Event
  }
  // User prompt echo: promoted carries the full input, the dev-line
  // prompt.admitted/prompted carry messageID + prompt text.
  if (type === "session.input.promoted") {
    const input = dict(data.input)
    if (str(input.type) !== "user") return undefined
    const payload = dict(input.data)
    return promotedUserMessage(sessionID, str(data.inputID), str(payload.text), (payload.files ?? []) as V2FileRaw[], created)
  }
  if (type === "session.prompt.admitted" || type === "session.prompted") {
    return promotedUserMessage(sessionID, str(data.messageID), str(dict(data.prompt).text), [], created)
  }
  if (type === "session.text.delta" || type === "session.reasoning.delta") {
    return deltaEvent(sessionID, messageID, contentPartID(messageID, data.ordinal), "text", str(data.delta))
  }
  if (type === "session.text.started") {
    return partUpdatedEvent({
      id: contentPartID(messageID, data.ordinal),
      sessionID,
      messageID,
      type: "text",
      text: "",
      time: { start: created },
    })
  }
  if (type === "session.text.ended") {
    return partUpdatedEvent({
      id: contentPartID(messageID, data.ordinal),
      sessionID,
      messageID,
      type: "text",
      text: str(data.text),
      time: { start: created, end: created },
    })
  }
  if (type === "session.reasoning.started") {
    return partUpdatedEvent({
      id: contentPartID(messageID, data.ordinal),
      sessionID,
      messageID,
      type: "reasoning",
      text: "",
      time: { start: created },
    })
  }
  if (type === "session.reasoning.ended") {
    return partUpdatedEvent({
      id: contentPartID(messageID, data.ordinal),
      sessionID,
      messageID,
      type: "reasoning",
      text: str(data.text),
      time: { start: created, end: created },
    })
  }
  if (type === "session.tool.input.started") {
    const callID = str(data.callID)
    return toolPartEvent(sessionID, messageID, callID, str(data.name), {
      status: "pending",
      input: {},
      raw: "",
    })
  }
  if (type === "session.tool.input.delta") {
    return deltaEvent(sessionID, messageID, str(data.callID), "raw", str(data.delta))
  }
  if (type === "session.tool.input.ended") {
    const callID = str(data.callID)
    const known = toolInputs.get(callID)
    return toolPartEvent(sessionID, messageID, callID, str(known?.tool), {
      status: "pending",
      input: {},
      raw: str(data.text),
    })
  }
  if (type === "session.tool.called") {
    const callID = str(data.callID)
    const tool = str(data.tool) || str(data.name)
    const input = dict(data.input)
    rememberToolInput(callID, tool, input)
    return toolPartEvent(sessionID, messageID, callID, tool, {
      status: "running",
      input,
      metadata: {},
      time: { start: created },
    })
  }
  if (type === "session.tool.progress") {
    const callID = str(data.callID)
    const known = toolInputs.get(callID)
    return toolPartEvent(sessionID, messageID, callID, str(known?.tool), {
      status: "running",
      input: known?.input ?? {},
      metadata: dict(data.metadata),
      time: { start: created },
    })
  }
  if (type === "session.tool.success") {
    const callID = str(data.callID)
    const known = toolInputs.get(callID)
    toolInputs.delete(callID)
    const metadata = dict(data.metadata)
    if (data.structured !== undefined) metadata.structured = data.structured
    return toolPartEvent(sessionID, messageID, callID, str(known?.tool), {
      status: "completed",
      input: known?.input ?? {},
      output: toolOutputText((data.content ?? []) as Array<{ type?: string; text?: string }>),
      title: str(metadata.title),
      metadata,
      time: { start: created, end: created },
    })
  }
  if (type === "session.tool.failed") {
    const callID = str(data.callID)
    const known = toolInputs.get(callID)
    toolInputs.delete(callID)
    const metadata = dict(data.metadata)
    if (data.structured !== undefined) metadata.structured = data.structured
    return toolPartEvent(sessionID, messageID, callID, str(known?.tool), {
      status: "error",
      input: known?.input ?? {},
      error: str(dict(data.error).message) || "tool error",
      metadata,
      time: { start: created, end: created },
    })
  }
  if (type === "session.step.started") {
    return messageUpdatedEvent({
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: num(data.started, created) },
      parentID: "",
      modelID: str(dict(data.model).id),
      providerID: str(dict(data.model).providerID),
      mode: str(data.agent) || "build",
      agent: str(data.agent) || "build",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  }
  if (type === "session.step.ended") {
    return messageUpdatedEvent({
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created, completed: created },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "build",
      agent: "build",
      path: { cwd: "", root: "" },
      cost: num(data.cost),
      tokens: {
        input: num(dict(data.tokens).input),
        output: num(dict(data.tokens).output),
        reasoning: num(dict(data.tokens).reasoning),
        cache: {
          read: num(dict(dict(data.tokens).cache).read),
          write: num(dict(dict(data.tokens).cache).write),
        },
      },
      finish: str(data.finish) || undefined,
    })
  }
  return undefined
}
