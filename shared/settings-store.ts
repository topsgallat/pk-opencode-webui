import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

const DEFAULT_DB_PATH = `${process.env.HOME || process.env.USERPROFILE || homedir()}/.opencode/pkui-settings.db`

let instance: ReturnType<typeof createSettingsStore> | undefined

function createSettingsStore(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec("PRAGMA journal_mode=WAL")
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    namespace TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (namespace, key)
  )`)

  return {
    load(namespace: string): Record<string, unknown> {
      const rows = db.query<{ key: string; value: string }>(
        "SELECT key, value FROM settings WHERE namespace = ?",
      ).all(namespace)

      const result: Record<string, unknown> = {}
      for (const row of rows) {
        try {
          result[row.key] = JSON.parse(row.value)
        } catch {
          result[row.key] = row.value
        }
      }
      return result
    },

    save(namespace: string, key: string, value: unknown): void {
      const json = JSON.stringify(value)
      db.run(
        `INSERT INTO settings (namespace, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [namespace, key, json],
      )
    },

    close(): void {
      db.close()
    },
  }
}

export function getSettingsStore(dbPath?: string): ReturnType<typeof createSettingsStore> {
  if (!instance) {
    instance = createSettingsStore(dbPath ?? DEFAULT_DB_PATH)
  }
  return instance
}

export function __resetSettingsStoreForTests(dbPath: string) {
  if (instance) {
    instance.close()
    instance = undefined
  }
  instance = createSettingsStore(dbPath)
  return instance
}
