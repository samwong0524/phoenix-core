/**
 * Higgsfield 登录助手
 * 打开 Chrome 浏览器让用户在真正的 Higgsfield 网站上登录，
 * 登录成功后自动提取 session 并推送到线上服务器。
 *
 * 用法: node hf-login.js
 */
const puppeteer = require('puppeteer-core');
const https = require('https');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PRODUCTION_URL = 'https://lostudio.loloqbh.com';
const LOCAL_URL = 'http://localhost:3456';

function postJSON(baseUrl, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const isHttps = baseUrl.startsWith('https');
    const mod = isHttps ? https : http;
    const url = new URL(path, baseUrl);
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('');
  console.log('='.repeat(50));
  console.log('  Higgsfield 登录助手');
  console.log('='.repeat(50));
  console.log('');
  console.log('  正在打开 Chrome...');
  console.log('  请在弹出的浏览器窗口中登录 Higgsfield');
  console.log('');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--window-size=500,700',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // 隐藏 automation 痕迹
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://higgsfield.ai/auth', { waitUntil: 'networkidle2' });
  console.log('  浏览器已打开，等待你登录...');
  console.log('');

  // 等待登录成功: Clerk.session 出现 (最多等 5 分钟)
  try {
    await page.waitForFunction(() => {
      return window.Clerk && window.Clerk.session && window.Clerk.session.id;
    }, { timeout: 300000, polling: 2000 });
  } catch (e) {
    console.log('  超时: 5 分钟内未检测到登录');
    await browser.close();
    process.exit(1);
  }

  console.log('  检测到登录成功! 正在提取 session...');

  // 提取 session 数据
  const sessionData = await page.evaluate(async () => {
    const token = await window.Clerk.session.getToken();
    const sessionId = window.Clerk.session.id;
    const email = window.Clerk.user?.primaryEmailAddress?.emailAddress || '';
    return { sessionId, currentToken: token, email };
  });

  // 通过 puppeteer 获取 httpOnly 的 __client cookie
  const cookies = await page.cookies('https://clerk.higgsfield.ai');
  const clientCookie = cookies.find(c => c.name === '__client');

  if (!clientCookie) {
    // fallback: 尝试从 higgsfield.ai 域获取
    const cookies2 = await page.cookies('https://higgsfield.ai');
    const clientCookie2 = cookies2.find(c => c.name === '__client');
    if (clientCookie2) sessionData.clientCookie = clientCookie2.value;
  } else {
    sessionData.clientCookie = clientCookie.value;
  }

  console.log(`  邮箱: ${sessionData.email}`);
  console.log(`  Session ID: ${sessionData.sessionId}`);
  console.log(`  Cookie: ${sessionData.clientCookie ? '已获取' : '未找到'}`);
  console.log('');

  if (!sessionData.clientCookie || !sessionData.sessionId) {
    console.log('  错误: 未能获取完整的 session 数据');
    await browser.close();
    process.exit(1);
  }

  // 推送到本地服务器
  try {
    const localResult = await postJSON(LOCAL_URL, '/api/higgsfield/clerk-session-import', sessionData);
    console.log(`  本地服务器: ${localResult.ok ? '已同步' : '失败 - ' + (localResult.error || '')}`);
  } catch (e) {
    console.log(`  本地服务器: 未运行 (跳过)`);
  }

  // 推送到线上服务器
  try {
    const prodResult = await postJSON(PRODUCTION_URL, '/api/higgsfield/clerk-session-import', sessionData);
    console.log(`  线上服务器: ${prodResult.ok ? '已同步' : '失败 - ' + (prodResult.error || '')}`);
  } catch (e) {
    console.log(`  线上服务器: 连接失败 - ${e.message}`);
  }

  console.log('');
  console.log('  完成! 浏览器将在 3 秒后关闭...');
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
  process.exit(0);
})();
