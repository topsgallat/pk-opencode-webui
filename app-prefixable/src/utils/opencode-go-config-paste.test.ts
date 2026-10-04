import { describe, expect, it } from "bun:test"
import { extractOpenCodeGoApiKey } from "./opencode-go-config-paste"

describe("extractOpenCodeGoApiKey", () => {
  it("returns raw key", () => {
    expect(extractOpenCodeGoApiKey("oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("trims whitespace", () => {
    expect(extractOpenCodeGoApiKey("  oc_abcdefghijklmnop  ")).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from Authorization bearer header", () => {
    expect(extractOpenCodeGoApiKey("Authorization: Bearer oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from bare bearer string", () => {
    expect(extractOpenCodeGoApiKey("bearer oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from OPENCODE_API_KEY env line", () => {
    expect(extractOpenCodeGoApiKey("OPENCODE_API_KEY=oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from OPENCODE_GO_API_KEY env line", () => {
    expect(extractOpenCodeGoApiKey("OPENCODE_GO_API_KEY: oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from JSON export", () => {
    expect(extractOpenCodeGoApiKey('{"apiKey":"oc_abcdefghijklmnop"}')).toBe("oc_abcdefghijklmnop")
  })

  it("extracts key from DevTools tab-separated row", () => {
    expect(extractOpenCodeGoApiKey("Authorization\tBearer oc_abcdefghijklmnop")).toBe("oc_abcdefghijklmnop")
  })

  it("returns undefined for invalid input", () => {
    expect(extractOpenCodeGoApiKey("")).toBeUndefined()
    expect(extractOpenCodeGoApiKey("short")).toBeUndefined()
    expect(extractOpenCodeGoApiKey("the api key is not available here")).toBeUndefined()
  })
})
