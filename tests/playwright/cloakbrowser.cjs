const { existsSync, readFileSync } = require("node:fs")
const os = require("node:os")
const { join } = require("node:path")

function findPackageDir() {
  const bases = [process.cwd()]
  for (let i = 1; i <= 3; i += 1) bases.push(join(process.cwd(), ...Array(i).fill("..")))

  for (const base of bases) {
    const candidates = [
      join(base, "node_modules", "cloakbrowser"),
      join(base, "app-prefixable", "node_modules", "cloakbrowser"),
    ]
    for (const dir of candidates) {
      if (existsSync(join(dir, "package.json"))) return dir
    }
  }

  return ""
}

function getPlatformTag() {
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64"
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64"
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64"
  return ""
}

function getChromiumVersion(packageDir) {
  const config = readFileSync(join(packageDir, "dist", "config.js"), "utf8")
  const match = config.match(/export const PLATFORM_CHROMIUM_VERSIONS = \{([\s\S]*?)\n\};/)
  if (!match) return ""

  const platform = getPlatformTag()
  const versions = [...match[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)]
  for (const [, key, value] of versions) {
    if (key === platform) return value
  }

  const fallback = config.match(/export const CHROMIUM_VERSION = "([^"]+)";/)
  return fallback?.[1] || ""
}

function getBinaryPath(packageDir) {
  const version = getChromiumVersion(packageDir)
  if (!version) return ""

  const cacheDir = process.env.CLOAKBROWSER_CACHE_DIR || join(os.homedir(), ".cloakbrowser")
  const binaryDir = join(cacheDir, `chromium-${version}`)
  if (process.platform === "darwin") return join(binaryDir, "Chromium.app", "Contents", "MacOS", "Chromium")
  if (process.platform === "win32") return join(binaryDir, "chrome.exe")
  return join(binaryDir, "chrome")
}

function getCloakBrowserLaunchOptions() {
  const executablePath = process.env.CLOAKBROWSER_BINARY_PATH?.trim()
  if (executablePath) {
    return { executablePath }
  }

  const packageDir = findPackageDir()
  if (!packageDir) return {}

  const binaryPath = getBinaryPath(packageDir)
  if (binaryPath) return { executablePath: binaryPath }

  return {}
}

function getCloakBrowserPackageDir() {
  return findPackageDir()
}

module.exports = getCloakBrowserLaunchOptions
module.exports.getCloakBrowserPackageDir = getCloakBrowserPackageDir
module.exports.getCloakBrowserBinaryPath = getBinaryPath
