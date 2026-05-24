import { test, expect } from '@playwright/test';

test('App loads successfully', async ({ page }) => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  
  try {
    const response = await page.goto(baseUrl, { 
      waitUntil: 'load', 
      timeout: 10000 
    });
    
    expect(response?.status()).toBe(200);
    
    const title = await page.title();
    expect(title).toBe('OpenCode');
  } catch (error) {
    console.log('Test failed:', error.message);
    throw error;
  }
});
