import { test, expect } from '@playwright/test'

test.describe('Quota View', () => {
  test('should navigate to quota tab from settings', async ({ page }) => {
    // Navigate to settings page
    await page.goto('/settings')

    // Click on Quota tab
    await page.click('text=Quota')

    // Verify quota content loads
    await expect(page.locator('text=Quota Usage')).toBeVisible()
  })

  test('should show quota data when available', async ({ page }) => {
    // Mock the quota API response
    await page.route('/api/ext/quota', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          fetchedAt: new Date().toISOString(),
          refreshed: false,
          source: 'live',
          providers: [
            {
              id: 'copilot',
              name: 'GitHub Copilot',
              status: 'ok',
              available: true,
              entries: [
                {
                  id: 'personal',
                  group: 'personal',
                  label: 'Personal Usage',
                  used: 50,
                  total: 100,
                  percentRemaining: 50,
                  percentUsed: 50,
                  window: 'monthly'
                }
              ]
            }
          ],
          summary: {
            availableProviders: ['copilot'],
            unavailableProviders: [],
            hasWarnings: false
          },
          warnings: []
        })
      })
    })

    // Navigate to quota tab
    await page.goto('/settings#quota')

    // Verify provider card appears
    await expect(page.locator('text=GitHub Copilot')).toBeVisible()
    await expect(page.locator('text=Personal Usage')).toBeVisible()
  })

  test('should handle refresh action', async ({ page }) => {
    await page.route('/api/ext/quota', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          fetchedAt: new Date().toISOString(),
          refreshed: false,
          source: 'live',
          providers: [],
          summary: { availableProviders: [], unavailableProviders: [], hasWarnings: false },
          warnings: []
        })
      })
    })

    await page.goto('/settings#quota')

    // Click refresh button
    await page.click('text=Refresh')

    // Verify refresh completes (button becomes enabled again)
    await expect(page.locator('text=Refresh')).toBeEnabled()
  })

  test('should filter providers', async ({ page }) => {
    await page.route('/api/ext/quota', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          fetchedAt: new Date().toISOString(),
          refreshed: false,
          source: 'live',
          providers: [
            {
              id: 'copilot',
              name: 'GitHub Copilot',
              status: 'ok',
              available: true,
              entries: []
            },
            {
              id: 'openai',
              name: 'OpenAI',
              status: 'ok',
              available: true,
              entries: []
            }
          ],
          summary: {
            availableProviders: ['copilot', 'openai'],
            unavailableProviders: [],
            hasWarnings: false
          },
          warnings: []
        })
      })
    })

    await page.goto('/settings#quota')

    // Verify both providers shown initially
    await expect(page.locator('text=GitHub Copilot')).toBeVisible()
    await expect(page.locator('text=OpenAI')).toBeVisible()

    // Filter to Copilot only
    await page.click('text=Copilot')

    // Verify only Copilot remains
    await expect(page.locator('text=GitHub Copilot')).toBeVisible()
    await expect(page.locator('text=OpenAI')).not.toBeVisible()
  })

  test('should show error state', async ({ page }) => {
    await page.route('/api/ext/quota', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' })
      })
    })

    await page.goto('/settings#quota')

    // Verify error message appears
    await expect(page.locator('text=Failed to load quota data')).toBeVisible()
  })
})