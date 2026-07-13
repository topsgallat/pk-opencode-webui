export type ChildToolCall = {
  tool: string
  input?: Record<string, unknown>
}

export type SkillUsage = {
  name: string
  count: number
}

// The `skill` tool call carries which skill was invoked in its `skill`
// input field (e.g. { skill: "code-review", args: "--fix" }). Anything
// else on a "skill" call (missing/non-string) isn't attributable to a
// named skill, so it's dropped rather than shown as "unknown".
export function extractSkillName(call: ChildToolCall): string | undefined {
  if (call.tool !== "skill") return undefined
  const value = call.input?.skill
  return typeof value === "string" && value.length > 0 ? value : undefined
}

// pentesters_task's delegation call can preload skills into the sub-agent
// via `load_skills: string[]` — distinct from skills the sub-agent later
// invokes itself through the `skill` tool.
export function extractDelegatedSkills(input: Record<string, unknown> | undefined): string[] {
  const value = input?.load_skills
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string" && v.length > 0)
}

// Dedupe + count skill invocations across a child session's tool calls,
// sorted alphabetically so the display order is stable across re-renders.
export function summarizeUsedSkills(calls: ChildToolCall[]): SkillUsage[] {
  const counts = new Map<string, number>()
  for (const call of calls) {
    const name = extractSkillName(call)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
