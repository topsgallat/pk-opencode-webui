/**
 * Git browsing endpoints (read-only)
 *
 * Serves /api/ext/git/* locally (never proxied to OpenCode) so the Review
 * panel can list branches and browse files of any local branch. OpenCode's
 * /file endpoints only see the checked-out working tree, so browsing another
 * branch needs git plumbing (`for-each-ref` / `ls-tree` / `cat-file` / `show`)
 * run directly in the repository. Everything here is read-only: the working
 * tree is never modified.
 */

import * as nodePath from "node:path"
import { getAllowedRoot } from "./extended-api"

const GIT_MAX_FILE_BYTES = 2 * 1024 * 1024
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/

function validateRepoDir(inputPath: string, allowedRoot: string): string | null {
  const resolved = nodePath.resolve(allowedRoot, inputPath)
  const normalizedRoot = nodePath.resolve(allowedRoot)
  if (normalizedRoot === "/") return resolved
  if (resolved === normalizedRoot) return resolved
  if (!resolved.startsWith(normalizedRoot + nodePath.sep)) return null
  return resolved
}

function resolveRepoDir(url: URL): { dir: string; error?: undefined } | { dir?: undefined; error: Response } {
  const raw = url.searchParams.get("directory")
  const dir = validateRepoDir(raw || getAllowedRoot(), getAllowedRoot())
  if (!dir) return { error: Response.json({ error: "directory must be within allowed directory" }, { status: 403 }) }
  return { dir }
}

/**
 * Git refs are used as argv elements and as `<ref>:<path>` specs, so reject
 * anything that could start a flag, traverse, or escape the ref namespace.
 */
function validateRef(ref: string | null): string | null {
  if (!ref || ref.length > 200) return null
  if (ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/") || ref.includes("..")) return null
  if (!REF_PATTERN.test(ref)) return null
  return ref
}

/** Repo-relative paths for ls-tree/show: no absolute paths, no traversal. */
function validateRepoPath(path: string | null): string | null {
  if (!path) return null
  if (path.startsWith("/") || path.split("/").includes("..")) return null
  const trimmed = path.replace(/\/+$/, "")
  if (!trimmed) return null
  return trimmed
}

async function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", "-c", "safe.directory=*", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

function gitErrorResponse(stderr: string): Response {
  const message = stderr.trim().split("\n")[0] || "git command failed"
  const notRepo = /not a git repository/i.test(message)
  return Response.json({ error: message }, { status: notRepo ? 400 : 404 })
}

function gitServerError(op: string, e: unknown): Response {
  console.error(`[GitAPI] ${op} error:`, e)
  return Response.json({ error: String(e) }, { status: 500 })
}

export async function handleGitEndpoint(path: string, method: string, url: URL): Promise<Response | undefined> {
  if (method !== "GET" || !path.startsWith("/api/ext/git/")) return undefined
  if (path === "/api/ext/git/branches") return handleBranches(url)
  if (path === "/api/ext/git/tree") return handleTree(url)
  if (path === "/api/ext/git/list") return handleList(url)
  if (path === "/api/ext/git/file") return handleFile(url)
  return undefined
}

async function handleBranches(url: URL): Promise<Response> {
  const resolved = resolveRepoDir(url)
  if (resolved.error) return resolved.error
  try {
    const [names, current] = await Promise.all([
      runGit(["for-each-ref", "refs/heads", "--format=%(refname:short)", "--sort=-committerdate"], resolved.dir),
      runGit(["branch", "--show-current"], resolved.dir),
    ])
    if (names.code !== 0) return gitErrorResponse(names.stderr)
    const currentBranch = current.code === 0 ? current.stdout.trim() : ""
    return Response.json({ branches: names.stdout.split("\n").filter(Boolean), current: currentBranch || null })
  } catch (e) {
    return gitServerError("branches", e)
  }
}

async function handleTree(url: URL): Promise<Response> {
  const resolved = resolveRepoDir(url)
  if (resolved.error) return resolved.error
  const ref = validateRef(url.searchParams.get("ref"))
  if (!ref) return Response.json({ error: "valid ref parameter is required" }, { status: 400 })
  const rawPath = url.searchParams.get("path")
  const dirPath = rawPath ? validateRepoPath(rawPath) : ""
  if (dirPath === null) return Response.json({ error: "invalid path parameter" }, { status: 400 })
  try {
    const res = await runGit(["ls-tree", "-z", dirPath ? `${ref}:${dirPath}` : ref], resolved.dir)
    if (res.code !== 0) return gitErrorResponse(res.stderr)
    const entries = res.stdout
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t")
        const type = line.slice(0, tab).split(" ")[1]
        const name = line.slice(tab + 1)
        return { name, path: dirPath ? `${dirPath}/${name}` : name, type: type === "tree" ? "dir" : "file" }
      })
    return Response.json({ entries })
  } catch (e) {
    return gitServerError("tree", e)
  }
}

async function handleList(url: URL): Promise<Response> {
  const resolved = resolveRepoDir(url)
  if (resolved.error) return resolved.error
  const ref = validateRef(url.searchParams.get("ref"))
  if (!ref) return Response.json({ error: "valid ref parameter is required" }, { status: 400 })
  try {
    const res = await runGit(["ls-tree", "-r", "--name-only", "-z", ref], resolved.dir)
    if (res.code !== 0) return gitErrorResponse(res.stderr)
    return Response.json({ files: res.stdout.split("\0").filter(Boolean) })
  } catch (e) {
    return gitServerError("list", e)
  }
}

async function handleFile(url: URL): Promise<Response> {
  const resolved = resolveRepoDir(url)
  if (resolved.error) return resolved.error
  const ref = validateRef(url.searchParams.get("ref"))
  if (!ref) return Response.json({ error: "valid ref parameter is required" }, { status: 400 })
  const filePath = validateRepoPath(url.searchParams.get("path"))
  if (!filePath) return Response.json({ error: "path parameter is required" }, { status: 400 })
  const spec = `${ref}:${filePath}`
  try {
    const size = await runGit(["cat-file", "-s", spec], resolved.dir)
    if (size.code !== 0) return gitErrorResponse(size.stderr)
    if ((Number.parseInt(size.stdout.trim(), 10) || 0) > GIT_MAX_FILE_BYTES) {
      return Response.json({ error: "file too large to preview (limit 2MB)" }, { status: 413 })
    }
    const res = await runGit(["show", spec], resolved.dir)
    if (res.code !== 0) return gitErrorResponse(res.stderr)
    return Response.json({ content: res.stdout })
  } catch (e) {
    return gitServerError("file", e)
  }
}
