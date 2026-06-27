const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[ERROR] ${err.message}`));
  page.on('response', async resp => {
    if (resp.url().includes('/api/')) {
      try {
        const b = await resp.json();
        console.log(`[API] ${resp.status()} ${new URL(resp.url()).pathname} => ${JSON.stringify(b).substring(0, 150)}`);
      } catch {}
    }
  });

  console.log('Navigating...');
  await page.goto('http://localhost:3456', { waitUntil: 'networkidle', timeout: 30000 });

  const token = await page.evaluate(() => localStorage.getItem('aluo_auth_token'));
  console.log(`[TOKEN] aluo_auth_token = "${token}"`);

  const mode = await page.evaluate(() => localStorage.getItem('aluo_api_mode'));
  console.log(`[MODE] aluo_api_mode = "${mode}"`);

  const title = await page.title();
  console.log(`[TITLE] ${title}`);

  const text = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log(`[BODY] ${text}`);

  const hasLogin = await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    return {
      hasLogin: t.includes('login') || t.includes('登录'),
      hasEmailInputs: document.querySelectorAll('input[type="email"], input[type="password"]').length,
      hasVip: t.includes('vip') || t.includes('会员'),
    };
  });
  console.log(`[CHECK] ${JSON.stringify(hasLogin)}`);

  await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  console.log('[SCREENSHOT] debug-screenshot.png');

  await browser.close();
})();
