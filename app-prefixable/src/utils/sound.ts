/**
 * Sound notification utilities.
 *
 * Sounds are generated programmatically via the Web Audio API so no external
 * audio files are needed. Each sound option exposes a `play` function that
 * synthesises a short tone on demand.
 */

import { dispatchStorageEvent } from "./storage"
import { getServerUrl } from "./path"
import { loadSettings, saveSetting } from "./settings-api"

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

export const SOUND_STORAGE_KEY = "opencode.soundSettings"
const SETTINGS_NAMESPACE = "ui"
const SETTINGS_KEY = "soundSettings"

export interface SoundSettings {
  enabled: boolean
  /** ID of the selected sound from SOUND_OPTIONS */
  sound: string
}

const DEFAULTS: SoundSettings = { enabled: false, sound: "chime" }

function normalizeSoundSettings(value: unknown): SoundSettings | null {
  if (!value || typeof value !== "object") return null
  const settings = value as Partial<SoundSettings>
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULTS.enabled,
    sound: typeof settings.sound === "string" && SOUND_OPTIONS.some((o) => o.id === settings.sound) ? settings.sound : DEFAULTS.sound,
  }
}

export function readSoundSettings(): SoundSettings {
  if (typeof window === "undefined") return { ...DEFAULTS }
  try {
    const raw = window.localStorage.getItem(SOUND_STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as unknown
    return normalizeSoundSettings(parsed) || { ...DEFAULTS }
  } catch {
    try { window.localStorage.removeItem(SOUND_STORAGE_KEY) } catch { /* ignore */ }
    return { ...DEFAULTS }
  }
}

export async function hydrateSoundSettingsFromDb(): Promise<SoundSettings> {
  const local = readSoundSettings()
  const settings = await loadSettings(getServerUrl(), SETTINGS_NAMESPACE).catch(() => null)
  const stored = settings ? normalizeSoundSettings(settings[SETTINGS_KEY]) : null

  if (stored) {
    if (JSON.stringify(readSoundSettings()) !== JSON.stringify(local)) return readSoundSettings()
    if (typeof window !== "undefined") {
      const next = JSON.stringify(stored)
      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, next)
        dispatchStorageEvent(SOUND_STORAGE_KEY, next)
      } catch {
        // Ignore persistence errors (e.g. storage disabled or quota exceeded)
      }
    }
    return stored
  }

  if (JSON.stringify(readSoundSettings()) !== JSON.stringify(local)) return readSoundSettings()
  void saveSetting(getServerUrl(), SETTINGS_NAMESPACE, SETTINGS_KEY, local).catch(() => undefined)
  return local
}

export function writeSoundSettings(settings: SoundSettings) {
  const value = JSON.stringify(settings)
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SOUND_STORAGE_KEY, value)
      dispatchStorageEvent(SOUND_STORAGE_KEY, value)
    }
  } catch {
    // Ignore persistence errors (e.g. storage disabled or quota exceeded)
  }
  void saveSetting(getServerUrl(), SETTINGS_NAMESPACE, SETTINGS_KEY, settings).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Web Audio API tone generators
// ---------------------------------------------------------------------------

function getAudioContext(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined
  // Reuse a single context across calls — browser limits the number of contexts
  const win = window as unknown as { __ocAudioCtx?: AudioContext }
  if (!win.__ocAudioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return undefined
    win.__ocAudioCtx = new Ctor()
  }
  return win.__ocAudioCtx
}

/** Prime the AudioContext so it's ready for the first notification.
 *  Must be called from a user-gesture handler (click/tap). */
export function primeAudioContext() {
  const ctx = getAudioContext()
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {})
}

/** Schedule and connect oscillator nodes for a set of tones. */
function scheduleTones(ctx: AudioContext, tones: [number, number, number][], gain: number) {
  if (!tones.length) return
  const master = ctx.createGain()
  master.gain.value = gain
  master.connect(ctx.destination)

  let remaining = tones.length

  for (const [freq, start, dur] of tones) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = freq
    env.gain.setValueAtTime(1, ctx.currentTime + start)
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
    osc.connect(env)
    env.connect(master)
    osc.start(ctx.currentTime + start)
    osc.stop(ctx.currentTime + start + dur + 0.05)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
      remaining--
      if (remaining === 0) master.disconnect()
    }
  }
}

/** Play a sequence of tones described by [frequency, startSec, durationSec] tuples. */
function playTones(tones: [number, number, number][], gain = 0.25) {
  const ctx = getAudioContext()
  if (!ctx) return

  if (ctx.state === "running") {
    scheduleTones(ctx, tones, gain)
    return
  }

  if (ctx.state === "suspended") {
    void ctx.resume().then(() => {
      if (ctx.state === "running") scheduleTones(ctx, tones, gain)
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Sound definitions
// ---------------------------------------------------------------------------

export interface SoundOption {
  id: string
  label: string
  play: () => void
}

export const SOUND_OPTIONS: SoundOption[] = [
  {
    id: "chime",
    label: "Chime",
    play: () => playTones([[587.33, 0, 0.15], [880, 0.12, 0.25]], 0.2),
  },
  {
    id: "ping",
    label: "Ping",
    play: () => playTones([[1200, 0, 0.1]], 0.3),
  },
  {
    id: "duo",
    label: "Duo",
    play: () => playTones([[523.25, 0, 0.12], [659.25, 0.1, 0.12]], 0.2),
  },
  {
    id: "alert",
    label: "Alert",
    play: () => playTones([[440, 0, 0.08], [440, 0.12, 0.08], [440, 0.24, 0.08]], 0.25),
  },
  {
    id: "gentle",
    label: "Gentle",
    play: () => playTones([[392, 0, 0.2], [523.25, 0.15, 0.3]], 0.15),
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Play the sound with the given option ID. No-op if the ID is unknown. */
export function playSound(id: string) {
  const option = SOUND_OPTIONS.find((o) => o.id === id)
  if (option) option.play()
}

/** Play the dedicated error sound. */
export function playErrorSound() {
  playSound("alert")
}
