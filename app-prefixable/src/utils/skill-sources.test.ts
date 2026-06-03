import { expect, test } from "bun:test"
import type { Config } from "../sdk/client"
import {
  addSkillSource,
  buildDisabledSkillPath,
  getSkillSources,
  removeSkillSource,
  skillSourceKey,
  uniqueSkillSources,
} from "./skill-sources"

test("collects and sorts custom skill sources", () => {
  const config: Config = {
    skills: {
      paths: ["/b", "/a", "/a"],
      urls: ["https://example.com/.well-known/skills/", "https://example.com/.well-known/skills/"],
    },
  }

  expect(getSkillSources(config)).toEqual([
    { kind: "path", value: "/a" },
    { kind: "path", value: "/b" },
    { kind: "url", value: "https://example.com/.well-known/skills" },
  ])
})

test("adds and removes skill sources from config", () => {
  const config: Config = {}
  const next = addSkillSource(config, { kind: "path", value: "/skills/custom" })
  expect(next.skills?.paths).toEqual(["/skills/custom"])

  const removed = removeSkillSource(next, { kind: "path", value: "/skills/custom" })
  expect(removed.skills?.paths).toEqual([])
})

test("builds a hidden disabled path for local sources", () => {
  expect(buildDisabledSkillPath("/home/user/skills/custom")).toMatch(/\.prokube-disabled-skills\/custom-/)
})

test("unique sources preserve kind and value", () => {
  expect(uniqueSkillSources([
    { kind: "path", value: "/skills/a" },
    { kind: "path", value: "/skills/a" },
    { kind: "url", value: "https://example.com/.well-known/skills" },
  ]).map(skillSourceKey)).toEqual([
    "path:/skills/a",
    "url:https://example.com/.well-known/skills",
  ])
})
