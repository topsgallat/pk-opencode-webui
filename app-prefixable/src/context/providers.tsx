import { createContext, useContext, createResource, createEffect, createMemo, type ParentProps, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "./sdk"
import { useConfig } from "./config"
import { useServer } from "./server"
import { getAnthropicModelPricing, getCopilotModelMultipliers, getOpenAIModelPricing, normalizeCopilotModelKey } from "../utils/path"
import { clearProviderAuth, getProviderAccounts, readErrorMessage, removeProviderAccount, saveProviderAccounts, syncProviderAuth, syncProviderAuthFromBackend, type ProviderAccount } from "../utils/extended-api"
import { withTimeout } from "../utils/request-timeout"
import { modelPolicyEnabled, providerBaseID } from "../utils/model-policy"

// Storage key
const MODELS_BY_AGENT_KEY = "opencode.modelsByAgent"

// Fallback defaults when no config is available
const FALLBACK_PROVIDER = "opencode"
const FALLBACK_MODEL = "big-pickle"
const FALLBACK_AGENT = "build"
const PROVIDER_REQUEST_TIMEOUT_MS = 12_000

// Define types locally to avoid SDK type mismatches
interface Model {
  id: string
  name: string
  providerID?: string // optional — injected during normalisation
  copilotMultiplier?: number
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
    context_over_200k?: {
      input: number
      output: number
      cache_read?: number
      cache_write?: number
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  variants?: {
    [key: string]: {
      disabled?: boolean
      [key: string]: unknown | boolean | undefined
    }
  }
}

function isZeroCost(cost?: Model["cost"]): boolean {
  return !cost || (cost.input === 0 && cost.output === 0)
}

interface Provider {
  id: string
  name: string
  models: Record<string, Model>
}

interface Agent {
  name: string
  mode: string
  hidden?: boolean
}

interface ProviderAuthMethod {
  type: "api" | "oauth"
  label: string
}

interface ModelKey {
  providerID: string
  modelID: string
}

interface ProviderListData {
  all: Provider[]
  connected: string[]
  default: Record<string, string>
}

interface OAuthAuthorization {
  url: string
  method: "auto" | "code"
  instructions: string
}

type OAuthCompletionResult =
  | { ok: true }
  | { ok: false; stage: "callback" | "sync" | "refresh"; status?: number; error: string }

function getConnectedProviderIDs(data?: ProviderListData): string[] {
  const connected = data?.connected ?? []
  const accounts = getProviderAccounts()
  const merged = [...connected]

  for (const account of Object.values(accounts)) {
    if (!connected.includes(account.providerType)) continue
    if (merged.includes(account.id)) continue
    merged.push(account.id)
  }

  return merged
}

interface ProviderContextValue {
  providers: Provider[]
  rawProviders: Provider[]
  connected: string[]
  rawConnected: string[]
  defaults: Record<string, string>
  authMethods: Record<string, ProviderAuthMethod[]>
  agents: Agent[]
  loading: boolean
  selectedModel: ModelKey | null
  selectedVariant: string | null
  selectedAgent: string
  modelsByAgent: Record<string, ModelKey>
  setSelectedModel: (model: ModelKey | null) => void
  setSelectedVariant: (variant: string | null) => void
  setSelectedAgent: (agent: string) => void
  refetch: () => Promise<void>
  connectProvider: (providerID: string, apiKey: string, accountName?: string) => Promise<boolean>
  disconnectProvider: (providerID: string) => Promise<boolean>
  startOAuth: (providerID: string, methodIndex: number) => Promise<OAuthAuthorization | undefined>
  completeOAuth: (providerID: string, methodIndex: number, code?: string) => Promise<OAuthCompletionResult>
  getAccounts: () => Record<string, ProviderAccount>
}

const ProviderContext = createContext<ProviderContextValue>()

export function ProviderProvider(props: ParentProps) {
  const { client, targetUrl, url: serverUrl } = useSDK()
  const cfg = useConfig()
  const server = useServer()
  const storageKey = () => `${MODELS_BY_AGENT_KEY}.${server.serverKey()}`
  type StoredSelections = {
    modelsByAgent: Record<string, ModelKey>
    variantsByAgent: Record<string, string | null>
  }

  const [store, setStore] = createStore({
    modelsByAgent: {} as Record<string, ModelKey>,
    variantsByAgent: {} as Record<string, string | null>,
    selectedAgent: FALLBACK_AGENT,
  })

  // Track whether the user has manually changed the agent via setSelectedAgent
  let userChangedAgent = false

  function formatOAuthError(error: unknown): { status?: number; error: string } {
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : typeof error === "object" && error !== null && "data" in error && typeof (error as { data?: { status?: unknown } }).data?.status === "number"
        ? (error as { data: { status: number } }).data.status
        : undefined

    const message = readErrorMessage(error)
      ?? (typeof error === "object" && error !== null && "data" in error ? readErrorMessage((error as { data?: unknown }).data) : undefined)
      ?? (error instanceof Error ? error.message : typeof error === "string" ? error : undefined)
      ?? "Authentication failed"

    return { status, error: message }
  }

  // Load models from localStorage
  onMount(() => {
    try {
      const stored = localStorage.getItem(storageKey())
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === "object" && "modelsByAgent" in parsed) {
          const next = parsed as Partial<StoredSelections>
          setStore("modelsByAgent", next.modelsByAgent ?? {})
          setStore("variantsByAgent", next.variantsByAgent ?? {})
        } else {
          setStore("modelsByAgent", parsed)
        }
      }
    } catch (e) {
      console.error("Failed to load models from storage:", e)
    }
  })

  // Save models to localStorage whenever they change
  createEffect(() => {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        modelsByAgent: store.modelsByAgent,
        variantsByAgent: store.variantsByAgent,
      }))
    } catch (e) {
      console.error("Failed to save models to storage:", e)
    }
  })

  // Fetch providers
  const [providerData, { refetch: refetchProviders }] = createResource(async () => {
    try {
      const res = await withTimeout(() => client.provider.list(), PROVIDER_REQUEST_TIMEOUT_MS, "Loading providers")
      const data = res.data as ProviderListData | undefined
      if (!data) return undefined
      const multipliers = getCopilotModelMultipliers()
      // Inject providerID into each model since the SDK response doesn't include it
      const all = data.all.map((provider) => ({
        ...provider,
        models: Object.fromEntries(
          Object.entries(provider.models).map(([k, m]) => {
            const key = normalizeCopilotModelKey(m.name || m.id)
            const openaiPricing = getOpenAIModelPricing(provider.id, m.id, m.name)
            const anthropicPricing = getAnthropicModelPricing(provider.id, m.id, m.name)
            const pricing = openaiPricing || anthropicPricing
            const cachedInput = openaiPricing?.cachedInput ?? anthropicPricing?.cachedInput
            const cacheWrite = anthropicPricing?.cacheWrite
            return [k, {
              ...m,
              providerID: provider.id,
              copilotMultiplier: provider.id === "github-copilot" ? multipliers[key] : undefined,
              cost: pricing && isZeroCost(m.cost)
                ? {
                    input: pricing.input,
                    output: pricing.output,
                    ...(cachedInput !== undefined ? { cache_read: cachedInput } : {}),
                    ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
                  }
                : m.cost,
            }]
          })
        ),
      }))
      return { ...data, all }
    } catch (e) {
      console.error("Failed to fetch providers:", e)
      return undefined
    }
  })

  const rawProviders = createMemo(() => providerData()?.all ?? [])
  const rawConnected = createMemo(() => getConnectedProviderIDs(providerData()))

  function providerAllowed(providerID: string) {
    const base = providerBaseID(providerID)
    if (cfg.project.enabled_providers) return cfg.project.enabled_providers.includes(base)
    if (cfg.project.disabled_providers) return !cfg.project.disabled_providers.includes(base)
    return true
  }

  const providersView = createMemo(() => rawProviders()
    .filter((provider) => providerAllowed(provider.id))
    .map((provider) => ({
      ...provider,
      models: Object.fromEntries(
        Object.entries(provider.models).filter(([modelID]) => modelPolicyEnabled(
          provider.id,
          modelID,
          cfg.global.provider ?? {},
          cfg.project.provider ?? {},
        ))
      ),
    })))
  const connectedView = createMemo(() => rawConnected().filter((providerID) => providerAllowed(providerID)))

  function providerFor(model: ModelKey | null, list = providersView()) {
    if (!model) return null
    return list.find((provider) => provider.id === model.providerID) ?? null
  }

  function modelAllowed(model: ModelKey | null) {
    const provider = providerFor(model)
    if (!provider || !model) return false
    if (!connectedView().includes(model.providerID)) return false
    return !!provider.models[model.modelID]
  }

  function variantAllowed(model: ModelKey | null, variant: string | null | undefined) {
    if (!model || !variant) return false
    const provider = providerFor(model)
    const selected = provider?.models[model.modelID]
    const config = selected?.variants?.[variant]
    return !!selected && !!config && !config.disabled
  }

  function fallbackModel() {
    const configModel = cfg.project.model || cfg.global.model
    if (!configModel) {
      const fallback = { providerID: FALLBACK_PROVIDER, modelID: FALLBACK_MODEL }
      if (modelAllowed(fallback)) return fallback

      for (const provider of providersView()) {
        if (!connectedView().includes(provider.id)) continue
        const modelID = Object.keys(provider.models)[0]
        if (modelID) return { providerID: provider.id, modelID }
      }

      return null
    }
    const slashIdx = configModel.indexOf("/")
    const parsedProvider = slashIdx > 0 ? configModel.slice(0, slashIdx) : ""
    const parsedModel = slashIdx > 0 ? configModel.slice(slashIdx + 1) : ""

    if (parsedProvider && parsedModel) {
      const configured = { providerID: parsedProvider, modelID: parsedModel }
      if (modelAllowed(configured)) return configured
    }

    const fallback = { providerID: FALLBACK_PROVIDER, modelID: FALLBACK_MODEL }
    if (modelAllowed(fallback)) return fallback

    for (const provider of providersView()) {
      if (!connectedView().includes(provider.id)) continue
      const modelID = Object.keys(provider.models)[0]
      if (modelID) return { providerID: provider.id, modelID }
    }

    return null
  }

  function resolveSelection(agent: string) {
    const stored = store.modelsByAgent[agent]
    if (modelAllowed(stored)) return stored
    return fallbackModel()
  }

  function resolveVariant(agent: string) {
    const variant = store.variantsByAgent[agent]
    const model = resolveSelection(agent)
    if (variantAllowed(model, variant)) return variant
    return null
  }

  // Auto-select default model/agent from project config, falling back to hardcoded defaults.
  // localStorage selections take priority (user's runtime choice wins).
  createEffect(() => {
    const data = providerData()
    if (!data) return

    const configAgent = cfg.project.default_agent || cfg.global.default_agent
    const agents = agentsData()
    const agentNames = agents ? agents.map((a) => a.name) : []
    const validConfigAgent = configAgent && agentNames.length > 0 && agentNames.includes(configAgent)
    const defaultAgent = validConfigAgent ? configAgent : FALLBACK_AGENT

    if (validConfigAgent && !userChangedAgent && store.selectedAgent === FALLBACK_AGENT && configAgent !== FALLBACK_AGENT) {
      setStore("selectedAgent", configAgent)
    }

    for (const [agent, model] of Object.entries(store.modelsByAgent)) {
      if (modelAllowed(model)) continue
      const resolved = fallbackModel()
      if (resolved) setStore("modelsByAgent", agent, resolved)
    }

    for (const [agent, variant] of Object.entries(store.variantsByAgent)) {
      const model = resolveSelection(agent)
      if (variantAllowed(model, variant)) continue
      if (variant !== null) setStore("variantsByAgent", agent, null)
    }

    if (!store.modelsByAgent[defaultAgent]) {
      const resolved = fallbackModel()
      if (resolved) setStore("modelsByAgent", defaultAgent, resolved)
    }
  })

  createEffect(() => {
    for (const providerID of rawConnected()) {
      void syncProviderAuthFromBackend(serverUrl, providerID, targetUrl)
    }
  })

  // Fetch auth methods for all providers (returns { [providerID]: ProviderAuthMethod[] })
  const [authData] = createResource(async () => {
    try {
      const res = await withTimeout(() => client.provider.auth(), PROVIDER_REQUEST_TIMEOUT_MS, "Loading provider auth methods")
      return (res.data as Record<string, ProviderAuthMethod[]>) ?? {}
    } catch (e) {
      console.error("Failed to fetch auth methods:", e)
      return {}
    }
  })

  // Fetch agents
  const [agentsData, { refetch: refetchAgents }] = createResource(async () => {
    try {
      const res = await withTimeout(() => client.app.agents(), PROVIDER_REQUEST_TIMEOUT_MS, "Loading agents")
      // The API returns an array directly, SDK wraps it in { data: [...] }
      const agents = res.data
      if (!Array.isArray(agents)) {
        console.error("[Providers] Agents is not an array:", agents)
        return []
      }
      return agents as Agent[]
    } catch (e) {
      console.error("Failed to fetch agents:", e)
      return []
    }
  })

  function setSelectedModel(model: ModelKey | null) {
    if (model && modelAllowed(model)) {
      const previous = resolveSelection(store.selectedAgent)
      setStore("modelsByAgent", store.selectedAgent, model)
      if (!previous || previous.providerID !== model.providerID || previous.modelID !== model.modelID) {
        setStore("variantsByAgent", store.selectedAgent, null)
      }
    }
  }

  function setSelectedVariant(variant: string | null) {
    if (variant === null) {
      setStore("variantsByAgent", store.selectedAgent, null)
      return
    }

    const model = resolveSelection(store.selectedAgent)
    if (variantAllowed(model, variant)) {
      setStore("variantsByAgent", store.selectedAgent, variant)
    }
  }

  function setSelectedAgent(agent: string) {
    if (!store.modelsByAgent[agent]) {
      const sourceAgent = store.selectedAgent
      const source = resolveSelection(sourceAgent) ?? resolveSelection(FALLBACK_AGENT)
      if (source) setStore("modelsByAgent", agent, source)
      const sourceVariant = resolveVariant(sourceAgent) ?? resolveVariant(FALLBACK_AGENT)
      if (sourceVariant) setStore("variantsByAgent", agent, sourceVariant)
    }
    userChangedAgent = true
    setStore("selectedAgent", agent)
  }

  async function connectProvider(providerID: string, apiKey: string, accountName?: string): Promise<boolean> {
    try {
      const effectiveProviderID = accountName ? `${providerID}:${accountName}` : providerID

      await client.auth.set({
        providerID: effectiveProviderID,
        auth: { type: "api", key: apiKey },
      })

      await syncProviderAuth(serverUrl, effectiveProviderID, `Bearer ${apiKey}`, targetUrl)
      
      if (accountName) {
        const accounts = getProviderAccounts()
        accounts[effectiveProviderID] = {
          id: effectiveProviderID,
          providerType: providerID,
          accountName,
          apiKey,
        }
        saveProviderAccounts(accounts)
      }
      
      await client.instance.dispose()
      await refetchProviders()
      return true
    } catch (e) {
      console.error("Failed to connect provider:", e)
      return false
    }
  }

  // Disconnect a connected provider/account
  async function disconnectProvider(providerID: string): Promise<boolean> {
    try {
      // If this is an account-scoped provider (provider:account), drop the local account metadata as well
      if (providerID.includes(":")) {
        try {
          removeProviderAccount(providerID)
        } catch {
          // Ignore local storage cleanup errors; backend removal is still attempted
        }
      }

    // Remove from OpenCode backend (provider-level or account-level)
    await client.auth.remove({ providerID })
    await clearProviderAuth(serverUrl, providerID, targetUrl)

    // Ensure the SDK instance reloads provider state before we refetch the
    // provider list. Connecting calls client.instance.dispose() to force a
    // fresh read; do the same on disconnect so the UI sees the update
    // immediately instead of requiring a container restart.
    try {
      await client.instance.dispose()
    } catch (e) {
      // Dispose failures are non-fatal for UI refresh; log and continue.
      console.error("Failed to dispose client instance during disconnect:", e)
    }

    // Refetch providers and agents to update any connected lists shown in the UI
    await refetchProviders()
    await refetchAgents()
    return true
    } catch (e) {
      console.error("Failed to disconnect provider:", e)
      return false
    }
  }

  async function startOAuth(providerID: string, methodIndex: number): Promise<OAuthAuthorization | undefined> {
    try {
      const res = await client.provider.oauth.authorize({
        providerID,
        method: methodIndex,
      })
      return res.data as OAuthAuthorization | undefined
    } catch (e) {
      console.error("Failed to start OAuth:", e)
      return undefined
    }
  }

  async function completeOAuth(providerID: string, methodIndex: number, code?: string): Promise<OAuthCompletionResult> {
    try {
      await client.provider.oauth.callback({
        providerID,
        method: methodIndex,
        code,
      })
    } catch (e) {
      console.error("Failed to complete OAuth callback:", e)
      const failure = formatOAuthError(e)
      return { ok: false, stage: "callback", ...failure }
    }

    const synced = await syncProviderAuthFromBackend(serverUrl, providerID, targetUrl)
    if (!synced.ok) {
      return {
        ok: false,
        stage: "sync",
        status: synced.status,
        error: synced.error || "Failed to sync provider auth from backend",
      }
    }

    try {
      // Dispose instance to reload provider state, then refresh
      await client.instance.dispose()
      await refetchProviders()
      return { ok: true }
    } catch (e) {
      console.error("Failed to refresh provider state after OAuth:", e)
      const failure = formatOAuthError(e)
      return { ok: false, stage: "refresh", ...failure }
    }
  }

  async function refetch() {
    await refetchProviders()
    await refetchAgents()
  }

  const value: ProviderContextValue = {
    get providers() {
      return providersView()
    },
    get rawProviders() {
      return rawProviders()
    },
    get connected() {
      return connectedView()
    },
    get rawConnected() {
      return rawConnected()
    },
    get defaults() {
      return providerData()?.default ?? {}
    },
    get authMethods() {
      return authData() ?? {}
    },
    get agents() {
      // Show all non-hidden agents from backend
      return (agentsData() ?? []).filter((a) => !a.hidden)
    },
    get loading() {
      return providerData.loading || agentsData.loading
    },
    get selectedModel() {
      return resolveSelection(store.selectedAgent)
    },
    get selectedVariant() {
      return resolveVariant(store.selectedAgent)
    },
    get selectedAgent() {
      return store.selectedAgent
    },
    get modelsByAgent() {
      return store.modelsByAgent
    },
    setSelectedModel,
    setSelectedVariant,
    setSelectedAgent,
    refetch,
    connectProvider,
    disconnectProvider,
    startOAuth,
    completeOAuth,
    getAccounts: () => getProviderAccounts(),
  }

  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

export function useProviders() {
  const ctx = useContext(ProviderContext)
  if (!ctx) throw new Error("useProviders must be used within ProviderProvider")
  return ctx
}
