import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { readLocalSkills } from "./skill-discovery"

const env = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
}

afterEach(() => {
  process.env.HOME = env.HOME
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
})

test("reads skills from global and legacy roots", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-skill-root-"))
  process.env.HOME = root

  const modern = nodePath.join(root, ".config", "opencode", "skills", "modern")
  const legacy = nodePath.join(root, ".opencode", "skills", "legacy")
  await fs.mkdir(modern, { recursive: true })
  await fs.mkdir(legacy, { recursive: true })

  await fs.writeFile(nodePath.join(modern, "SKILL.md"), "---\ndescription: Modern skill\n---\n# Modern\n", "utf-8")
  await fs.writeFile(nodePath.join(legacy, "SKILL.md"), "Legacy skill body\n", "utf-8")

  const skills = await readLocalSkills()
  expect(skills.map((skill) => skill.name).sort()).toEqual(["legacy", "modern"])
  expect(skills.find((skill) => skill.name === "modern")?.description).toBe("Modern skill")
  expect(skills.find((skill) => skill.name === "legacy")?.description).toBe("Legacy skill body")
})

test("skips hidden disabled skill directories", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pkui-skill-hidden-"))
  process.env.HOME = root

  const hidden = nodePath.join(root, ".config", "opencode", "skills", ".prokube-disabled-skills")
  await fs.mkdir(hidden, { recursive: true })
  await fs.writeFile(nodePath.join(hidden, "SKILL.md"), "hidden skill\n", "utf-8")

  const skills = await readLocalSkills()
  expect(skills.find((skill) => skill.name === ".prokube-disabled-skills")).toBeUndefined()
})
