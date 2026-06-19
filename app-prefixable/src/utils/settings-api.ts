import { fetchWithTimeout } from "./request-timeout"

const API_TIMEOUT_MS = 10_000

export async function loadSettings(serverUrl: string, namespace: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${serverUrl}/api/ext/settings?ns=${encodeURIComponent(namespace)}`, {}, API_TIMEOUT_MS, "extended loadSettings")
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`)
  return await res.json() as Record<string, unknown>
}

export async function saveSetting(serverUrl: string, namespace: string, key: string, value: unknown): Promise<void> {
  const res = await fetchWithTimeout(`${serverUrl}/api/ext/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ns: namespace, key, value }),
  }, API_TIMEOUT_MS, "extended saveSetting")
  if (!res.ok) throw new Error(`Failed to save setting: ${res.status}`)
}
