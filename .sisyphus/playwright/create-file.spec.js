// Playwright test: create-file.spec.js — quick end-to-end check for New File create flow
// Usage: node .sisyphus/playwright/create-file.spec.js  (requires playwright to be installed)

const { chromium } = require('playwright')

;(async () => {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()
  console.log('Opening', BASE_URL)
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })

  // Wait for Files panel and click New File toolbar button
  await page.waitForSelector('button[aria-label="New File"]', { timeout: 10000 })
  await page.click('button[aria-label="New File"]')

  // Fill input and assert Create button enabled
  const input = page.locator('#new-file-name')
  await input.fill('playwright-test-file.txt')

  const createBtn = page.locator('button[type="submit"]', { hasText: 'Create' })
  const enabled = await createBtn.isEnabled()
  console.log('Create button enabled?', enabled)

  if (!enabled) {
    console.error('Create button is disabled after filling input — test aborting')
    await browser.close()
    process.exit(2)
  }

  // Intercept network: wait for any create-file or mkdir request
  const [response] = await Promise.all([
    page.waitForResponse((resp) => /create|mkdir|file/i.test(resp.url()), { timeout: 5000 }).catch(() => null),
    createBtn.click(),
  ])

  if (!response) {
    console.error('No network response observed for create; check console/network in browser')
    await browser.close()
    process.exit(3)
  }

  console.log('Create API response status:', response.status(), 'url:', response.url())

  // Optionally assert file shows in tree
  const fileNode = page.locator('text=playwright-test-file.txt')
  const visible = await fileNode.isVisible().catch(() => false)
  console.log('File visible in tree?', visible)

  await browser.close()
  process.exit(0)
})()
