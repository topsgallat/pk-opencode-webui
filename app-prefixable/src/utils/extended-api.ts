import { appendTargetParam } from "./path"
import { fetchWithTimeout } from "./request-timeout"
import type { QuotaApiResponse } from "../../../shared/quota/types"

const EXT_API_TIMEOUT_MS = 15_000

/**
 * Create a directory recursively
 */
export async function mkdir(serverUrl: string, path: string, targetUrl?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/mkdir`, targetUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }, EXT_API_TIMEOUT_MS, "extended mkdir")
    return res.ok && (await res.json()) === true
  } catch (e) {
    console.error("[extended-api] mkdir failed:", e)
    return false
  }
}

/**
 * List directories in a given path
 */
export async function listDirs(
  serverUrl: string,
  directory: string,
  options?: { query?: string; limit?: number; depth?: number; targetUrl?: string },
): Promise<string[]> {
  try {
    const params = new URLSearchParams({ directory })
    if (options?.query) params.set("query", options.query)
    if (options?.limit) params.set("limit", options.limit.toString())
    if (options?.depth) params.set("depth", options.depth.toString())

    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/list-dirs?${params}`, options?.targetUrl), {}, EXT_API_TIMEOUT_MS, "extended listDirs")
    if (!res.ok) return []
    return await res.json()
  } catch (e) {
    console.error("[extended-api] listDirs failed:", e)
    return []
  }
}

/**
 * Write content to a file (creates parent directories if needed)
 */
export async function writeFile(serverUrl: string, path: string, content: string, targetUrl?: string): Promise<boolean> {
  const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/file`, targetUrl), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  }, EXT_API_TIMEOUT_MS, "extended writeFile").catch(() => null)
  if (!res?.ok) {
    console.error("[extended-api] writeFile failed:", res?.status)
    return false
  }
  return true
}

/**
 * Upload a browser file via the extended API
 */
export async function uploadFile(serverUrl: string, path: string, file: File, targetUrl?: string): Promise<boolean> {
  try {
    const form = new FormData()
    form.set("path", path)
    form.set("file", file, file.name)

    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/file`, targetUrl), {
      method: "POST",
      body: form,
    }, EXT_API_TIMEOUT_MS, "extended uploadFile")
    return res.ok
  } catch (e) {
    console.error("[extended-api] uploadFile failed:", e)
    return false
  }
}

/**
 * Read file content via extended API
 */
export async function readFile(serverUrl: string, path: string, targetUrl?: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ path })
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/file?${params}`, targetUrl), {}, EXT_API_TIMEOUT_MS, "extended readFile")
    if (!res.ok) return null
    const data = await res.json()
    return data.content
  } catch (e) {
    console.error("[extended-api] readFile failed:", e)
    return null
  }
}

/**
 * Delete a file via extended API
 */
export async function deleteFile(serverUrl: string, path: string, targetUrl?: string): Promise<boolean> {
  const params = new URLSearchParams({ path })
  const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/file?${params}`, targetUrl), {
    method: "DELETE",
  }, EXT_API_TIMEOUT_MS, "extended deleteFile").catch(() => null)
  
  if (!res?.ok) {
    console.error("[extended-api] deleteFile failed:", res?.status)
    return false
  }
  return true
}

/**
 * Delete a directory via extended API
 */
export async function deleteDir(serverUrl: string, path: string, targetUrl?: string): Promise<boolean> {
  const params = new URLSearchParams({ path })
  const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/dir?${params}`, targetUrl), {
    method: "DELETE",
  }, EXT_API_TIMEOUT_MS, "extended deleteDir").catch(() => null)

  if (!res?.ok) {
    console.error("[extended-api] deleteDir failed:", res?.status)
    return false
  }
  return true
}

/**
 * Create an empty file
 */
export async function createFile(serverUrl: string, path: string, targetUrl?: string): Promise<boolean> {
  return writeFile(serverUrl, path, "", targetUrl)
}

/**
 * Move a file or directory via extended API
 */
export async function moveItem(serverUrl: string, source: string, dest: string, targetUrl?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/move`, targetUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, dest }),
    }, EXT_API_TIMEOUT_MS, "extended moveItem")
    return res.ok
  } catch (e) {
    console.error("[extended-api] moveItem failed:", e)
    return false
  }
}

/**
 * Provider account storage keys (localStorage)
 */
const PROVIDER_ACCOUNTS_KEY = "opencode.providerAccounts"

/**
 * Provider account interface
 */
export interface ProviderAccount {
  id: string // unique ID: "providerType:accountName"
  providerType: string // e.g., "github-copilot"
  accountName: string // user-provided name, e.g., "work", "personal"
  apiKey?: string // encrypted storage (in production, should use server-side storage)
}

