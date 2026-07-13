import { describe, expect, test } from "bun:test"
import { extractDelegatedSkills, extractSkillName, summarizeUsedSkills } from "./tool-part-skills"

describe("extractDelegatedSkills", () => {
  test("returns load_skills from the delegation call input", () => {
    expect(extractDelegatedSkills({ load_skills: ["web-pentest", "recon"] })).toEqual(["web-pentest", "recon"])
  })

  test("empty when load_skills is missing", () => {
    expect(extractDelegatedSkills({ description: "no skills here" })).toEqual([])
    expect(extractDelegatedSkills(undefined)).toEqual([])
  })

  test("drops non-string entries", () => {
    expect(extractDelegatedSkills({ load_skills: ["web-pentest", 123, "", null] })).toEqual(["web-pentest"])
  })

  test("empty when load_skills is not an array", () => {
    expect(extractDelegatedSkills({ load_skills: "web-pentest" })).toEqual([])
  })
})

describe("extractSkillName", () => {
  test("returns the skill name for a skill tool call", () => {
    expect(extractSkillName({ tool: "skill", input: { skill: "code-review", args: "--fix" } })).toBe("code-review")
  })

  test("undefined for non-skill tools", () => {
    expect(extractSkillName({ tool: "bash", input: { skill: "code-review" } })).toBeUndefined()
  })

  test("undefined when input is missing", () => {
    expect(extractSkillName({ tool: "skill" })).toBeUndefined()
  })

  test("undefined when skill field is missing or not a string", () => {
    expect(extractSkillName({ tool: "skill", input: {} })).toBeUndefined()
    expect(extractSkillName({ tool: "skill", input: { skill: 123 } })).toBeUndefined()
    expect(extractSkillName({ tool: "skill", input: { skill: "" } })).toBeUndefined()
  })
})

describe("summarizeUsedSkills", () => {
  test("dedupes and counts repeated skill invocations", () => {
    expect(summarizeUsedSkills([
      { tool: "skill", input: { skill: "code-review" } },
      { tool: "bash", input: { command: "ls" } },
      { tool: "skill", input: { skill: "code-review" } },
      { tool: "skill", input: { skill: "deep-research" } },
    ])).toEqual([
      { name: "code-review", count: 2 },
      { name: "deep-research", count: 1 },
    ])
  })

  test("sorts alphabetically regardless of call order", () => {
    expect(summarizeUsedSkills([
      { tool: "skill", input: { skill: "verify" } },
      { tool: "skill", input: { skill: "init" } },
    ])).toEqual([
      { name: "init", count: 1 },
      { name: "verify", count: 1 },
    ])
  })

  test("empty when there are no skill calls", () => {
    expect(summarizeUsedSkills([{ tool: "bash" }, { tool: "read" }])).toEqual([])
  })
})
