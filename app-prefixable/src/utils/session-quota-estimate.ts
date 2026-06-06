import type { QuotaEntryView } from "../../../shared/quota/types"
import { getQuotaPercentUsed } from "../components/session-info-helpers"

const SESSION_QUOTA_BASELINE_KEY = "opencode.sessionQuotaBaselines"

interface SessionQuotaBaseline {
  providerID: string
  accountID: string | null
  entryID: string
  resetTimeIso: string | null
  percentUsed: number
}

function readSessionQuotaBaselineMap(): Record<string, SessionQuotaBaseline> {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.sessionStorage.getItem(SESSION_QUOTA_BASELINE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as Record<string, SessionQuotaBaseline>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      window.sessionStorage.removeItem(SESSION_QUOTA_BASELINE_KEY)
      return {}
    }

    return parsed
  } catch {
    try {
      window.sessionStorage.removeItem(SESSION_QUOTA_BASELINE_KEY)
    } catch {}
    return {}
  }
}

function writeSessionQuotaBaselineMap(map: Record<string, SessionQuotaBaseline>) {
  if (typeof window === "undefined") return

  try {
    window.sessionStorage.setItem(SESSION_QUOTA_BASELINE_KEY, JSON.stringify(map))
  } catch {}
}

function anchorSessionQuotaBaseline(sessionID: string, baseline: SessionQuotaBaseline) {
  const map = readSessionQuotaBaselineMap()
  map[sessionID] = baseline
  writeSessionQuotaBaselineMap(map)
}

export function getSessionQuotaEstimate(
  sessionID: string,
  providerID: string,
  accountID: string | null,
  entry: Pick<QuotaEntryView, "id" | "used" | "total" | "percentUsed" | "resetTimeIso" | "unlimited">,
): number | null {
  const percentUsed = getQuotaPercentUsed(entry)
  if (percentUsed === null) return null

  const nextBaseline = {
    providerID,
    accountID,
    entryID: entry.id,
    resetTimeIso: entry.resetTimeIso ?? null,
    percentUsed,
  }
  const current = readSessionQuotaBaselineMap()[sessionID]

  if (!current) {
    anchorSessionQuotaBaseline(sessionID, nextBaseline)
    return null
  }

  if (current.providerID !== providerID || current.accountID !== accountID || current.entryID !== entry.id) {
    anchorSessionQuotaBaseline(sessionID, nextBaseline)
    return null
  }

  if (current.resetTimeIso !== nextBaseline.resetTimeIso || percentUsed < current.percentUsed) {
    anchorSessionQuotaBaseline(sessionID, nextBaseline)
    return null
  }

  const delta = Math.round(percentUsed - current.percentUsed)
  return delta > 0 ? delta : null
}

export function clearSessionQuotaEstimate(sessionID: string) {
  const map = readSessionQuotaBaselineMap()
  if (!(sessionID in map)) return
  delete map[sessionID]
  writeSessionQuotaBaselineMap(map)
}
