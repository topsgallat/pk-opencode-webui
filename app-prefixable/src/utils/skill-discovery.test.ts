import { expect, test } from "bun:test"
import { isHttpSkillLocation, isLocallyManagedSkill, skillSourcePathFromLocation } from "./skill-discovery"

test("detects local and remote skill locations", () => {
  expect(isHttpSkillLocation("https://example.com/.well-known/skills/")).toBe(true)
  expect(isHttpSkillLocation("/home/user/.config/opencode/skills/test-helper/SKILL.md")).toBe(false)
})

test("derives local source paths from SKILL.md locations", () => {
  expect(skillSourcePathFromLocation("/home/user/.config/opencode/skills/test-helper/SKILL.md")).toBe(
    "/home/user/.config/opencode/skills/test-helper",
  )
  expect(skillSourcePathFromLocation("/home/user/.config/opencode/skills/test-helper/"))
    .toBe("/home/user/.config/opencode/skills/test-helper")
})

test("identifies locally managed skill locations", () => {
  expect(isLocallyManagedSkill("/home/user/.config/opencode/skills/test-helper/SKILL.md")).toBe(true)
  expect(isLocallyManagedSkill("https://example.com/.well-known/skills/")).toBe(false)
})
