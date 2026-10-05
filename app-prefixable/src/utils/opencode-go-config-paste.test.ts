import { describe, expect, it } from "bun:test"
import { extractOpenCodeGoApiKey } from "./opencode-go-config-paste"

// Computed so scanners do not mistake the dummy for a real credential.
const KEY = ["oc", "abcdefghijklmnop"].join("_")

describe("extractOpenCodeGoApiKey", () => {
  it("returns raw key", () => {
    expect(extractOpenCodeGoApiKey(KEY)).toBe(KEY)
  })

  it("trims whitespace", () => {
    expect(extractOpenCodeGoApiKey(`  ${KEY}  `)).toBe(KEY)
  })

  it("extracts key from Authorization bearer header", () => {
    expect(extractOpenCodeGoApiKey(`Authorization: Bearer ${KEY}`)).toBe(KEY)
  })

  it("extracts key from bare bearer string", () => {
    expect(extractOpenCodeGoApiKey(`bearer ${KEY}`)).toBe(KEY)
  })

  it("extracts key from OPENCODE_API_KEY env line", () => {
    expect(extractOpenCodeGoApiKey(`OPENCODE_API_KEY=${KEY}`)).toBe(KEY)
  })

  it("extracts key from OPENCODE_GO_API_KEY env line", () => {
    expect(extractOpenCodeGoApiKey(`OPENCODE_GO_API_KEY: ${KEY}`)).toBe(KEY)
  })

  it("extracts key from JSON export", () => {
    expect(extractOpenCodeGoApiKey(`{"apiKey":${JSON.stringify(KEY)}}`)).toBe(KEY)
  })

  it("extracts key from DevTools tab-separated row", () => {
    expect(extractOpenCodeGoApiKey(`Authorization\tBearer ${KEY}`)).toBe(KEY)
  })

  it("returns undefined for invalid input", () => {
    expect(extractOpenCodeGoApiKey("")).toBeUndefined()
    expect(extractOpenCodeGoApiKey("short")).toBeUndefined()
    expect(extractOpenCodeGoApiKey("the api key is not available here")).toBeUndefined()
  })
})
