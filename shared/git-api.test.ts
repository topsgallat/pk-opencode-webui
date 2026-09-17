import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { handleGitEndpoint } from "./git-api"

const env = {
  HOME: process.env.HOME,
  OPENCODE_WORKSPACE_ROOT: process.env.OPENCODE_WORKSPACE_ROOT,
}

afterEach(() => {
  process.env.HOME = env.HOME
  process.env.OPENCODE_WORKSPACE_ROOT = env.OPENCODE_WORKSPACE_ROOT
})

type BranchesBody = { branches: string[]; current: string | null }
type TreeBody = { entries: Array<{ name: string; path: string; type: string }> }
type ListBody = { files: string[] }
type FileBody = { content: string }

async function run(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: cwd } })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout
}

async function makeRepo() {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-git-"))
  process.env.OPENCODE_WORKSPACE_ROOT = root
  process.env.HOME = root
  const commit = (msg: string) =>
    run(["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", msg], root)
  await run(["init", "-b", "main"], root)
  await fs.writeFile(nodePath.join(root, "README.md"), "# demo\n", "utf-8")
  await run(["add", "."], root)
  await commit("init")
  await fs.mkdir(nodePath.join(root, "src", "lib"), { recursive: true })
  await fs.writeFile(nodePath.join(root, "src", "index.ts"), "export {}\n", "utf-8")
  await fs.writeFile(nodePath.join(root, "src", "lib", "util.ts"), "export const one = 1\n", "utf-8")
  await run(["add", "."], root)
  await commit("src")
  await run(["switch", "-c", "feature/x"], root)
  await fs.writeFile(nodePath.join(root, "feature.txt"), "feature only\n", "utf-8")
  await run(["add", "."], root)
  await commit("feature")
  await run(["switch", "main"], root)
  return root
}

