import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

type OpenAIAccountRecord = {
  accountId?: string
  organizationId?: string
  accountLabel?: string
  email?: string
  accessToken?: string
  refreshToken?: string
  enabled?: boolean
  addedAt?: number
  lastUsed?: number
}

type OpenAIAccountStorage = {
  version?: number
  activeIndex?: number
  activeIndexByFamily?: Record<string, number>
  accounts: OpenAIAccountRecord[]
}

export type OpenAIQuotaAccountCandidate = {
  authHeader: string
  accountId?: string
  label: string
  email?: string
  active: boolean
}

const STORAGE_FILE = "oc-codex-multi-auth-accounts.json"

function normalizeProjectPath(projectPath: string): string {
  const normalized = resolve(projectPath).replace(/\\/g, "/")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function sanitizeProjectName(projectPath: string): string {
  const name = basename(projectPath)
  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return sanitized || "project"
}

function getProjectStorageKey(projectPath: string): string {
  const normalizedPath = normalizeProjectPath(projectPath)
  const hash = createHash("sha256")
    .update(normalizedPath)
    .digest("hex")
    .slice(0, 12)
  const projectName = sanitizeProjectName(normalizedPath).slice(0, 40)
  return `${projectName}-${hash}`
}

function getGlobalStoragePath() {
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), ".opencode", STORAGE_FILE)
}

function getProjectStoragePath(projectDir: string) {
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), ".opencode", "projects", getProjectStorageKey(projectDir), STORAGE_FILE)
}

async function readStorage(path: string): Promise<OpenAIAccountStorage | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const raw = await file.text()
    if (!raw.trim()) return null
    const data = JSON.parse(raw) as OpenAIAccountStorage
    if (!data || typeof data !== "object" || !Array.isArray(data.accounts)) return null
    return data
  } catch {
    return null
  }
}

function resolveActiveIndex(storage: OpenAIAccountStorage): number {
  const total = storage.accounts?.length ?? 0
  if (total <= 0) return 0
  const rawCandidate = storage.activeIndexByFamily?.codex ?? storage.activeIndex
  const raw = Number.isFinite(rawCandidate) ? Number(rawCandidate) : 0
  return Math.max(0, Math.min(raw, total - 1))
}

function labelFor(account: OpenAIAccountRecord, index: number): string {
  return account.accountLabel || account.email || account.accountId || `OpenAI account ${index + 1}`
}

export async function loadOpenAIQuotaAccountCandidates(options?: { projectDir?: string }): Promise<OpenAIQuotaAccountCandidate[]> {
  const paths = options?.projectDir
    ? [getProjectStoragePath(options.projectDir), getGlobalStoragePath()]
    : [getGlobalStoragePath()]

  const seen = new Set<string>()
  const candidates: OpenAIQuotaAccountCandidate[] = []

  for (const path of paths) {
    const storage = await readStorage(path)
    if (!storage) continue

    const activeIndex = resolveActiveIndex(storage)
    const accounts = storage.accounts ?? []
    for (const [index, account] of accounts.entries()) {
      if (account.enabled === false) continue
      const accessToken = account.accessToken?.trim()
      if (!accessToken) continue

      const key = [account.accountId || "", account.email || "", account.refreshToken || accessToken].join("::")
      if (seen.has(key)) continue
      seen.add(key)

      candidates.push({
        authHeader: `Bearer ${accessToken}`,
        accountId: account.accountId?.trim() || undefined,
        label: labelFor(account, index),
        email: account.email?.trim() || undefined,
        active: index === activeIndex,
      })
    }
  }

  return candidates
}
