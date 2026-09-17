import { describe, expect, test } from "bun:test"
import type { DisplayMessage } from "../types/message"
import { hasVisibleContent } from "./message-visibility"

function message(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: "msg_1",
    role: "assistant",
    parts: [],
    ...overrides,
  }
}

describe("hasVisibleContent", () => {
  test("user messages are always visible", () => {
    expect(hasVisibleContent(message({ role: "user", parts: [] }))).toBe(true)
    expect(hasVisibleContent(message({ role: "user", parts: [{ id: "p", sessionID: "s", messageID: "m", type: "text", text: "hi" }] }))).toBe(true)
  })

  test("assistant messages without content are hidden", () => {
    expect(hasVisibleContent(message({ parts: [] }))).toBe(false)
  })

  test("synthetic-only text does not count as visible content", () => {
    expect(hasVisibleContent(message({
      parts: [{ id: "p", sessionID: "s", messageID: "m", type: "text", text: "placeholder", synthetic: true }],
    }))).toBe(false)
  })

  test("text content makes an assistant message visible", () => {
    expect(hasVisibleContent(message({
      parts: [{ id: "p", sessionID: "s", messageID: "m", type: "text", text: "  \nhello\n " }],
    }))).toBe(true)
  })

  test("system-reminder-only text does not count as visible content", () => {
    expect(hasVisibleContent(message({
      parts: [{ id: "p", sessionID: "s", messageID: "m", type: "text", text: "<system-reminder>ctx</system-reminder>" }],
    }))).toBe(false)
  })

  test("tool parts make an assistant message visible", () => {
    expect(hasVisibleContent(message({
      parts: [{ id: "p", sessionID: "s", messageID: "m", type: "tool", tool: "bash", state: { status: "completed" } } as never],
    }))).toBe(true)
  })

  test("errors make an assistant message visible", () => {
    expect(hasVisibleContent(message({ error: { name: "ProviderError", data: { message: "boom" } } } as DisplayMessage))).toBe(true)
  })

  test("repeated calls on the same object stay consistent", () => {
    const msg = message({ parts: [{ id: "p", sessionID: "s", messageID: "m", type: "text", text: "hello" }] })
    expect(hasVisibleContent(msg)).toBe(true)
    expect(hasVisibleContent(msg)).toBe(true)
  })
})
