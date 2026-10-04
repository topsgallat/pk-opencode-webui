import { homedir } from "node:os"
import { join } from "node:path"

export function opencodeAuthFilePaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || homedir()
  const dataHome = process.env.XDG_DATA_HOME
  return [
    ...(dataHome ? [join(dataHome, "opencode", "auth.json")] : []),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]
}

export async function readOpenCodeAuthKey(id: string): Promise<string | undefined> {
  for (const path of opencodeAuthFilePaths()) {
    try {
      const file = Bun.file(path)
      if (!(await file.exists())) continue
      const data = (await file.json()) as Record<string, Record<string, unknown>>
      const key = data?.[id]?.key
      if (typeof key === "string" && key.trim()) return key.trim()
    } catch {
      // unreadable or malformed auth file — try the next path
    }
  }
  return undefined
}
