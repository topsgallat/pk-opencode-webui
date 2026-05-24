import { chromium } from 'playwright';

async function runTests() {
  console.log('Starting fullscreen preview tests...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to app...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('App loaded successfully');
    
    await page.screenshot({ path: '/home/sgallat/pk-opencode-webui/app-prefixable/e2e/screenshot-home.png' });
    console.log('Screenshot saved: screenshot-home.png');
    
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    const bodyText = await page.locator('body').textContent();
    console.log(`Page contains "OpenCode": ${bodyText.includes('OpenCode')}`);
    
    console.log('\n=== TESTING FULLSCREEN PREVIEW ===');
    console.log('Note: Full testing requires a project to be opened and a file to be selected.');
    console.log('The file-viewer component needs:');
    console.log('  1. A .md or .html file to be open');
    console.log('  2. Preview mode to be active (not source mode)');
    console.log('  3. Then Maximize2 button should appear in header');
    
    console.log('\n=== CHECKING FILE-VIEWER COMPONENT ===');
    const fileViewerExists = await page.locator('[data-component="file-viewer"]').count() > 0;
    console.log(`File viewer component found: ${fileViewerExists}`);
    
    const maximizeButtons = await page.locator('button[title="Fullscreen Preview"]').count();
    console.log(`Maximize2 buttons on page: ${maximizeButtons}`);
    
  } catch (error) {
    console.error('Test error:', error.message);
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

runTests();
