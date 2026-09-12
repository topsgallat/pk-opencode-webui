/**
 * Reads Claude Code's own on-disk session transcripts so the frontend can
 * show session history and let a user resume an old conversation.
 *
 * The `claude` CLI persists every turn as JSON Lines under
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, where `<slug>` is the cwd
 * with every non `[A-Za-z0-9]` character replaced by `-` (verified against
 * real session directories on disk; this mapping isn't documented, so
 * `listClaudeSessions` double-checks each file's own `cwd` field before
 * trusting it belongs to the requested directory). Reading these files
 * directly avoids depending on `@anthropic-ai/claude-agent-sdk` just for
 * history, matching this codebase's existing approach in claude-cli.ts /
 * claude-api.ts of shelling out to / reading the CLI's own state rather than
 * wrapping it in an SDK.
 */

import * as fs from "node:fs/promises"
import * as nodePath from "node:path"

const MAX_HISTORY_FILE_BYTES = 10 * 1024 * 1024
const MAX_SESSIONS_LISTED = 50
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]+$/

export function isValidSessionId(id: string): boolean {
  return id.length > 0 && id.length <= 200 && SESSION_ID_PATTERN.test(id)
}

function projectSlugForCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-")
}

function projectsDir(homeDir: string, cwd: string): string {
  return nodePath.join(homeDir, ".claude", "projects", projectSlugForCwd(cwd))
}

type RawRecord = Record<string, unknown>

function readJsonlLines(text: string): RawRecord[] {
  const records: RawRecord[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const record = JSON.parse(trimmed)
      if (record && typeof record === "object") records.push(record as RawRecord)
    } catch {
      // ignore malformed lines
    }
  }
  return records
}

async function readSessionFile(filePath: string): Promise<RawRecord[] | null> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_HISTORY_FILE_BYTES) return null
  const text = await fs.readFile(filePath, "utf8")
  return readJsonlLines(text)
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          !!block && typeof block === "object" && (block as RawRecord).type === "text" && typeof (block as RawRecord).text === "string",
      )
      .map((block) => block.text)
      .join("\n")
  }
  return ""
}

export interface ClaudeSessionSummary {
  id: string
  preview: string
  updatedAt: string
  messageCount: number
}

export async function listClaudeSessions(homeDir: string, cwd: string): Promise<ClaudeSessionSummary[]> {
  const dir = projectsDir(homeDir, cwd)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const summaries: ClaudeSessionSummary[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue
    const id = entry.slice(0, -".jsonl".length)
    if (!isValidSessionId(id)) continue

    const records = await readSessionFile(nodePath.join(dir, entry))
    if (!records || !records.length) continue

    const recordCwd = records.find((r) => typeof r.cwd === "string")?.cwd
    if (typeof recordCwd === "string" && nodePath.resolve(recordCwd) !== nodePath.resolve(cwd)) continue

    const visible = records.filter((r) => r.isSidechain !== true && (r.type === "user" || r.type === "assistant"))
    if (!visible.length) continue

    const firstUser = visible.find((r) => r.type === "user")
    const firstUserMessage = firstUser?.message as RawRecord | undefined
    const preview = (blockText(firstUserMessage?.content) || "(no preview)").replace(/\s+/g, " ").trim().slice(0, 120)

    const last = visible[visible.length - 1]
    const updatedAt = typeof last.timestamp === "string" ? last.timestamp : new Date(0).toISOString()

    summaries.push({ id, preview, updatedAt, messageCount: visible.length })
  }

  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return summaries.slice(0, MAX_SESSIONS_LISTED)
}

export type ToolStatus = "running" | "done" | "error"

export type ChatHistoryItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: ToolStatus; result?: string }

function pushAssistantText(items: ChatHistoryItem[], text: string) {
  if (!text) return
  const last = items[items.length - 1]
  if (last && last.kind === "assistant") {
    items[items.length - 1] = { kind: "assistant", text: last.text + text }
  } else {
    items.push({ kind: "assistant", text })
  }
}

export async function loadClaudeSessionMessages(homeDir: string, cwd: string, sessionId: string): Promise<ChatHistoryItem[] | null> {
  if (!isValidSessionId(sessionId)) return null
  const dir = projectsDir(homeDir, cwd)
  const records = await readSessionFile(nodePath.join(dir, `${sessionId}.jsonl`))
  if (!records) return null

  const items: ChatHistoryItem[] = []
  const toolIndex = new Map<string, number>()

  for (const record of records) {
    if (record.isSidechain === true) continue
    const message = record.message as RawRecord | undefined
    const content = message?.content

    if (record.type === "user") {
      if (Array.isArray(content)) {
        for (const block of content as RawRecord[]) {
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const idx = toolIndex.get(block.tool_use_id)
            if (idx !== undefined) {
              const existing = items[idx]
              if (existing.kind === "tool") {
                items[idx] = { ...existing, status: block.is_error ? "error" : "done", result: blockText(block.content) }
              }
            }
          } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            items.push({ kind: "user", text: block.text })
          }
        }
      } else if (typeof content === "string" && content.trim()) {
        items.push({ kind: "user", text: content })
      }
      continue
    }

    if (record.type === "assistant" && Array.isArray(content)) {
      for (const block of content as RawRecord[]) {
        if (block.type === "text" && typeof block.text === "string" && block.text) {
          pushAssistantText(items, block.text)
        } else if (block.type === "tool_use") {
          const id = typeof block.id === "string" && block.id ? block.id : `tool-${items.length}`
          toolIndex.set(id, items.length)
          items.push({ kind: "tool", id, name: String(block.name ?? "tool"), input: block.input, status: "running" })
        }
      }
    }
  }

  return items
}
