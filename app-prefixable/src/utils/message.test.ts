import { describe, expect, test } from "bun:test"
import type { Part } from "../sdk/client"
import { extractTextContent, extractTextToolSummary, parseUserText } from "./message"

function textPart(text: string, synthetic = false): Part {
  return { id: text, type: "text", text, synthetic } as Part
}

function toolPart(id: string): Part {
  return { id, type: "tool", tool: "bash", state: { status: "completed" } } as Part
}

describe("parseUserText", () => {
  test("separates system-only blocks from visible text", () => {
    const parsed = parseUserText([
      textPart("hello <system-reminder>internal</system-reminder><!-- OMO_INTERNAL_INITIATOR --><!-- hidden --> world"),
    ])

    expect(parsed.text).toBe("hello  world")
    expect(parsed.systemBlocks).toEqual([
      { label: "system-reminder", content: "internal" },
      { label: "OMO context", content: "<!-- OMO_INTERNAL_INITIATOR -->" },
      { label: "injected comment", content: "<!-- hidden -->" },
    ])
  })
})

describe("extractTextContent", () => {
  test("ignores synthetic text and strips system reminders", () => {
    const text = extractTextContent([
      textPart("visible"),
      textPart("synthetic", true),
      textPart("<system-reminder>internal</system-reminder> tail"),
    ])

    expect(text).toBe("visibletail")
  })
})

describe("extractTextToolSummary", () => {
  test("collects visible text and tool count in one pass", () => {
    const summary = extractTextToolSummary([
      textPart("answer "),
      toolPart("tool-1"),
      textPart("<system-reminder>ignore</system-reminder>done"),
      toolPart("tool-2"),
    ])

    expect(summary).toEqual({ text: "answerdone", toolCount: 2 })
  })
})
