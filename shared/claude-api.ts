/**
 * Claude Code backend (Phase 1 MVP)
 *
 * Spawns the `claude` CLI headlessly (one process per turn, `--resume` to
 * continue a session) and streams its `stream-json` stdout to the frontend
 * as Server-Sent Events. Authentication reuses the subscription login cached
 * under `${HOME}/.claude` (from an interactive `claude` login) — this
 * deliberately does NOT use ANTHROPIC_API_KEY billing.
 *
 * No approval UI yet: tool use runs under `bypassPermissions` (full access,
 * same default as the reference cc-chat-ui) since the exact input/output
 * contract for a custom `--permission-prompt-tool` MCP server isn't
 * documented anywhere Anthropic publishes — building one now would mean
 * guessing a wire format. `--permission-prompts none` still prevents the
 * handful of actions bypassPermissions doesn't cover (critical-path
 * rm/rmdir, AskUserQuestion, etc.) from hanging with no host to answer them.
 */

import * as nodePath from "node:path"
import * as os from "node:os"
import { getAllowedRoot } from "./extended-api"
import { resolveClaudeBinary } from "./claude-cli"

function validateCwd(inputPath: string, allowedRoot: string): string | null {
  const resolved = nodePath.resolve(allowedRoot, inputPath)
  const normalizedRoot = nodePath.resolve(allowedRoot)
  if (normalizedRoot === "/") return resolved
  if (resolved === normalizedRoot) return resolved
  if (!resolved.startsWith(normalizedRoot + nodePath.sep)) return null
  return resolved
}

type ClaudeChatBody = {
  cwd?: string
  prompt?: string
  sessionId?: string
}

export async function handleClaudeEndpoint(
  path: string,
  method: string,
  _url: URL,
  req: Request,
): Promise<Response | undefined> {
  if (path !== "/api/claude/chat" || method !== "POST") return undefined

  const body = (await req.json().catch(() => null)) as ClaudeChatBody | null
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return Response.json({ error: "prompt is required" }, { status: 400 })
  }
  if (typeof body.cwd !== "string" || !body.cwd) {
    return Response.json({ error: "cwd is required" }, { status: 400 })
  }

  const allowedRoot = getAllowedRoot()
  const cwd = validateCwd(body.cwd, allowedRoot)
  if (!cwd) {
    return Response.json({ error: "cwd must be within allowed directory" }, { status: 403 })
  }

  const homeDir = process.env.HOME || os.homedir()
  let claudeBin: string
  try {
    claudeBin = await resolveClaudeBinary(homeDir)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ error: `claude CLI unavailable: ${message}` }, { status: 500 })
  }

  const args = [
    claudeBin,
    "-p",
    body.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // Full access, no approval UI yet (matches the reference cc-chat-ui's
    // default). --permission-prompts none keeps the rare still-gated actions
    // (critical-path rm/rmdir, AskUserQuestion, etc.) from hanging with no
    // host to answer them, instead of denying with a retry.
    "--permission-mode",
    "bypassPermissions",
    "--permission-prompts",
    "none",
  ]
  if (body.sessionId) args.push("--resume", body.sessionId)

  console.log(
    "[ClaudeAPI] spawning claude:",
    "cwd:", cwd,
    body.sessionId ? `resume:${body.sessionId}` : "(new session)",
  )

  const proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, HOME: homeDir },
    stdout: "pipe",
    stderr: "pipe",
  })

  // Drain stderr concurrently so a chatty process can't deadlock stdout.
  const stderrPromise = new Response(proc.stderr).text().catch(() => "")

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      const emit = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`))
          }
        }
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(`data: ${buffer.trim()}\n\n`))
        }
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) })
      } finally {
        const stderrText = await stderrPromise
        if (stderrText.trim()) {
          console.error("[ClaudeAPI] claude stderr:", stderrText.trim())
        }
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          emit({ type: "error", message: `claude exited with code ${exitCode}` })
        }
        controller.close()
      }
    },
    cancel() {
      proc.kill()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
