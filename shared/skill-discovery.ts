import * as fs from "node:fs"
import * as nodePath from "node:path"
import * as os from "node:os"

export type Skill = {
  name: string
  description: string
  location: string
  content: string
}

const DISABLED_SKILL_DIR = ".prokube-disabled-skills"

function uniqueSkills(items: Skill[]): Skill[] {
  const seen = new Set<string>()
  const next: Skill[] = []

  for (const item of items) {
    const key = item.location.trim() || `${item.name}:${item.description}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }

  return next
}

function skillRoots(directory?: string): string[] {
  const home = process.env.HOME || os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME || nodePath.join(home, ".config")
  const roots = [
    nodePath.join(configHome, "opencode", "skills"),
    nodePath.join(home, ".opencode", "skills"),
  ]

  if (directory) {
    const resolved = nodePath.resolve(directory)
    roots.unshift(nodePath.join(resolved, ".config", "opencode", "skills"))
    roots.unshift(nodePath.join(resolved, ".opencode", "skills"))
  }

  return uniqueSkills(roots.map((value) => ({ name: value, description: "", location: value, content: "" }))).map((item) => item.location)
}

function inferSkillDescription(content: string): string {
  const lines = content.split(/\r?\n/)
  let inFrontmatter = false
  let seenFrontmatter = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!seenFrontmatter && trimmed === "---") {
      seenFrontmatter = true
      inFrontmatter = true
      continue
    }
    if (inFrontmatter && trimmed === "---") break
    if (inFrontmatter) {
      const match = line.match(/^description:\s*(.*)$/i)
      if (match?.[1]?.trim()) return match[1].trim()
      continue
    }
    if (trimmed.startsWith("#")) {
      const heading = trimmed.replace(/^#+\s*/, "").trim()
      if (heading) return heading
      continue
    }
    if (trimmed) return trimmed
  }

  return ""
}

export async function readLocalSkills(directory?: string): Promise<Skill[]> {
  const skills: Skill[] = []

  for (const root of skillRoots(directory)) {
    const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".") || entry.name === DISABLED_SKILL_DIR) continue

      const skillDir = nodePath.join(root, entry.name)
      const skillFile = nodePath.join(skillDir, "SKILL.md")
      const content = await fs.promises.readFile(skillFile, "utf-8").catch(() => "")
      if (!content) continue

      skills.push({
        name: entry.name,
        description: inferSkillDescription(content),
        location: skillFile,
        content,
      })
    }
  }

  return uniqueSkills(skills)
}
