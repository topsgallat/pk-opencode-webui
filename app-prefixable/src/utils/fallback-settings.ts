import { base64Encode } from "./path"
import { loadSettings, saveSetting } from "./settings-api"
import type { FallbackPolicyConfig } from "./model-fallback"

export type { FallbackPolicyConfig } from "./model-fallback"

export const FALLBACK_SETTINGS_NAMESPACE = "fallback"
const FALLBACK_SERVER_NAMESPACE_PREFIX = "fallback.server"
const GLOBAL_KEY = "global"
const PROJECT_KEY_PREFIX = "project:"
const AGENT_KEY_PREFIX = "agent:"

export function fallbackProjectKey(directory: string) {
  return `${PROJECT_KEY_PREFIX}${base64Encode(directory)}`
}

export function fallbackSettingsNamespace(serverKey: string) {
  return `${FALLBACK_SERVER_NAMESPACE_PREFIX}.${base64Encode(serverKey)}`
}

export function fallbackGlobalAgentKey(agent: string) {
  return `${GLOBAL_KEY}:${AGENT_KEY_PREFIX}${base64Encode(agent)}`
}

export function fallbackProjectAgentKey(directory: string, agent: string) {
  return `${fallbackProjectKey(directory)}:${AGENT_KEY_PREFIX}${base64Encode(agent)}`
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

function hasStoredFallbackPolicy(data: Record<string, unknown> | undefined, key: string) {
  return loadStoredFallbackPolicy(data, key) !== undefined
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

export function resolveFallbackPolicyForAgent(
  data: Record<string, unknown> | undefined,
  directory: string | undefined,
  agent: string | undefined,
  legacyGlobal?: FallbackPolicyConfig,
  legacyProject?: FallbackPolicyConfig,
) {
  const global = loadStoredFallbackPolicy(data, GLOBAL_KEY) ?? legacyGlobal
  const projectKey = directory ? fallbackProjectKey(directory) : null
  const project = projectKey ? loadStoredFallbackPolicy(data, projectKey) ?? legacyProject ?? global : legacyProject ?? global
  const globalAgent = agent ? loadStoredFallbackPolicy(data, fallbackGlobalAgentKey(agent)) : undefined
  const projectAgent = agent && directory ? loadStoredFallbackPolicy(data, fallbackProjectAgentKey(directory, agent)) : undefined
  const effective = projectAgent ?? project ?? globalAgent ?? global

  return {
    global,
    project,
    globalAgent,
    projectAgent,
    effective,
    hasProjectOverride: projectKey ? hasStoredFallbackPolicy(data, projectKey) : false,
    hasGlobalAgentOverride: agent ? hasStoredFallbackPolicy(data, fallbackGlobalAgentKey(agent)) : false,
    hasProjectAgentOverride: agent && directory ? hasStoredFallbackPolicy(data, fallbackProjectAgentKey(directory, agent)) : false,
  }
}

export async function loadFallbackSettings(serverUrl: string, serverKey: string): Promise<Record<string, unknown>> {
  const scoped = await loadSettings(serverUrl, fallbackSettingsNamespace(serverKey))
  if (Object.keys(scoped).length > 0) return scoped
  return await loadSettings(serverUrl, FALLBACK_SETTINGS_NAMESPACE)
}

export async function saveGlobalFallbackPolicy(serverUrl: string, serverKey: string, policy: FallbackPolicyConfig): Promise<void> {
  await saveSetting(serverUrl, fallbackSettingsNamespace(serverKey), GLOBAL_KEY, policy)
}

export async function saveGlobalAgentFallbackPolicy(serverUrl: string, serverKey: string, agent: string, policy: FallbackPolicyConfig | null): Promise<void> {
  await saveSetting(serverUrl, fallbackSettingsNamespace(serverKey), fallbackGlobalAgentKey(agent), policy)
}

export async function saveProjectFallbackPolicy(serverUrl: string, serverKey: string, directory: string, policy: FallbackPolicyConfig | null): Promise<void> {
  await saveSetting(serverUrl, fallbackSettingsNamespace(serverKey), fallbackProjectKey(directory), policy)
}

export async function saveProjectAgentFallbackPolicy(serverUrl: string, serverKey: string, directory: string, agent: string, policy: FallbackPolicyConfig | null): Promise<void> {
  await saveSetting(serverUrl, fallbackSettingsNamespace(serverKey), fallbackProjectAgentKey(directory, agent), policy)
}
