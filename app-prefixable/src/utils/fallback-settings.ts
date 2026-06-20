import { base64Encode } from "./path"
import { loadSettings, saveSetting } from "./settings-api"
import type { FallbackPolicyConfig } from "./model-fallback"

export const FALLBACK_SETTINGS_NAMESPACE = "fallback"
const GLOBAL_KEY = "global"
const PROJECT_KEY_PREFIX = "project:"

export function fallbackProjectKey(directory: string) {
  return `${PROJECT_KEY_PREFIX}${base64Encode(directory)}`
}

function parsePolicy(value: unknown): FallbackPolicyConfig | undefined {
  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  const policy: FallbackPolicyConfig = {}

  if (typeof record.enabled === "boolean") policy.enabled = record.enabled
  if (typeof record.cross_provider === "boolean") policy.cross_provider = record.cross_provider
  if (Array.isArray(record.order)) {
    const order = record.order.filter((item): item is string => typeof item === "string")
    if (order.length > 0) policy.order = order
    else policy.order = []
  }

  return policy
}

export function loadStoredFallbackPolicy(data: Record<string, unknown> | undefined, key: string): FallbackPolicyConfig | undefined {
  if (!data || !(key in data)) return undefined
  return parsePolicy(data[key])
}

export function resolveFallbackPolicies(
  data: Record<string, unknown> | undefined,
  directory?: string,
  legacyGlobal?: FallbackPolicyConfig,
  legacyProject?: FallbackPolicyConfig,
) {
  const global = loadStoredFallbackPolicy(data, GLOBAL_KEY) ?? legacyGlobal
  const projectKey = directory ? fallbackProjectKey(directory) : null
  const project = projectKey ? loadStoredFallbackPolicy(data, projectKey) ?? legacyProject ?? global : legacyProject ?? global
  const hasProjectOverride = projectKey ? (data ? projectKey in data : false) : false

  return {
    global,
    project,
    hasProjectOverride,
  }
}

export async function loadFallbackSettings(serverUrl: string): Promise<Record<string, unknown>> {
  return await loadSettings(serverUrl, FALLBACK_SETTINGS_NAMESPACE)
}

export async function saveGlobalFallbackPolicy(serverUrl: string, policy: FallbackPolicyConfig): Promise<void> {
  await saveSetting(serverUrl, FALLBACK_SETTINGS_NAMESPACE, GLOBAL_KEY, policy)
}

export async function saveProjectFallbackPolicy(serverUrl: string, directory: string, policy: FallbackPolicyConfig | null): Promise<void> {
  await saveSetting(serverUrl, FALLBACK_SETTINGS_NAMESPACE, fallbackProjectKey(directory), policy)
}
