import * as fs from "node:fs"
import * as nodePath from "node:path"
import * as os from "node:os"

export type Skill = {
  name: string
  description: string
  location: string
  content: string
}

export type SkillScope = "global" | "project"

export type LocalSkillState = "active" | "disabled"

export type LocalSkill = Skill & {
  scope: SkillScope
  state: LocalSkillState
  sourcePath: string
  hiddenPath?: string
  originalPath?: string
}

type SkillRoot = {
  path: string
  scope: SkillScope
}

type DisabledSkillManifest = {
  version: 1
  originalPath: string
  scope: SkillScope
  disabledAt?: string
}

const DISABLED_SKILL_DIR = ".prokube-disabled-skills"
const DISABLED_SKILL_MANIFEST = ".prokube-skill.json"

function uniqueSkills<T extends Skill>(items: T[]): T[] {
  const seen = new Set<string>()
  const next: T[] = []

  for (const item of items) {
    const key = item.location.trim() || `${item.name}:${item.description}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }

  return next
}

function skillRoots(directory?: string): SkillRoot[] {
  const home = process.env.HOME || os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME || nodePath.join(home, ".config")
  const roots: SkillRoot[] = [
    { path: nodePath.join(configHome, "opencode", "skills"), scope: "global" },
    { path: nodePath.join(home, ".opencode", "skills"), scope: "global" },
  ]

  if (directory) {
    const resolved = nodePath.resolve(directory)
    roots.unshift({ path: nodePath.join(resolved, ".config", "opencode", "skills"), scope: "project" })
    roots.unshift({ path: nodePath.join(resolved, ".opencode", "skills"), scope: "project" })
  }

  const seen = new Set<string>()
  const next: SkillRoot[] = []
  for (const root of roots) {
    if (seen.has(root.path)) continue
    seen.add(root.path)
    next.push(root)
  }
  return next
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
  const entries = await readLocalSkillEntries(directory)
  return uniqueSkills<Skill>(entries.filter((item) => item.state === "active").map(({ scope, state, sourcePath, hiddenPath, originalPath, ...skill }) => skill))
}

async function readDisabledSkillManifest(skillDir: string): Promise<DisabledSkillManifest | null> {
  const manifestFile = nodePath.join(skillDir, DISABLED_SKILL_MANIFEST)
  const raw = await fs.promises.readFile(manifestFile, "utf-8").catch(() => "")
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<DisabledSkillManifest>
    if (parsed?.version !== 1) return null
    if ((parsed.scope !== "global" && parsed.scope !== "project") || typeof parsed.originalPath !== "string" || !parsed.originalPath.trim()) return null
    return {
      version: 1,
      originalPath: parsed.originalPath.trim(),
      scope: parsed.scope,
      disabledAt: typeof parsed.disabledAt === "string" ? parsed.disabledAt : undefined,
    }
  } catch {
    return null
  }
}

async function readActiveSkillsFromRoot(root: SkillRoot): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = []
  const entries = await fs.promises.readdir(root.path, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith(".") || entry.name === DISABLED_SKILL_DIR) continue

    const skillDir = nodePath.join(root.path, entry.name)
    const skillFile = nodePath.join(skillDir, "SKILL.md")
    const content = await fs.promises.readFile(skillFile, "utf-8").catch(() => "")
    if (!content) continue

    skills.push({
      name: entry.name,
      description: inferSkillDescription(content),
      location: skillFile,
      content,
      scope: root.scope,
      state: "active",
      sourcePath: skillDir,
    })
  }

  return uniqueSkills<LocalSkill>(skills)
}

async function readDisabledSkillsFromRoot(root: SkillRoot): Promise<LocalSkill[]> {
  const hiddenRoot = nodePath.join(root.path, DISABLED_SKILL_DIR)
  const skills: LocalSkill[] = []
  const entries = await fs.promises.readdir(hiddenRoot, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = nodePath.join(hiddenRoot, entry.name)
    const manifest = await readDisabledSkillManifest(skillDir)
    if (!manifest) continue

    const skillFile = nodePath.join(skillDir, "SKILL.md")
    const content = await fs.promises.readFile(skillFile, "utf-8").catch(() => "")
    if (!content) continue

    const originalSkillFile = nodePath.join(manifest.originalPath, "SKILL.md")
    skills.push({
      name: nodePath.basename(manifest.originalPath),
      description: inferSkillDescription(content),
      location: originalSkillFile,
      content,
      scope: manifest.scope,
      state: "disabled",
      sourcePath: manifest.originalPath,
      originalPath: manifest.originalPath,
      hiddenPath: skillDir,
    })
  }

  return uniqueSkills<LocalSkill>(skills)
}

export async function readLocalSkillEntries(directory?: string): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = []

  for (const root of skillRoots(directory)) {
    skills.push(...await readActiveSkillsFromRoot(root), ...await readDisabledSkillsFromRoot(root))
  }

  return uniqueSkills<LocalSkill>(skills)
}