async function gitGet(pathname: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost${pathname}?${new URLSearchParams(params)}`)
  return await handleGitEndpoint(pathname, "GET", url)
}

test("lists branches with the current one", async () => {
  const root = await makeRepo()
  const res = await gitGet("/api/ext/git/branches", { directory: root })
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)
  const body = await res!.json() as BranchesBody
  expect(body.branches).toContain("main")
  expect(body.branches).toContain("feature/x")
  expect(body.current).toBe("main")
})

test("defaults directory to the allowed root", async () => {
  await makeRepo()
  const res = await gitGet("/api/ext/git/branches")
  expect(res).toBeDefined()
  expect(res!.status).toBe(200)
  const body = await res!.json() as BranchesBody
  expect(body.current).toBe("main")
})

test("lists tree entries at the root of a ref", async () => {
  const root = await makeRepo()
  const res = await gitGet("/api/ext/git/tree", { directory: root, ref: "feature/x" })
  expect(res!.status).toBe(200)
  const body = await res!.json() as TreeBody
  const byName = new Map(body.entries.map((entry) => [entry.name, entry]))
  expect(byName.get("README.md")).toMatchObject({ type: "file", path: "README.md" })
  expect(byName.get("src")).toMatchObject({ type: "dir", path: "src" })
  expect(byName.get("feature.txt")).toMatchObject({ type: "file", path: "feature.txt" })
})

test("lists tree entries in a subdirectory", async () => {
  const root = await makeRepo()
  const res = await gitGet("/api/ext/git/tree", { directory: root, ref: "main", path: "src" })
  expect(res!.status).toBe(200)
  const body = await res!.json() as TreeBody
  const byName = new Map(body.entries.map((entry) => [entry.name, entry]))
  expect(byName.get("index.ts")).toMatchObject({ type: "file", path: "src/index.ts" })
  expect(byName.get("lib")).toMatchObject({ type: "dir", path: "src/lib" })
})

test("lists all files of a ref recursively", async () => {
  const root = await makeRepo()
  const res = await gitGet("/api/ext/git/list", { directory: root, ref: "feature/x" })
  expect(res!.status).toBe(200)
  const body = await res!.json() as ListBody
  expect(body.files).toContain("README.md")
  expect(body.files).toContain("src/index.ts")
  expect(body.files).toContain("src/lib/util.ts")
  expect(body.files).toContain("feature.txt")
})

test("reads file content from a ref", async () => {
  const root = await makeRepo()
  const res = await gitGet("/api/ext/git/file", { directory: root, ref: "feature/x", path: "src/lib/util.ts" })
  expect(res!.status).toBe(200)
  const body = await res!.json() as FileBody
  expect(body.content).toBe("export const one = 1\n")
})

test("rejects oversized files with 413", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-git-big-"))
  process.env.OPENCODE_WORKSPACE_ROOT = root
  process.env.HOME = root
  await run(["init", "-b", "main"], root)
  await fs.writeFile(nodePath.join(root, "big.bin"), Buffer.alloc(3 * 1024 * 1024, 7), "latin1")
  await run(["add", "."], root)
  await run(["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", "big"], root)
  const res = await gitGet("/api/ext/git/file", { directory: root, ref: "main", path: "big.bin" })
  expect(res!.status).toBe(413)
})

test("returns 404 for a missing file and 400 for invalid input", async () => {
  const root = await makeRepo()
  const missing = await gitGet("/api/ext/git/file", { directory: root, ref: "main", path: "nope.txt" })
  expect(missing!.status).toBe(404)

  const badRef = await gitGet("/api/ext/git/tree", { directory: root, ref: "-oops" })
  expect(badRef!.status).toBe(400)

  const traversal = await gitGet("/api/ext/git/tree", { directory: root, ref: "main", path: "../escape" })
  expect(traversal!.status).toBe(400)

  const noRef = await gitGet("/api/ext/git/list", { directory: root })
  expect(noRef!.status).toBe(400)
})

test("rejects directories outside the allowed root", async () => {
  await makeRepo()
  const res = await gitGet("/api/ext/git/branches", { directory: "/etc" })
  expect(res!.status).toBe(403)
})

test("serves raw bytes with a guessed content type", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-git-raw-"))
  process.env.OPENCODE_WORKSPACE_ROOT = root
  process.env.HOME = root
  await run(["init", "-b", "main"], root)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  await fs.writeFile(nodePath.join(root, "logo.png"), png)
  await run(["add", "."], root)
  await run(["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", "img"], root)
  const res = await gitGet("/api/ext/git/raw", { directory: root, ref: "main", path: "logo.png" })
  expect(res!.status).toBe(200)
  expect(res!.headers.get("Content-Type")).toBe("image/png")
  const body = Buffer.from(await res!.arrayBuffer())
  expect(body.equals(png)).toBe(true)
})

test("returns 404 and 413 for raw blobs", async () => {
  const root = await makeRepo()
  const missing = await gitGet("/api/ext/git/raw", { directory: root, ref: "main", path: "nope.png" })
  expect(missing!.status).toBe(404)

  const big = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-git-bigraw-"))
  process.env.OPENCODE_WORKSPACE_ROOT = big
  process.env.HOME = big
  await run(["init", "-b", "main"], big)
  await fs.writeFile(nodePath.join(big, "huge.bin"), Buffer.alloc(11 * 1024 * 1024, 1))
  await run(["add", "."], big)
  await run(["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-m", "huge"], big)
  const oversize = await gitGet("/api/ext/git/raw", { directory: big, ref: "main", path: "huge.bin" })
  expect(oversize!.status).toBe(413)
})

test("ignores non-git and non-GET requests", async () => {
  const res = await gitGet("/api/ext/other")
  expect(res).toBeUndefined()
  const url = new URL("http://localhost/api/ext/git/branches")
  expect(await handleGitEndpoint("/api/ext/git/branches", "POST", url)).toBeUndefined()
})
