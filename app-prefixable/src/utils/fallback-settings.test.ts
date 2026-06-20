import { describe, expect, it } from "bun:test"
import {
  fallbackGlobalAgentKey,
  fallbackProjectAgentKey,
  fallbackProjectKey,
  resolveFallbackPolicyForAgent,
  resolveFallbackPolicies,
  type FallbackPolicyConfig,
} from "./fallback-settings"

function policy(overrides: FallbackPolicyConfig): FallbackPolicyConfig {
  return overrides
}

describe("fallback-settings", () => {
  it("keeps legacy global/project resolution intact", () => {
    const resolved = resolveFallbackPolicies({
      [fallbackProjectKey("/work")]: policy({ enabled: true, cross_provider: false, order: ["a/b"] }),
      global: policy({ enabled: false, cross_provider: true, order: ["c/d"] }),
    }, "/work", policy({ enabled: true }), policy({ cross_provider: false }))

    expect(resolved.global).toEqual({ enabled: false, cross_provider: true, order: ["c/d"] })
    expect(resolved.project).toEqual({ enabled: true, cross_provider: false, order: ["a/b"] })
    expect(resolved.hasProjectOverride).toBe(true)
  })

  it("prefers project agent override over project default and global policies", () => {
    const resolved = resolveFallbackPolicyForAgent({
      global: policy({ enabled: true, cross_provider: false, order: ["global/default"] }),
      [fallbackGlobalAgentKey("build")]: policy({ enabled: false, cross_provider: true, order: ["global/build"] }),
      [fallbackProjectKey("/work")]: policy({ enabled: true, cross_provider: false, order: ["project/default"] }),
      [fallbackProjectAgentKey("/work", "build")]: policy({ enabled: false, cross_provider: true, order: ["project/build"] }),
    }, "/work", "build", policy({ enabled: true }), policy({ enabled: true }))

    expect(resolved.projectAgent).toEqual({ enabled: false, cross_provider: true, order: ["project/build"] })
    expect(resolved.effective).toEqual({ enabled: false, cross_provider: true, order: ["project/build"] })
    expect(resolved.hasProjectAgentOverride).toBe(true)
    expect(resolved.hasGlobalAgentOverride).toBe(true)
  })

  it("falls back to project default when a global agent override exists", () => {
    const resolved = resolveFallbackPolicyForAgent({
      global: policy({ enabled: false, cross_provider: true, order: ["global/default"] }),
      [fallbackGlobalAgentKey("plan")]: policy({ enabled: true, cross_provider: false, order: ["global/plan"] }),
      [fallbackProjectKey("/work")]: policy({ enabled: true, cross_provider: true, order: ["project/default"] }),
    }, "/work", "plan", policy({ enabled: true }), policy({ enabled: false }))

    expect(resolved.project).toEqual({ enabled: true, cross_provider: true, order: ["project/default"] })
    expect(resolved.globalAgent).toEqual({ enabled: true, cross_provider: false, order: ["global/plan"] })
    expect(resolved.effective).toEqual({ enabled: true, cross_provider: true, order: ["project/default"] })
  })

  it("treats null agent values as cleared overrides", () => {
    const resolved = resolveFallbackPolicyForAgent({
      global: policy({ enabled: true, cross_provider: true, order: ["global/default"] }),
      [fallbackGlobalAgentKey("build")]: null,
      [fallbackProjectAgentKey("/work", "build")]: null,
    }, "/work", "build", policy({ enabled: false, cross_provider: false, order: ["legacy/global"] }), policy({ enabled: false, cross_provider: false, order: ["legacy/project"] }))

    expect(resolved.hasGlobalAgentOverride).toBe(false)
    expect(resolved.hasProjectAgentOverride).toBe(false)
    expect(resolved.effective).toEqual({ enabled: false, cross_provider: false, order: ["legacy/project"] })
  })
})