/**
 * Get stored provider accounts from localStorage
 */
export function getProviderAccounts(): Record<string, ProviderAccount> {
  try {
    const stored = localStorage.getItem(PROVIDER_ACCOUNTS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

/**
 * Save provider accounts to localStorage
 */
export function saveProviderAccounts(accounts: Record<string, ProviderAccount>): void {
  localStorage.setItem(PROVIDER_ACCOUNTS_KEY, JSON.stringify(accounts))
}

/**
 * Add a provider account
 */
export function addProviderAccount(account: ProviderAccount): boolean {
  try {
    const accounts = getProviderAccounts()
    accounts[account.id] = account
    saveProviderAccounts(accounts)
    return true
  } catch {
    return false
  }
}

/**
 * Remove a provider account
 */
export function removeProviderAccount(id: string): boolean {
  try {
    const accounts = getProviderAccounts()
    delete accounts[id]
    saveProviderAccounts(accounts)
    return true
  } catch {
    return false
  }
}

export async function syncProviderAuth(serverUrl: string, providerID: string, authHeader: string, targetUrl?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/provider-auth`, targetUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID, authHeader }),
    }, EXT_API_TIMEOUT_MS, "extended syncProviderAuth")
    return res.ok && (await res.json())?.ok === true
  } catch (e) {
    console.error("[extended-api] syncProviderAuth failed:", e)
    return false
  }
}

export async function syncProviderAuthFromBackend(serverUrl: string, providerID: string, targetUrl?: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ providerID })
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/provider-auth/from-backend?${params}`, targetUrl), {
      method: "POST",
    }, EXT_API_TIMEOUT_MS, "extended syncProviderAuthFromBackend")
    return res.ok && (await res.json())?.ok === true
  } catch (e) {
    console.error("[extended-api] syncProviderAuthFromBackend failed:", e)
    return false
  }
}

export async function clearProviderAuth(serverUrl: string, providerID: string, targetUrl?: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ providerID })
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/provider-auth?${params}`, targetUrl), {
      method: "DELETE",
    }, EXT_API_TIMEOUT_MS, "extended clearProviderAuth")
    return res.ok && (await res.json())?.cleared !== false
  } catch (e) {
    console.error("[extended-api] clearProviderAuth failed:", e)
    return false
  }
}

export type ProviderConnectionTestInput = {
  providerID?: string
  baseURL: string
  apiKey: string
  models?: Array<{ id: string; name: string }>
  targetUrl?: string
}

export type ProviderConnectionTestResult = {
  ok: boolean
  reachable?: boolean
  status?: number
  error?: string
  message?: string
}

export async function validateProviderConnection(serverUrl: string, input: ProviderConnectionTestInput): Promise<ProviderConnectionTestResult> {
  try {
    const res = await fetchWithTimeout(appendTargetParam(`${serverUrl}/api/ext/provider-validate`, input.targetUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: input.providerID,
        baseURL: input.baseURL,
        apiKey: input.apiKey,
        models: input.models ?? [],
      }),
    }, EXT_API_TIMEOUT_MS, "extended validateProviderConnection")

    const data = await res.json().catch(() => null)
    if (data && typeof data === "object") {
      return {
        ok: Boolean(data.ok),
        reachable: typeof data.reachable === "boolean" ? data.reachable : undefined,
        status: typeof data.status === "number" ? data.status : undefined,
        error: typeof data.error === "string" ? data.error : undefined,
        message: typeof data.message === "string" ? data.message : undefined,
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : res.statusText || "provider validation failed",
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message }
  }
}

/**
 * List available OpenCode log files
 */
export async function listLogFiles(serverUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${serverUrl}/api/ext/log-files`)
    if (!res.ok) return []
    return await res.json()
  } catch (e) {
    console.error("[extended-api] listLogFiles failed:", e)
    return []
  }
}

/**
 * Read content from an OpenCode log file
 */
export async function readLogFile(serverUrl: string, name: string): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/api/ext/log-file?name=${encodeURIComponent(name)}`)
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    console.error("[extended-api] readLogFile failed:", e)
    return null
  }
}

/**
 * Get quota data from all providers
 */
export async function getQuota(serverUrl: string, options?: { refresh?: boolean; targetUrl?: string }): Promise<QuotaApiResponse> {
  const params = new URLSearchParams()
  if (options?.refresh) params.set("refresh", "true")
  if (options?.targetUrl) params.set("target", options.targetUrl)

  const res = await fetchWithTimeout(`${serverUrl}/api/ext/quota?${params}`, {}, EXT_API_TIMEOUT_MS, "extended getQuota")
  if (!res.ok) {
    throw new Error(`Failed to fetch quota: ${res.status}`)
  }
  return await res.json()
}
