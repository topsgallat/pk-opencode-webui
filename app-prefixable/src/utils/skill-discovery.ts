export function isHttpSkillLocation(location: string): boolean {
  try {
    const url = new URL(location)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function skillSourcePathFromLocation(location: string): string | null {
  const value = location.trim()
  if (!value || isHttpSkillLocation(value)) return null

  if (value.startsWith("file://")) {
    try {
      const url = new URL(value)
      const path = decodeURIComponent(url.pathname).replace(/[\\/]+$/, "")
      if (!path) return null
      return path.replace(/[\\/]SKILL\.md$/i, "") || path
    } catch {
      return null
    }
  }

  const normalized = value.replace(/[\\/]+$/, "")
  if (!normalized) return null

  if (/(^|[\\/])SKILL\.md$/i.test(normalized)) {
    return normalized.replace(/[\\/]SKILL\.md$/i, "")
  }

  return normalized
}

export function isLocallyManagedSkill(location: string): boolean {
  return skillSourcePathFromLocation(location) !== null
}
