/**
 * Locates (or lazily installs) the `claude` CLI binary so the Claude backend
 * can spawn it per-session. Uses the native installer, which reuses the
 * subscription login cached under `${HOME}/.claude` — no API key required.
 */

import * as fs from "node:fs"
import * as nodePath from "node:path"

let cachedBinaryPromise: Promise<string> | undefined

export async function resolveClaudeBinary(homeDir: string): Promise<string> {
  if (cachedBinaryPromise) return cachedBinaryPromise

  cachedBinaryPromise = (async () => {
    const localBin = nodePath.join(homeDir, ".local", "bin", "claude")
    if (fs.existsSync(localBin)) return localBin

    const onPath = Bun.which("claude")
    if (onPath) return onPath

    console.log("[ClaudeCLI] claude binary not found, running native installer...")
    const install = Bun.spawn(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"], {
      env: { ...process.env, HOME: homeDir },
      stdout: "inherit",
      stderr: "inherit",
    })
    const code = await install.exited
    if (code !== 0) {
      throw new Error(`claude CLI install script exited with code ${code}`)
    }

    if (fs.existsSync(localBin)) return localBin
    const onPathAfter = Bun.which("claude")
    if (onPathAfter) return onPathAfter

    throw new Error("claude CLI installed but binary was not found on PATH or in ~/.local/bin")
  })()

  try {
    return await cachedBinaryPromise
  } catch (e) {
    cachedBinaryPromise = undefined
    throw e
  }
}
