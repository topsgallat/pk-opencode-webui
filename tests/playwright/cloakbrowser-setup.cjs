const getCloakBrowserLaunchOptions = require("./cloakbrowser.cjs")
const { pathToFileURL } = require("node:url")

module.exports = async function globalSetup() {
  const opts = getCloakBrowserLaunchOptions()
  if (!opts.executablePath) return

  const packageDir = getCloakBrowserLaunchOptions.getCloakBrowserPackageDir?.()
  if (!packageDir) return

  const cloak = await import(pathToFileURL(`${packageDir}/dist/index.js`).href)

  if (!cloak || typeof cloak.ensureBinary !== "function") return
  await cloak.ensureBinary()
}
