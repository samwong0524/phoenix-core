/**
 * LO Studio Web Backend Server
 * 替代 electron-main.js 的所有 IPC 功能
 *
 * 启动: node server.js
 * 开发: concurrently "vite" "node server.js"
 */

// 备用模块路径：指向 LOStudio-Fork 的完整依赖
try {
  const forkModules = 'F:\\swarm-ide\\backend\\LOStudio-Fork\\node_modules';
  if (require('fs').existsSync(forkModules)) {
    module.paths.unshift(forkModules);
  }
} catch (_) { /* fallback 静默失败 */ }

const dns = require('dns');
// 强制 Node.js DNS 优先使用 IPv4，避免 Windows IPv6 ETIMEDOUT 问题
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3456;

// 数据目录（Electron 打包后用 userData，Web 部署用 __dirname）
const DATA_DIR = process.env.USER_DATA_PATH || __dirname;
// 媒体缓存目录
const MEDIA_CACHE_DIR = path.join(DATA_DIR, 'media-cache');
if (!fs.existsSync(MEDIA_CACHE_DIR)) fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });

// ============================================================================
// Middleware
// ============================================================================

// 支持大 base64 payload (图片/视频)
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.text({ limit: '500mb' }));

// CORS (开发模式 Vite 在 :5173)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================================
// 🌐 核心网络请求函数 (从 electron-main.js 移植)
// ============================================================================

/**
 * 通用 HTTP 请求
 */
function makeHttpRequest(options) {
  return new Promise((resolve, reject) => {
    const { url, method = 'GET', headers = {}, body, timeout = 60000 } = options;

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: { ...headers },
      timeout: timeout
    };

    let bodyData = null;
    if (body) {
      if (body.__binaryBase64) {
        bodyData = Buffer.from(body.__binaryBase64, 'base64');
      } else if (Buffer.isBuffer(body)) {
        bodyData = body;
      } else if (typeof body === 'object') {
        bodyData = JSON.stringify(body);
        if (!requestOptions.headers['Content-Type'] && !requestOptions.headers['content-type']) {
          requestOptions.headers['Content-Type'] = 'application/json';
        }
      } else {
        bodyData = body;
      }
      if (!requestOptions.headers['Content-Length'] && !requestOptions.headers['content-length']) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyData).toString();
      }
    }

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsedData;
        try { parsedData = JSON.parse(data); } catch (e) { parsedData = data; }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          data: parsedData
        });
      });
    });

    req.on('error', (error) => {
      console.error('[API] Request error:', error.message);
      reject(new Error(`Network Error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });

    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// ── 即梦 Puppeteer 浏览器代理 (复刻 Electron ensureJimengWindow 方案) ──
// 在真实浏览器页面上下文中执行 fetch，带完整 cookies + 安全 SDK
let jimengBrowser = null;
let jimengPage = null;
let jimengPageReady = false;
let jimengInitPromise = null; // 防止并发初始化

async function ensureJimengPage(cookieStr) {
  const puppeteer = require('puppeteer');
  const baseUrl = 'https://jimeng.jianying.com';

  // 解析 cookies
  const cookiePairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean);
  const cookies = [];
  for (const pair of cookiePairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    cookies.push({ name, value, domain: '.jianying.com', path: '/', secure: true, sameSite: 'None' });
  }

  // 已有页面且可用 → 更新 cookies 后直接返回
  if (jimengBrowser && jimengPage && jimengPageReady) {
    try {
      await jimengPage.evaluate(() => true);
      if (cookies.length > 0) await jimengPage.setCookie(...cookies);
      return jimengPage;
    } catch (e) {
      jimengPageReady = false;
      try { await jimengBrowser.close(); } catch (_) {}
      jimengBrowser = null; jimengPage = null; jimengInitPromise = null;
    }
  }

  // 防止并发初始化: 如果已经在初始化中，等待完成
  if (jimengInitPromise) {
    await jimengInitPromise;
    if (jimengPage && jimengPageReady) {
      if (cookies.length > 0) await jimengPage.setCookie(...cookies);
      return jimengPage;
    }
  }

  // 启动新浏览器 (加锁)
  jimengInitPromise = (async () => {
    console.log('[Jimeng-Browser] 启动 Puppeteer 浏览器...');
    jimengBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: findHfBrowserPath() || 'chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    jimengPage = await jimengBrowser.newPage();
    await jimengPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await jimengPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    if (cookies.length > 0) await jimengPage.setCookie(...cookies);
    await jimengPage.goto(baseUrl + '/ai-tool/image/generate', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[Jimeng-Browser] 页面加载完成');
    jimengPageReady = true;
  })();
  await jimengInitPromise;
  jimengInitPromise = null;
  return jimengPage;
}

async function makeJimengBrowserRequest(options) {
  const { url, method = 'GET', headers = {}, body } = options;
  const cookieStr = headers['Cookie'] || headers['cookie'] || '';

  // 只传 API 需要的头 (Cookie/Content-Length/Host 由浏览器自动处理)
  const fetchHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower !== 'cookie' && lower !== 'content-length' && lower !== 'host') {
      fetchHeaders[k] = v;
    }
  }

  try {
    const page = await ensureJimengPage(cookieStr);
    const result = await page.evaluate(async (fetchUrl, fetchMethod, fetchHdrs, fetchBody) => {
      try {
        const resp = await fetch(fetchUrl, {
          method: fetchMethod,
          headers: fetchHdrs,
          body: fetchBody || undefined,
          credentials: 'include',
        });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        return { ok: resp.ok, status: resp.status, data };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: e.message };
      }
    }, url, method.toUpperCase(), fetchHeaders, body || null);

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      headers: {},
      data: result.data,
      error: result.error,
    };
  } catch (error) {
    console.error('[Jimeng-Browser] Error:', error.message);
    // 重置浏览器
    jimengPageReady = false;
    try { if (jimengBrowser) await jimengBrowser.close(); } catch (_) {}
    jimengBrowser = null; jimengPage = null;
    throw error;
  }
}

/**
 * FormData 上传
 */
function makeFormDataRequest(options) {
  return new Promise((resolve, reject) => {
    const { url, formData, timeout = 120000, headers: extraHeaders = {} } = options;

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    let bodyParts = [];
    for (const [key, value] of Object.entries(formData)) {
      if (value && typeof value === 'object' && value.type === 'file') {
        const fileContent = Buffer.from(value.data, 'base64');
        bodyParts.push(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"; filename="${value.filename}"\r\n` +
          `Content-Type: ${value.mimeType || 'application/octet-stream'}\r\n\r\n`
        );
        bodyParts.push(fileContent);
        bodyParts.push('\r\n');
      } else {
        bodyParts.push(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
        );
      }
    }
    bodyParts.push(`--${boundary}--\r\n`);

    const bodyBuffers = bodyParts.map(part =>
      Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf-8')
    );
    const bodyBuffer = Buffer.concat(bodyBuffers);

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        ...extraHeaders,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      },
      timeout: timeout
    };

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsedData;
        try { parsedData = JSON.parse(data); } catch (e) { parsedData = data; }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          data: parsedData
        });
      });
    });

    req.on('error', (error) => {
      console.error('[API] Upload error:', error.message);
      reject(new Error(`Network Error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Upload timeout after ${timeout}ms`));
    });

    req.write(bodyBuffer);
    req.end();
  });
}

// ============================================================================
// 🔧 即梦 AWS4 签名 + CRC32 (从 electron-main.js 移植)
// ============================================================================

function createAWS4Signature(method, url, headers, accessKeyId, secretAccessKey, sessionToken, payload, region) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';
  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  const service = 'imagex';

  const searchParams = new URLSearchParams(urlObj.search);
  const queryParams = [];
  searchParams.forEach((value, key) => { queryParams.push([key, value]); });
  queryParams.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const canonicalQueryString = queryParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const headersToSign = { 'x-amz-date': timestamp };
  if (sessionToken) headersToSign['x-amz-security-token'] = sessionToken;

  let payloadHash = crypto.createHash('sha256').update('').digest('hex');
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    headersToSign['x-amz-content-sha256'] = payloadHash;
  }

  const signedHeaders = Object.keys(headersToSign).map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key.toLowerCase()}:${headersToSign[key].trim()}\n`).join('');

  const canonicalRequest = [method.toUpperCase(), pathname, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, credentialScope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');

  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function calculateCRC32(buffer) {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) { crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1); }
    crcTable[i] = crc;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buffer.length; i++) { crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF]; }
  return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

// ============================================================================
// 📡 API 路由
// ============================================================================

// ── 前端调试日志 (转发到服务器日志) ──
app.post('/api/debug-log', (req, res) => {
  const { msg } = req.body || {};
  if (msg) console.log('[FrontendDebug]', msg);
  res.json({ ok: true });
});

// ── 视频上传到 uguu.se 代理（避免浏览器 CORS）──
app.post('/api/upload-to-uguu', async (req, res) => {
  try {
    const { dataUri } = req.body;
    if (!dataUri) return res.json({ ok: false, error: '缺少 dataUri' });
    const mimeMatch = dataUri.match(/^data:(video\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'video/mp4';
    const ext = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    const raw = dataUri.replace(/^data:[^;]+;base64,/, '');
    const tmpFile = path.join(require('os').tmpdir(), `uguu_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpFile, Buffer.from(raw, 'base64'));
    console.log('[upload-to-uguu] tmpFile:', tmpFile, 'size:', fs.statSync(tmpFile).size);

    const { execSync } = require('child_process');
    const curlResult = execSync(
      `curl -s -X POST "https://uguu.se/upload" -F "files[]=@${tmpFile};type=${mimeType}"`,
      { timeout: 120000, encoding: 'utf-8' }
    );
    // 清理临时文件
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    console.log('[upload-to-uguu] curl response:', curlResult.substring(0, 300));
    const data = JSON.parse(curlResult);
    if (!data.success || !data.files?.[0]?.url) {
      return res.json({ ok: false, error: '上传失败: 无URL', detail: data });
    }
    res.json({ ok: true, url: data.files[0].url });
  } catch (err) {
    console.error('[upload-to-uguu] Error:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ── 通用 HTTP 代理 (替代 api-call IPC) ──
app.post('/api/proxy', async (req, res) => {
  try {
    const options = req.body;

    // 检测 multipart form-data 请求
    if (options.body && options.body.__multipart) {
      console.log('[API] Multipart request:', options.method || 'POST', options.url);
      const { __multipart, ...fields } = options.body;
      const formData = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value && typeof value === 'object' && value.base64) {
          formData[key] = { type: 'file', data: value.base64, filename: value.filename || 'file', mimeType: value.contentType || 'application/octet-stream' };
        } else {
          formData[key] = value;
        }
      }
      const result = await makeFormDataRequest({
        url: options.url,
        formData,
        timeout: options.timeout || 120000,
        headers: options.headers || {},
      });
      return res.json(result);
    }

    // 流式请求: body 里有 stream=true 时，直接 pipe SSE 响应回客户端
    if (options.body && options.body.stream === true) {
      console.log('[API] Stream request:', options.method || 'POST', options.url);
      const parsedUrl = new URL(options.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      const bodyStr = JSON.stringify(options.body);
      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: (options.method || 'POST').toUpperCase(),
        headers: {
          ...(options.headers || {}),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };
      const upstream = httpModule.request(reqOpts, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, {
          'Content-Type': upstreamRes.headers['content-type'] || 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Transfer-Encoding': 'chunked',
        });
        upstreamRes.pipe(res);
      });
      upstream.setTimeout(options.timeout || 600000); // 默认10分钟超时
      upstream.on('timeout', () => { upstream.destroy(); });
      upstream.on('error', (e) => {
        console.error('[API] Stream error:', e.message);
        if (!res.headersSent) res.json({ ok: false, status: 0, error: e.message });
      });
      upstream.write(bodyStr);
      upstream.end();
      return;
    }

    // 即梦 aigc_draft/generate 走 Puppeteer 浏览器 (需要完整浏览器上下文通过 shark 风控)
    // 其他即梦请求 (get_upload_token, 积分查询等) 走普通 HTTP
    const isJimengGenerate = options.url && options.url.includes('jimeng.jianying.com') && options.url.includes('aigc_draft/generate');
    console.log('[API] Request:', options.method || 'GET', options.url, isJimengGenerate ? '(via browser)' : '');
    const result = isJimengGenerate
      ? await makeJimengBrowserRequest(options)
      : await makeHttpRequest(options);
    console.log('[API] Response status:', result.status);
    res.json(result);
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.json({ ok: false, status: 0, statusText: 'Network Error', error: error.message });
  }
});

// ── FormData 上传代理 (替代 api-upload IPC) ──
app.post('/api/upload', async (req, res) => {
  try {
    console.log('[API] Upload to:', req.body.url);
    const result = await makeFormDataRequest(req.body);
    console.log('[API] Upload response status:', result.status);
    res.json(result);
  } catch (error) {
    console.error('[API] Upload error:', error.message);
    res.json({ ok: false, status: 0, statusText: 'Network Error', error: error.message });
  }
});

// ── 下载图片返回 data URI (替代 fetch-image-base64 IPC) ──
app.post('/api/fetch-image', async (req, res) => {
  try {
    const { url: imageUrl } = req.body;
    const parsedUrl = new URL(imageUrl);
    const isHfCdn = parsedUrl.hostname.includes('higgsfield.ai');

    // ── HF CDN: 优先通过 HF 浏览器 session 下载（有鉴权，绕过 CDN 限制）──
    if (isHfCdn) {
      // 找到有活跃 HF 浏览器的用户（通常只有 1 个）
      for (const [userId, entry] of hfBrowsers) {
        try {
          const result = await entry.page.evaluate(async (fetchUrl) => {
            try {
              const resp = await fetch(fetchUrl);
              if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
              const blob = await resp.blob();
              const ct = blob.type || 'image/png';
              if (!ct.startsWith('image/')) return { ok: false, error: `Not an image: ${ct}` };
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({ ok: true, dataUri: reader.result });
                reader.onerror = () => resolve({ ok: false, error: 'FileReader error' });
                reader.readAsDataURL(blob);
              });
            } catch (err) {
              return { ok: false, error: err.message };
            }
          }, imageUrl);
          if (result.ok) {
            console.log('[FetchImage] HF CDN downloaded via browser session, size:', result.dataUri?.length || 0);
            return res.json(result);
          }
          console.warn('[FetchImage] HF browser download failed:', result.error);
        } catch (e) {
          console.warn('[FetchImage] HF browser error:', e.message);
        }
        break; // 只试第一个活跃浏览器
      }
    }

    // ── 通用 HTTP 下载 ──
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const result = await new Promise((resolve, reject) => {
      const request = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          ...(!isHfCdn ? { 'Referer': 'https://jimeng.jianying.com/' } : {}),
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
        timeout: 30000,
      }, (response) => {
        // 跟随重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          resolve({ redirect: response.headers.location });
          return;
        }
        // ── 状态码检查：非 2xx 直接报失败 ──
        if (response.statusCode < 200 || response.statusCode >= 300) {
          resolve({ ok: false, error: `HTTP ${response.statusCode}` });
          response.resume(); // 丢弃 body
          return;
        }
        // ── content-type 检查：非图片直接报失败 ──
        const contentType = response.headers['content-type'] || '';
        if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
          resolve({ ok: false, error: `Not an image: ${contentType}` });
          response.resume();
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const mime = contentType || 'image/webp';
          const base64 = buffer.toString('base64');
          resolve({ ok: true, dataUri: `data:${mime};base64,${base64}` });
        });
        response.on('error', (err) => reject(err));
      });
      request.on('error', (err) => reject(err));
      request.on('timeout', () => { request.destroy(); reject(new Error('Image download timeout')); });
      request.end();
    });

    // 处理重定向
    if (result.redirect) {
      const redirectResult = await new Promise((resolve, reject) => {
        const rUrl = new URL(result.redirect);
        const rHttps = rUrl.protocol === 'https:';
        const rModule = rHttps ? https : http;
        const rReq = rModule.request({
          hostname: rUrl.hostname,
          port: rUrl.port || (rHttps ? 443 : 80),
          path: rUrl.pathname + rUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          },
          timeout: 30000,
        }, (rRes) => {
          if (rRes.statusCode < 200 || rRes.statusCode >= 300) {
            resolve({ ok: false, error: `Redirect HTTP ${rRes.statusCode}` });
            rRes.resume();
            return;
          }
          const rContentType = rRes.headers['content-type'] || '';
          if (rContentType && !rContentType.startsWith('image/') && !rContentType.includes('octet-stream')) {
            resolve({ ok: false, error: `Redirect not an image: ${rContentType}` });
            rRes.resume();
            return;
          }
          const chunks = [];
          rRes.on('data', (chunk) => chunks.push(chunk));
          rRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const mime = rContentType || 'image/webp';
            const base64 = buffer.toString('base64');
            resolve({ ok: true, dataUri: `data:${mime};base64,${base64}` });
          });
          rRes.on('error', (err) => reject(err));
        });
        rReq.on('error', (err) => reject(err));
        rReq.on('timeout', () => { rReq.destroy(); reject(new Error('Redirect timeout')); });
        rReq.end();
      });
      return res.json(redirectResult);
    }

    res.json(result);
  } catch (error) {
    console.error('[FetchImage] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── 下载返回 base64 buffer (替代 fetch-as-buffer IPC) ──
app.post('/api/fetch-buffer', async (req, res) => {
  try {
    const { url: targetUrl } = req.body;
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const result = await new Promise((resolve, reject) => {
      const request = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Referer': 'https://jimeng.jianying.com/',
          'Accept': '*/*',
        },
        timeout: 30000,
      }, (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          resolve({ ok: false, error: `HTTP ${response.statusCode}` });
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            ok: true,
            bufferBase64: buffer.toString('base64'),
            contentType: response.headers['content-type'] || ''
          });
        });
        response.on('error', (err) => reject(err));
      });
      request.on('error', (err) => reject(err));
      request.on('timeout', () => { request.destroy(); reject(new Error('Download timeout')); });
      request.end();
    });

    res.json(result);
  } catch (error) {
    console.error('[FetchBuffer] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── 自动保存到输出文件夹 ──
app.post('/api/output/save', async (req, res) => {
  try {
    const { outputDir, projectName, fileName, data, type, scenePrefix } = req.body;
    if (!outputDir || !projectName || !fileName || !data) {
      return res.json({ ok: false, error: '缺少参数' });
    }

    const fs = require('fs');
    const path = require('path');

    // 创建 输出路径/LOStudio/项目名/ 文件夹
    const folder = path.join(outputDir, 'LOStudio', projectName.replace(/[<>:"/\\|?*]/g, '_'));
    fs.mkdirSync(folder, { recursive: true });

    let finalFileName = fileName;
    // 分镜文件: 扫描文件夹找下一个可用序号
    if (scenePrefix) {
      const ext = path.extname(fileName);
      const existing = fs.readdirSync(folder).filter(f => f.startsWith(scenePrefix + '_') && f.endsWith(ext));
      let maxSeq = 0;
      for (const f of existing) {
        const m = f.match(new RegExp(`^${scenePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\${ext}$`));
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1]));
      }
      finalFileName = `${scenePrefix}_${maxSeq + 1}${ext}`;
    }

    const filePath = path.join(folder, finalFileName);

    // data 可能是 base64 data URI 或普通 base64
    let buffer;
    if (data.startsWith('data:')) {
      const base64Part = data.split(',')[1];
      buffer = Buffer.from(base64Part, 'base64');
    } else {
      buffer = Buffer.from(data, 'base64');
    }

    fs.writeFileSync(filePath, buffer);
    console.log(`[Output] 已保存: ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    res.json({ ok: true, path: filePath });
  } catch (error) {
    console.error('[Output] 保存失败:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── 下载代理 (浏览器下载用) ──
app.post('/api/download-proxy', async (req, res) => {
  try {
    const { url: targetUrl } = req.body;

    let realUrl = targetUrl;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };

    // 兼容旧 jimeng-media:// URL
    if (targetUrl.startsWith('jimeng-media://cdn/')) {
      realUrl = decodeURIComponent(targetUrl.replace('jimeng-media://cdn/', ''));
      headers['Referer'] = 'https://jimeng.jianying.com/';
    } else if (targetUrl.startsWith('jimeng-media://local/')) {
      const fileName = decodeURIComponent(targetUrl.replace('jimeng-media://local/', ''));
      const filePath = path.join(MEDIA_CACHE_DIR, fileName);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).json({ ok: false, error: 'File not found' });
    }
    // 兼容新 /api/media/jimeng/ URL
    if (targetUrl.startsWith('/api/media/jimeng/local/')) {
      const fileName = decodeURIComponent(targetUrl.replace('/api/media/jimeng/local/', ''));
      const filePath = path.join(MEDIA_CACHE_DIR, fileName);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).json({ ok: false, error: 'File not found' });
    }

    const parsedUrl = new URL(realUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const request = httpModule.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout: 120000,
    }, (response) => {
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      response.pipe(res);
    });

    request.on('error', (err) => {
      console.error('[DownloadProxy] Error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    });
    request.end();
  } catch (error) {
    console.error('[DownloadProxy] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 🎬 抖音视频下载 (用于视频反推)
// ============================================================================

// 通用 HTTP GET，自动跟随重定向（最多 5 次）
function httpGet(url, customHeaders = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...customHeaders,
      },
      timeout: 30000,
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (redirectUrl.startsWith('/')) redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        return resolve(httpGet(redirectUrl, customHeaders, maxRedirects - 1));
      }
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.end();
  });
}

app.post('/api/douyin/download', async (req, res) => {
  try {
    const { url: douyinUrl } = req.body;
    if (!douyinUrl) return res.json({ ok: false, error: '请提供抖音链接' });
    console.log('[Douyin] 开始解析:', douyinUrl);

    // Step 1: 从短链接 redirect 提取 aweme_id
    let finalUrl = douyinUrl;
    let awemeId = null;

    // 用 GET 跟踪 redirect，拿到 Location 后断开
    const resolveRedirects = (url, remaining = 8) => {
      return new Promise((resolve, reject) => {
        if (remaining <= 0) return resolve(url);
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const mod = isHttps ? https : http;
        const r = mod.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,*/*',
          },
          timeout: 15000,
        }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.destroy();
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
            return resolve(resolveRedirects(redirectUrl, remaining - 1));
          }
          response.destroy();
          resolve(url);
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Redirect resolve timeout')); });
        r.end();
      });
    };

    finalUrl = await resolveRedirects(douyinUrl);
    console.log('[Douyin] 最终URL:', finalUrl);

    // 提取 aweme_id
    const idMatch = finalUrl.match(/(?:video|note)\/(\d+)/) || finalUrl.match(/modal_id=(\d+)/);
    if (idMatch) awemeId = idMatch[1];
    if (!awemeId) {
      const numMatch = douyinUrl.match(/(\d{15,})/);
      if (numMatch) awemeId = numMatch[1];
    }
    if (!awemeId) {
      return res.json({ ok: false, error: '无法从链接中提取视频ID' });
    }
    console.log('[Douyin] aweme_id:', awemeId);

    // Step 2: 用 Puppeteer 打开页面，拦截视频请求
    // 利用项目已有的 puppeteer-core + 本地 Chrome
    let videoUrl = null;
    const puppeteer = require('puppeteer-core');

    // 查找 Chrome 路径
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    let chromePath = null;
    for (const p of chromePaths) {
      try { if (require('fs').existsSync(p)) { chromePath = p; break; } } catch (e) {}
    }
    if (!chromePath) {
      return res.json({ ok: false, error: '未找到 Chrome，无法解析抖音视频' });
    }

    console.log('[Douyin] 启动 Puppeteer 解析...');
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
    });

    try {
      const page = await browser.newPage();
      // 桌面 UA（无水印）
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 720 });

      // 拦截网络请求，找到视频 URL
      // 过滤掉页面装饰用的小视频（如 uuu_265.mp4），只要真正的内容视频
      const videoUrlPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 25000);
        // 用 response 拦截，可以检查 content-length 过滤小文件
        page.on('response', async (response) => {
          const url = response.url();
          const ct = response.headers()['content-type'] || '';
          const cl = parseInt(response.headers()['content-length'] || '0', 10);

          // 必须是视频类型或视频 CDN 域名
          const isVideoDomain = url.includes('douyinvod.com') || url.includes('bytevcloudcdn.com') || url.includes('bytecdn.cn');
          const isVideoType = ct.includes('video/');

          if (isVideoDomain || isVideoType) {
            // 过滤掉小于 500KB 的装饰视频
            if (cl > 0 && cl < 512000) {
              console.log('[Douyin] 跳过小视频:', url.substring(0, 80), `(${(cl/1024).toFixed(0)}KB)`);
              return;
            }
            // 过滤掉明显的静态资源（如 douyinstatic.com 上的 UI 素材）
            if (url.includes('douyinstatic.com')) {
              console.log('[Douyin] 跳过静态资源:', url.substring(0, 80));
              return;
            }
            clearTimeout(timer);
            console.log('[Douyin] 拦截到视频:', url.substring(0, 120), cl > 0 ? `(${(cl/1024/1024).toFixed(1)}MB)` : '');
            resolve(url);
          }
        });
      });

      const pageUrl = `https://www.douyin.com/video/${awemeId}`;
      console.log('[Douyin] Puppeteer 打开:', pageUrl);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

      // 等 video 标签出现，从 DOM 直接读取视频 src
      try {
        await page.waitForSelector('video', { timeout: 10000 });
        // 等一下让视频加载 src
        await new Promise(r => setTimeout(r, 2000));
        const videoSrc = await page.evaluate(() => {
          // 找所有 video 标签，取有 CDN 域名的（排除装饰视频）
          const videos = document.querySelectorAll('video');
          for (const v of videos) {
            const src = v.src || v.currentSrc || (v.querySelector('source') || {}).src || '';
            if (src.startsWith('http') && !src.includes('douyinstatic.com') &&
                (src.includes('douyinvod.com') || src.includes('bytevcloudcdn.com') || src.includes('bytecdn.cn') || src.includes('.mp4'))) {
              return src;
            }
          }
          // 兜底：拿第一个有 src 的 video
          for (const v of videos) {
            const src = v.src || v.currentSrc || '';
            if (src.startsWith('http') && !src.includes('douyinstatic.com')) return src;
          }
          return null;
        });
        if (videoSrc) {
          videoUrl = videoSrc;
          console.log('[Douyin] 从 video 标签获取:', videoSrc.substring(0, 120));
        }
      } catch (e) {
        console.log('[Douyin] 等待 video 标签:', e.message);
      }

      // 如果还没拿到，等网络拦截
      if (!videoUrl) {
        videoUrl = await videoUrlPromise;
      }
      console.log('[Douyin] Puppeteer 最终结果:', videoUrl ? videoUrl.substring(0, 120) + '...' : 'null');
    } finally {
      await browser.close();
    }

    if (!videoUrl) {
      return res.json({ ok: false, error: '无法获取视频下载地址，页面加载超时' });
    }

    // Step 3: 下载视频
    console.log('[Douyin] 开始下载视频...');
    const videoResult = await httpGet(videoUrl, {
      'Referer': 'https://www.douyin.com/',
    });

    if (videoResult.status !== 200) {
      return res.json({ ok: false, error: `视频下载失败 (HTTP ${videoResult.status})` });
    }

    const rawSizeMB = (videoResult.body.length / 1024 / 1024).toFixed(1);
    console.log(`[Douyin] 视频下载成功, ${rawSizeMB}MB`);

    // 压缩视频（降低分辨率和码率，减少 Gemini 处理时间）
    let finalBuffer = videoResult.body;
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && parseFloat(rawSizeMB) > 2) {
      try {
        const tmpDir = require('os').tmpdir();
        const tmpIn = require('path').join(tmpDir, `dy_in_${Date.now()}.mp4`);
        const tmpOut = require('path').join(tmpDir, `dy_out_${Date.now()}.mp4`);
        require('fs').writeFileSync(tmpIn, videoResult.body);

        console.log('[Douyin] ffmpeg 压缩中...');
        const { execSync } = require('child_process');
        // 720p, crf 23, 去音轨
        execSync(`"${ffmpegPath}" -i "${tmpIn}" -vf "scale='min(720,iw)':-2" -c:v libx264 -preset ultrafast -crf 23 -an -y "${tmpOut}"`, {
          timeout: 60000,
          stdio: 'pipe',
        });
        const compressedBuffer = require('fs').readFileSync(tmpOut);
        const compressedMB = (compressedBuffer.length / 1024 / 1024).toFixed(1);
        if (compressedBuffer.length < videoResult.body.length) {
          finalBuffer = compressedBuffer;
          console.log(`[Douyin] 压缩有效: ${rawSizeMB}MB → ${compressedMB}MB`);
        } else {
          console.log(`[Douyin] 压缩后更大(${compressedMB}MB)，保留原始(${rawSizeMB}MB)`);
        }

        // 清理临时文件
        try { require('fs').unlinkSync(tmpIn); } catch (e) {}
        try { require('fs').unlinkSync(tmpOut); } catch (e) {}
      } catch (e) {
        console.log('[Douyin] ffmpeg 压缩失败，使用原始视频:', e.message);
      }
    }

    const base64 = finalBuffer.toString('base64');
    const dataUri = `data:video/mp4;base64,${base64}`;
    const sizeMB = (finalBuffer.length / 1024 / 1024).toFixed(1);

    res.json({ ok: true, dataUri, contentType: 'video/mp4', sizeMB });
  } catch (error) {
    console.error('[Douyin] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// 视频压缩端点（给反推分析用，减小发给 AI 的视频体积）
app.post('/api/video/compress', async (req, res) => {
  try {
    const { dataUri } = req.body;
    if (!dataUri) return res.json({ ok: false, error: '无视频数据' });

    // 提取 base64 数据
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.json({ ok: false, error: '无效的 dataUri' });

    const buffer = Buffer.from(match[2], 'base64');
    const rawMB = (buffer.length / 1024 / 1024).toFixed(1);

    // 小于 2MB 不压缩
    if (buffer.length < 2 * 1024 * 1024) {
      return res.json({ ok: true, dataUri, sizeMB: rawMB, compressed: false });
    }

    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) return res.json({ ok: true, dataUri, sizeMB: rawMB, compressed: false });

    const tmpDir = require('os').tmpdir();
    const tmpIn = require('path').join(tmpDir, `vc_in_${Date.now()}.mp4`);
    const tmpOut = require('path').join(tmpDir, `vc_out_${Date.now()}.mp4`);
    require('fs').writeFileSync(tmpIn, buffer);

    console.log(`[VideoCompress] 压缩中... ${rawMB}MB`);
    const { execSync } = require('child_process');
    execSync(`"${ffmpegPath}" -i "${tmpIn}" -vf "scale='min(720,iw)':-2" -c:v libx264 -preset ultrafast -crf 28 -an -y "${tmpOut}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });

    const outBuffer = require('fs').readFileSync(tmpOut);
    const compressedMB = (outBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[VideoCompress] ${rawMB}MB → ${compressedMB}MB`);

    try { require('fs').unlinkSync(tmpIn); } catch (e) {}
    try { require('fs').unlinkSync(tmpOut); } catch (e) {}

    const outBase64 = outBuffer.toString('base64');
    res.json({ ok: true, dataUri: `data:video/mp4;base64,${outBase64}`, sizeMB: compressedMB, compressed: true });
  } catch (error) {
    console.error('[VideoCompress] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// 视频裁剪 API — ffmpeg 按时间段截取片段
app.post('/api/video/trim', async (req, res) => {
  try {
    const { dataUri, startTime, endTime } = req.body;
    if (!dataUri) return res.json({ ok: false, error: '无视频数据' });
    if (startTime == null || endTime == null || endTime <= startTime) {
      return res.json({ ok: false, error: '无效的时间范围' });
    }

    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.json({ ok: false, error: '无效的 dataUri' });

    const buffer = Buffer.from(match[2], 'base64');
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) return res.json({ ok: false, error: 'ffmpeg 不可用' });

    const tmpDir = require('os').tmpdir();
    const ts = Date.now();
    const tmpIn = require('path').join(tmpDir, `vt_in_${ts}.mp4`);
    const tmpOut = require('path').join(tmpDir, `vt_out_${ts}.mp4`);
    require('fs').writeFileSync(tmpIn, buffer);

    const duration = (endTime - startTime).toFixed(3);
    const ss = startTime.toFixed(3);
    console.log(`[VideoTrim] 裁剪 ${ss}s → +${duration}s`);

    const { execSync } = require('child_process');
    execSync(`"${ffmpegPath}" -ss ${ss} -i "${tmpIn}" -t ${duration} -c:v libx264 -preset ultrafast -crf 23 -c:a aac -y "${tmpOut}"`, {
      timeout: 120000,
      stdio: 'pipe',
    });

    const outBuffer = require('fs').readFileSync(tmpOut);
    const sizeMB = (outBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[VideoTrim] 完成, ${sizeMB}MB`);

    try { require('fs').unlinkSync(tmpIn); } catch (e) {}
    try { require('fs').unlinkSync(tmpOut); } catch (e) {}

    const outBase64 = outBuffer.toString('base64');
    res.json({ ok: true, dataUri: `data:video/mp4;base64,${outBase64}`, sizeMB });
  } catch (error) {
    console.error('[VideoTrim] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// webm → mp4 转换 API — 视频画线后转为通用 mp4 格式
app.post('/api/video/webm-to-mp4', async (req, res) => {
  try {
    const { dataUri, duration } = req.body;
    if (!dataUri) return res.json({ ok: false, error: '无视频数据' });

    // 用 ;base64, 分割（MIME 可能含分号如 video/webm;codecs=vp8）
    const b64Idx = dataUri.indexOf(';base64,');
    if (b64Idx === -1) return res.json({ ok: false, error: '无效的 dataUri' });

    const buffer = Buffer.from(dataUri.slice(b64Idx + 8), 'base64');
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) return res.json({ ok: false, error: 'ffmpeg 不可用' });

    const tmpDir = require('os').tmpdir();
    const ts = Date.now();
    const tmpIn = require('path').join(tmpDir, `w2m_in_${ts}.webm`);
    const tmpOut = require('path').join(tmpDir, `w2m_out_${ts}.mp4`);
    require('fs').writeFileSync(tmpIn, buffer);

    console.log(`[WebmToMp4] 转换中... ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    // -r 30 在 -i 前面：强制以 30fps 读取输入（完全忽略 webm 破损的时间戳）
    // -vf setpts: 从 0 开始重排时间戳
    // -t duration: 限定输出时长
    // -movflags +faststart: moov atom 前置（缩略图+播放器正确读时长）
    const fps = 30;
    const durationFlag = duration && isFinite(Number(duration)) ? `-t ${Number(duration).toFixed(3)}` : '';
    const { execSync } = require('child_process');
    execSync(`"${ffmpegPath}" -r ${fps} -i "${tmpIn}" -vf "setpts=N/${fps}/TB" -r ${fps} ${durationFlag} -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -movflags +faststart -an -y "${tmpOut}"`, {
      timeout: 120000,
      stdio: 'pipe',
    });

    const outBuffer = require('fs').readFileSync(tmpOut);
    const sizeMB = (outBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[WebmToMp4] 完成, ${sizeMB}MB`);

    try { require('fs').unlinkSync(tmpIn); } catch (e) {}
    try { require('fs').unlinkSync(tmpOut); } catch (e) {}

    const outBase64 = outBuffer.toString('base64');
    res.json({ ok: true, dataUri: `data:video/mp4;base64,${outBase64}`, sizeMB });
  } catch (error) {
    console.error('[WebmToMp4] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// 音频裁剪 API — ffmpeg 按时间段截取音频片段
app.post('/api/audio/trim', async (req, res) => {
  try {
    const { mediaId, startTime, endTime } = req.body;
    if (!mediaId) return res.json({ ok: false, error: '无 mediaId' });
    if (startTime == null || endTime == null || endTime <= startTime) {
      return res.json({ ok: false, error: '无效的时间范围' });
    }

    // 从 IndexedDB 读不到（server 端没有），前端需要传 dataUri
    const dataUri = req.body.dataUri;
    if (!dataUri) return res.json({ ok: false, error: '无音频数据' });

    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.json({ ok: false, error: '无效的 dataUri' });

    const buffer = Buffer.from(match[2], 'base64');
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) return res.json({ ok: false, error: 'ffmpeg 不可用' });

    const tmpDir = require('os').tmpdir();
    const ts = Date.now();
    const ext = match[1].includes('wav') ? 'wav' : match[1].includes('ogg') ? 'ogg' : 'mp3';
    const tmpIn = require('path').join(tmpDir, `at_in_${ts}.${ext}`);
    const tmpOut = require('path').join(tmpDir, `at_out_${ts}.wav`);
    require('fs').writeFileSync(tmpIn, buffer);

    const duration = (endTime - startTime).toFixed(3);
    const ss = startTime.toFixed(3);
    console.log(`[AudioTrim] 裁剪 ${ss}s → +${duration}s`);

    const { execSync } = require('child_process');
    execSync(`"${ffmpegPath}" -ss ${ss} -i "${tmpIn}" -t ${duration} -acodec pcm_s16le -ar 44100 -ac 2 -y "${tmpOut}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });

    const outBuffer = require('fs').readFileSync(tmpOut);
    const sizeMB = (outBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[AudioTrim] 完成, ${sizeMB}MB`);

    try { require('fs').unlinkSync(tmpIn); } catch (e) {}
    try { require('fs').unlinkSync(tmpOut); } catch (e) {}

    const outBase64 = outBuffer.toString('base64');
    res.json({ ok: true, dataUri: `data:audio/wav;base64,${outBase64}`, sizeMB });
  } catch (error) {
    console.error('[AudioTrim] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 🎨 即梦 (Jimeng) 路由
// ============================================================================

// ── 即梦 Proof 上传 (替代 jimeng-proof-upload IPC) ──
app.post('/api/jimeng/proof-upload', async (req, res) => {
  try {
    const { base64Data, fileName, mimeType, headers: proofHeaders, queryParams } = req.body;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    console.log(`[Jimeng Proof Upload] Starting, size=${imageBuffer.length}, file=${fileName}`);

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 15);
    const formHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType || 'image/png'}\r\n\r\n`
    );
    const formFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    const formBody = Buffer.concat([formHeader, imageBuffer, formFooter]);

    const baseUrl = 'https://imagex.bytedanceapi.com/';
    const urlParams = new URLSearchParams(queryParams || {});
    const fullUrl = `${baseUrl}?${urlParams.toString()}`;

    const uploadResult = await makeHttpRequest({
      url: fullUrl,
      method: 'POST',
      headers: {
        ...(proofHeaders || {}),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formBody.length.toString(),
        'Origin': 'https://jimeng.jianying.com',
        'Referer': 'https://jimeng.jianying.com/ai-tool/generate',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      body: formBody,
      timeout: 60000,
    });

    if (!uploadResult.ok) {
      throw new Error(`Upload failed: status=${uploadResult.status}`);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[Jimeng Proof Upload] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── 即梦 AWS4 上传 (替代 jimeng-upload IPC) ──
app.post('/api/jimeng/upload', async (req, res) => {
  try {
    const { base64Data, credentials } = req.body;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const fileSize = imageBuffer.length;
    const serviceId = credentials.service_id;
    const imageXHost = 'https://imagex.bytedanceapi.com';
    const awsRegion = 'cn-north-1';
    const origin = 'https://jimeng.jianying.com';

    console.log(`[Jimeng Upload] Starting upload, size=${fileSize}, serviceId=${serviceId}`);

    // Step 1: ApplyImageUpload
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const randomStr = Math.random().toString(36).substring(2, 10);
    const applyUrl = `${imageXHost}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${serviceId}&FileSize=${fileSize}&s=${randomStr}`;

    const applyHeaders = { 'x-amz-date': timestamp, 'x-amz-security-token': credentials.session_token };
    const applyAuth = createAWS4Signature('GET', applyUrl, applyHeaders, credentials.access_key_id, credentials.secret_access_key, credentials.session_token, '', awsRegion);

    console.log('[Jimeng Upload] Step 1: ApplyImageUpload');
    const applyResult = await makeHttpRequest({
      url: applyUrl,
      method: 'GET',
      headers: {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'authorization': applyAuth,
        'origin': origin,
        'referer': `${origin}/ai-tool/generate`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-amz-date': timestamp,
        'x-amz-security-token': credentials.session_token,
      },
      timeout: 30000,
    });

    const applyData = applyResult.data;
    const uploadAddress = applyData?.Result?.UploadAddress;
    if (!uploadAddress?.StoreInfos?.[0]) {
      throw new Error(`ApplyImageUpload failed: ${JSON.stringify(applyData).slice(0, 300)}`);
    }

    const storeUri = uploadAddress.StoreInfos[0].StoreUri;
    const storeAuth = uploadAddress.StoreInfos[0].Auth;
    const uploadHost = uploadAddress.UploadHosts[0];
    const sessionKey = uploadAddress.SessionKey;

    // Step 2: Upload Binary
    const crc32 = calculateCRC32(imageBuffer);
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeUri}`;

    console.log('[Jimeng Upload] Step 2: Upload binary');
    const uploadHeaders = {
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Authorization': storeAuth,
      'Connection': 'keep-alive',
      'Content-CRC32': crc32,
      'Content-Disposition': 'attachment; filename="image.png"',
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString(),
      'Origin': origin,
      'Referer': `${origin}/ai-tool/generate`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    };

    let uploadResult;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        uploadResult = await makeHttpRequest({
          url: uploadUrl, method: 'POST', headers: uploadHeaders,
          body: imageBuffer, timeout: 120000,
        });
        if (uploadResult.ok) break;
        console.warn(`[Jimeng Upload] Step 2 attempt ${attempt} failed: status=${uploadResult.status}`);
      } catch (e) {
        console.warn(`[Jimeng Upload] Step 2 attempt ${attempt} error:`, e.message);
        if (attempt === 3) throw e;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }

    if (!uploadResult || !uploadResult.ok) {
      throw new Error(`Upload binary failed after 3 attempts`);
    }

    // Step 3: CommitImageUpload
    const commitNow = new Date();
    const commitTimestamp = commitNow.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const commitPayload = JSON.stringify({ SessionKey: sessionKey });
    const commitUrl = `${imageXHost}/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${serviceId}`;

    const commitHeaders = {
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': credentials.session_token,
      'x-amz-content-sha256': crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex'),
    };
    const commitAuth = createAWS4Signature('POST', commitUrl, commitHeaders, credentials.access_key_id, credentials.secret_access_key, credentials.session_token, commitPayload, awsRegion);

    console.log('[Jimeng Upload] Step 3: CommitImageUpload');
    const commitResult = await makeHttpRequest({
      url: commitUrl,
      method: 'POST',
      headers: {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'authorization': commitAuth,
        'content-type': 'application/json',
        'origin': origin,
        'referer': `${origin}/ai-tool/generate`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-amz-date': commitTimestamp,
        'x-amz-security-token': credentials.session_token,
        'x-amz-content-sha256': commitHeaders['x-amz-content-sha256'],
      },
      body: commitPayload,
      timeout: 30000,
    });

    const commitData = commitResult.data;
    const resultUri = commitData?.Result?.Results?.[0]?.Uri;
    const uriStatus = commitData?.Result?.Results?.[0]?.UriStatus;

    if (!resultUri || uriStatus !== 2000) {
      throw new Error(`CommitImageUpload failed: status=${uriStatus}`);
    }

    console.log(`[Jimeng Upload] All 3 steps done! uri=${resultUri}`);
    res.json({ ok: true, uri: resultUri });
  } catch (error) {
    console.error('[Jimeng Upload] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── 即梦 CDN 代理 (替代 jimeng-media://cdn/) ──
app.get('/api/media/jimeng/cdn/:encoded', async (req, res) => {
  try {
    const realUrl = decodeURIComponent(req.params.encoded);
    const parsedUrl = new URL(realUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const request = httpModule.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Referer': realUrl.includes('capcut.com') ? 'https://dreamina.capcut.com/' : 'https://jimeng.jianying.com/',
        'Accept': '*/*',
      },
      timeout: 60000,
    }, (response) => {
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      // 允许浏览器缓存
      res.setHeader('Cache-Control', 'public, max-age=86400');
      response.pipe(res);
    });

    request.on('error', (err) => {
      console.error('[JimengCDN] Error:', err.message);
      res.status(502).json({ error: err.message });
    });
    request.end();
  } catch (error) {
    console.error('[JimengCDN] Error:', error.message);
    res.status(502).json({ error: error.message });
  }
});

// ── 即梦本地缓存文件 (替代 jimeng-media://local/) ──
app.get('/api/media/jimeng/local/:filename', (req, res) => {
  try {
    const fileName = decodeURIComponent(req.params.filename);
    const filePath = path.join(MEDIA_CACHE_DIR, fileName);

    // 安全检查
    if (fileName.includes('..') || !filePath.startsWith(MEDIA_CACHE_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (error) {
    console.error('[JimengLocal] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 持久化媒体 (替代 persist-media IPC) ──
app.post('/api/media/persist', async (req, res) => {
  try {
    const { url, mediaId, ext } = req.body;

    let realUrl = url;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };

    // 兼容旧 jimeng-media:// URL
    if (url.startsWith('jimeng-media://cdn/')) {
      realUrl = decodeURIComponent(url.replace('jimeng-media://cdn/', ''));
      headers['Referer'] = 'https://jimeng.jianying.com/';
    }

    const fileName = `${mediaId}.${ext}`;
    const filePath = path.join(MEDIA_CACHE_DIR, fileName);

    console.log('[PersistMedia] Downloading to:', filePath);

    const parsedUrl = new URL(realUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    await new Promise((resolve, reject) => {
      const request = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: 120000,
      }, (response) => {
        if (response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        fileStream.on('finish', () => resolve());
        fileStream.on('error', (err) => reject(err));
      });
      request.on('error', (err) => reject(err));
      request.on('timeout', () => { request.destroy(); reject(new Error('Download timeout')); });
      request.end();
    });

    const size = fs.statSync(filePath).size;
    const localUrl = `/api/media/jimeng/local/${encodeURIComponent(fileName)}`;
    console.log('[PersistMedia] Cached:', fileName, 'Size:', size);
    res.json({ ok: true, localUrl, size });
  } catch (error) {
    console.error('[PersistMedia] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 🔐 用户认证 & 数据同步（提前初始化，供 RPA 路由使用 authMiddleware）
// ============================================================================
const setupAuth = require('./auth');
setupAuth(app);
const authMiddleware = setupAuth.authMiddleware;
const verifyToken = setupAuth.verifyToken;

// ============================================================================
// 🎯 即梦 RPA 路由 (浏览器自动化 — 多用户版)
// ============================================================================

const JimengRPA = require('./jimeng-rpa');
const jimengRPA = new JimengRPA();
const WebSocketLib = require('ws');

// 即梦多账号: account=2 时使用独立 session（userId 加后缀）
function jimengUserId(req) {
  const account = req.query?.account || req.body?.account;
  if (account === '2') return `${req.user.id}_account2`;
  if (account === 'dreamina') return `${req.user.id}_dreamina`;
  return req.user.id;
}

// 打开浏览器（用户手动登录）
app.post('/api/jimeng/rpa/open-browser', authMiddleware, async (req, res) => {
  try {
    const result = await jimengRPA.openBrowserForUser(jimengUserId(req));
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 浏览器状态
app.get('/api/jimeng/rpa/browser-status', authMiddleware, async (req, res) => {
  try {
    const uid = jimengUserId(req);
    // 账号2 / Dreamina 如果没有活跃 session，直接返回离线，不触发创建
    if ((uid.endsWith('_account2') || uid.endsWith('_dreamina')) && !jimengRPA.userSessions.has(uid)) {
      return res.json({ ok: true, browserOpen: false, loggedIn: false });
    }
    const result = await jimengRPA.getBrowserStatusForUser(uid);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 调试: 查看所有任务状态
app.get('/api/jimeng/rpa/debug-tasks', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const session = jimengRPA.userSessions.get(userId);
  const tasks = [];
  if (session) {
    for (const [id, t] of session.tasks) {
      tasks.push({ id, type: t.type, status: t.status, error: t.error, progress: t.progress, createdAt: t.createdAt });
    }
  }
  res.json({
    processing: session?.processing || false,
    currentTaskId: session?.currentTaskId || null,
    queueLength: session?.taskQueue?.length || 0,
    queue: session?.taskQueue?.slice() || [],
    tasks
  });
});

// 关闭浏览器
app.post('/api/jimeng/rpa/close-browser', authMiddleware, async (req, res) => {
  try {
    const result = await jimengRPA.closeBrowserForUser(jimengUserId(req));
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 登录状态
app.get('/api/jimeng/rpa/login-status', authMiddleware, async (req, res) => {
  try {
    const status = await jimengRPA.getLoginStatus(jimengUserId(req));
    res.json({ ok: true, ...status });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// QR 码登录 — 获取 QR 码图片
app.post('/api/jimeng/rpa/login-qr', authMiddleware, async (req, res) => {
  try {
    const result = await jimengRPA.startQRLogin(req.user.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// QR 码登录 — 轮询登录状态
app.get('/api/jimeng/rpa/login-poll', authMiddleware, (req, res) => {
  const session = jimengRPA.userSessions.get(req.user.id);
  res.json({ ok: true, status: session?.loginStatus || 'idle' });
});

// Session ID 导入（兜底）
app.post('/api/jimeng/rpa/login-session', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.json({ ok: false, error: '缺少 sessionId' });
    const result = await jimengRPA.importSession(req.user.id, sessionId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 退出登录
app.post('/api/jimeng/rpa/logout', authMiddleware, async (req, res) => {
  const result = await jimengRPA.logout(jimengUserId(req));
  res.json(result);
});

// 图片生成
app.post('/api/jimeng/rpa/generate-image', authMiddleware, async (req, res) => {
  try {
    const { prompt, model, aspectRatio, resolution, referenceImages, account, maxPages } = req.body;
    if (!prompt) return res.json({ ok: false, error: '缺少提示词' });
    const uid = jimengUserId(req);
    if (typeof maxPages === 'number') try { jimengRPA.setMaxPages(uid, maxPages); } catch {}
    const taskId = jimengRPA.enqueueTask(uid, 'image', { prompt, model, aspectRatio, resolution, referenceImages, account });
    res.json({ ok: true, taskId });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 视频生成
app.post('/api/jimeng/rpa/generate-video', authMiddleware, async (req, res) => {
  try {
    const { prompt, model, aspectRatio, duration, mode, referenceImages, referenceVideos, referenceAudios, inputTypes, nodeId, account, resolution, maxPages } = req.body;
    if (!prompt) return res.json({ ok: false, error: '缺少提示词' });
    const uid = jimengUserId(req);
    if (typeof maxPages === 'number') try { jimengRPA.setMaxPages(uid, maxPages); } catch {}
    const taskId = jimengRPA.enqueueTask(uid, 'video', { prompt, model, aspectRatio, duration, mode, referenceImages, referenceVideos, referenceAudios, inputTypes, nodeId, resolution });
    res.json({ ok: true, taskId });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 轮询任务状态（taskId 全局唯一，无需 auth 也可查询）
app.get('/api/jimeng/rpa/task/:taskId', (req, res) => {
  const task = jimengRPA.getTaskStatus(req.params.taskId);
  if (!task) return res.json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, ...task });
});

// 取消任务（taskId 里可能包含 account2 的任务，需要两个 session 都查）
app.post('/api/jimeng/rpa/cancel-task/:nodeId', authMiddleware, (req, res) => {
  try {
    let cancelled = jimengRPA.cancelTask(req.user.id, req.params.nodeId);
    if (!cancelled) cancelled = jimengRPA.cancelTask(`${req.user.id}_account2`, req.params.nodeId);
    if (!cancelled) cancelled = jimengRPA.cancelTask(`${req.user.id}_dreamina`, req.params.nodeId);
    res.json({ ok: true, cancelled });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 设置最大并行页面数
app.post('/api/jimeng/rpa/set-max-pages', authMiddleware, (req, res) => {
  try {
    const { maxPages } = req.body;
    if (typeof maxPages !== 'number') return res.json({ ok: false, error: '缺少 maxPages' });
    const result = jimengRPA.setMaxPages(jimengUserId(req), maxPages);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 获取 worker pool 状态
app.get('/api/jimeng/rpa/worker-status', authMiddleware, (req, res) => {
  const session = jimengRPA.userSessions.get(req.user.id);
  if (!session) return res.json({ ok: false, error: '无活跃会话' });
  res.json({ ok: true, ...jimengRPA._getWorkerStatus(session) });
});

// HD 视频下载（按需：打开详情弹窗 → 点下载 → 拦截原始 URL）
app.post('/api/jimeng/rpa/download-hd', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.json({ ok: false, error: '缺少 taskId' });
    const session = await jimengRPA.getSession(req.user.id);
    const hdUrl = await jimengRPA.downloadHDVideo(session.page, taskId);
    session.touch();
    res.json({ ok: true, url: hdUrl });
  } catch (e) {
    console.error('[Server] download-hd error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// [临时测试] 点开弹窗读 video.src，测完删
app.post('/api/jimeng/rpa/test-video-src', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.json({ ok: false, error: '缺少 taskId' });
    const session = await jimengRPA.getSession(req.user.id);
    const page = session.page;

    // 1. 点击视频打开弹窗
    const clickResult = await page.evaluate((tid) => {
      const record = document.querySelector('[data-lo-task="' + tid + '"]');
      if (!record) return { ok: false, error: '找不到标记记录' };
      const container = record.closest('[class*=item-]') || record.parentElement?.parentElement || record.parentElement;
      if (!container) return { ok: false, error: '找不到容器' };
      const video = container.querySelector('video');
      if (!video) return { ok: false, error: '找不到视频元素' };
      video.click();
      return { ok: true, cardVideoSrc: video.src || video.currentSrc || '(empty)' };
    }, taskId);

    if (!clickResult.ok) return res.json(clickResult);

    // 2. 等弹窗的 video 加载
    let modalVideoSrc = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 500));
      modalVideoSrc = await page.evaluate(() => {
        // 弹窗里的 video（不是卡片里的）
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          const rect = v.getBoundingClientRect();
          // 弹窗的 video 通常比较大（宽 > 400）
          if (rect.width > 400 && rect.height > 200) {
            return v.src || v.currentSrc || v.querySelector('source')?.src || '(empty)';
          }
        }
        return null;
      });
      if (modalVideoSrc) break;
    }

    // 3. 关弹窗
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    session.touch();
    res.json({
      ok: true,
      cardVideoSrc: clickResult.cardVideoSrc,
      modalVideoSrc: modalVideoSrc || '(未找到弹窗video)',
      same: clickResult.cardVideoSrc === modalVideoSrc
    });
  } catch (e) {
    try { const session = await jimengRPA.getSession(req.user.id); await session.page.keyboard.press('Escape'); } catch (_) {}
    res.json({ ok: false, error: e.message });
  }
});

// 截图调试 — 用于发现 DOM 选择器
app.get('/api/jimeng/rpa/screenshot', authMiddleware, async (req, res) => {
  try {
    const screenshot = await jimengRPA.takeScreenshot(req.user.id);
    res.json({ ok: true, screenshot });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 导航到指定 URL 并截图
app.post('/api/jimeng/rpa/navigate', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.json({ ok: false, error: '缺少 url' });
    const screenshot = await jimengRPA.navigateAndScreenshot(req.user.id, url);
    res.json({ ok: true, screenshot });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 获取页面 DOM 结构摘要
app.get('/api/jimeng/rpa/dom-summary', authMiddleware, async (req, res) => {
  try {
    const summary = await jimengRPA.getDOMSummary(req.user.id);
    res.json({ ok: true, summary });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 点击按钮并截图（调试用）
app.post('/api/jimeng/rpa/click', authMiddleware, async (req, res) => {
  try {
    const { index, waitMs } = req.body;
    if (index === undefined) return res.json({ ok: false, error: '缺少 index' });
    const result = await jimengRPA.clickButtonAndScreenshot(req.user.id, index, waitMs || 3000);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 执行 JS 并截图（调试用）
app.post('/api/jimeng/rpa/eval', authMiddleware, async (req, res) => {
  try {
    const { code, waitMs } = req.body;
    if (!code) return res.json({ ok: false, error: '缺少 code' });
    const result = await jimengRPA.evalAndScreenshot(req.user.id, code, waitMs || 3000);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/jimeng/rpa/pages', authMiddleware, async (req, res) => {
  try {
    const pages = await jimengRPA.listPages(req.user.id);
    res.json({ ok: true, pages });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================================
// 🎨 Midjourney 路由
// ============================================================================

app.post('/api/midjourney/proxy', async (req, res) => {
  try {
    const { url, method = 'GET', body, apiKey } = req.body;

    if (!apiKey) {
      return res.json({ ok: false, error: 'Midjourney API Key 未提供' });
    }

    console.log('[MJ API]', method, url);

    const result = await makeHttpRequest({
      url,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: body || undefined,
      timeout: 60000,
    });

    console.log('[MJ API] Response:', result.status);
    res.json({ ok: result.ok, data: result.data, status: result.status });
  } catch (error) {
    console.error('[MJ API] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// 🎬 Higgsfield 路由 (per-user 隔离)
// ============================================================================

// 浏览器路径自动检测 (与 jimeng-rpa.js 相同逻辑)
function findHfBrowserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'linux') return '/snap/bin/chromium';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    // Chrome (优先 - Google OAuth 只信任真 Chrome)
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppData && `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    // Edge (也支持 Google OAuth)
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Brave
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    localAppData && `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Per-user HF 数据存储
const hfSessions = new Map();   // userId -> { clientCookie, sessionId, signInId, currentToken, tokenExpiresAt, email, refreshTimer }
const hfBrowsers = new Map();   // userId -> { browser, page, launchTime }
const hfPendingLogins = new Map(); // userId -> { browser, page, timeout }

function getHfSession(userId) {
  if (!hfSessions.has(userId)) {
    hfSessions.set(userId, {
      clientCookie: null, sessionId: null, signInId: null,
      currentToken: null, tokenExpiresAt: 0, email: null,
      refreshTimer: null, refreshFailCount: 0,
    });
  }
  return hfSessions.get(userId);
}

function closeHfBrowser(userId) {
  const entry = hfBrowsers.get(userId);
  if (entry) {
    console.log('[HF Browser] 关闭用户', userId, '的活跃浏览器');
    try { entry.browser.close(); } catch (_) {}
    hfBrowsers.delete(userId);
  }
}

function closePendingLogin(userId) {
  const pending = hfPendingLogins.get(userId);
  if (!pending) return;
  if (pending.timeout) clearTimeout(pending.timeout);
  const active = hfBrowsers.get(userId);
  if (pending.browser && (!active || pending.browser !== active.browser)) {
    try { pending.browser.close(); } catch (_) {}
  }
  hfPendingLogins.delete(userId);
}

async function hfBrowserFetch(userId, url, options = {}) {
  const entry = hfBrowsers.get(userId);
  if (!entry || !entry.page) throw new Error('HF 浏览器未连接');
  try { await entry.page.evaluate(() => true); } catch (e) {
    hfBrowsers.delete(userId);
    throw new Error('HF 浏览器已断开');
  }
  const result = await entry.page.evaluate(async (fetchUrl, fetchOpts) => {
    try {
      const resp = await fetch(fetchUrl, {
        method: fetchOpts.method || 'GET',
        headers: fetchOpts.headers || {},
        body: fetchOpts.body || undefined,
      });
      const contentType = resp.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await resp.json();
      } else {
        data = await resp.text();
      }
      return { ok: resp.ok, status: resp.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err.message };
    }
  }, url, options);
  if (result.error) throw new Error(result.error);
  return result;
}

// ── Higgsfield API 代理 (优先通过浏览器 fetch，绕过 Cloudflare) ──
app.post('/api/higgsfield/proxy', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const { url, method = 'GET', headers = {}, body, token } = req.body;

    if (!token) {
      return res.json({ ok: false, error: 'Higgsfield Token 未提供，请在设置中输入 JWT Token' });
    }

    console.log('[Higgsfield API] user:', userId, method, url.substring(0, 100));

    // 优先使用浏览器 fetch（绕过 Cloudflare/DataDome）
    if (hfBrowsers.has(userId)) {
      try {
        const fetchHeaders = {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json, */*',
          'Content-Type': 'application/json',
          ...headers,
        };
        const fetchBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;
        const result = await hfBrowserFetch(userId, url, { method, headers: fetchHeaders, body: fetchBody });
        console.log('[Higgsfield API] Browser fetch:', result.status);
        // 调试: job 完成时打印返回数据（含图片 URL）
        if (method === 'GET' && url.includes('/jobs/') && result.ok && result.data) {
          const status = (result.data.status || result.data.state || '').toLowerCase();
          if (status === 'completed' || status === 'done' || status === 'finished' || !url.includes('/status')) {
            const dataStr = JSON.stringify(result.data).substring(0, 1000);
            console.log('[Higgsfield API] Job result data:', dataStr);
          }
        }
        return res.json({ ok: result.ok, data: result.data, status: result.status });
      } catch (browserErr) {
        console.warn('[Higgsfield API] Browser fetch failed:', browserErr.message, '- fallback to HTTP');
      }
    }

    // 回退: 直接 HTTP（可能被 CF 拦截）
    console.log('[Higgsfield API] 使用 HTTP 回退（无活跃浏览器）');
    const result = await makeHttpRequest({
      url,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, */*',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      timeout: 60000,
    });

    console.log('[Higgsfield API] HTTP Response:', result.status);
    res.json({ ok: result.ok, data: result.data, status: result.status });
  } catch (error) {
    console.error('[Higgsfield API] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── Higgsfield 图片上传 (替代 higgsfield-upload IPC) ──
app.post('/api/higgsfield/upload', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const { base64Data, contentType = 'image/jpeg', token } = req.body;
    if (!base64Data) return res.json({ ok: false, error: 'No image data' });
    if (!token) return res.json({ ok: false, error: 'No token provided' });

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpeg';
    const filename = `ref_${Date.now()}.${ext}`;

    // Step 1: POST /media/batch（优先浏览器 fetch）
    console.log('[HF Upload] Step 1: POST /media/batch, user:', userId);
    let step1Result;
    if (hfBrowsers.has(userId)) {
      try {
        step1Result = await hfBrowserFetch(userId, 'https://fnf.higgsfield.ai/media/batch', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mimetypes: [contentType], source: 'user_upload' }),
        });
      } catch (e) {
        console.warn('[HF Upload] Step1 browser fetch failed:', e.message);
      }
    }
    if (!step1Result) {
      step1Result = await makeHttpRequest({
        url: 'https://fnf.higgsfield.ai/media/batch',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimetypes: [contentType], source: 'user_upload' }),
        timeout: 30000,
      });
    }

    if (!step1Result.ok) {
      throw new Error(`Step1: /media/batch ${step1Result.status}`);
    }

    const mediaInfo = Array.isArray(step1Result.data) ? step1Result.data[0] : step1Result.data;
    const uploadUrl = mediaInfo?.upload_url;
    const publicUrl = mediaInfo?.url;
    const mediaId = mediaInfo?.id;

    if (!uploadUrl || !publicUrl || !mediaId) {
      throw new Error('Step1: 缺少 upload_url/url/id 字段');
    }

    // Step 2: PUT 上传图片
    const rawBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(rawBase64, 'base64');
    console.log('[HF Upload] Step 2: PUT', imageBuffer.length, 'bytes');

    const parsedUrl = new URL(uploadUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    await new Promise((resolve, reject) => {
      const putReq = httpModule.request(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': imageBuffer.length,
        },
      }, (putRes) => {
        const chunks = [];
        putRes.on('data', (chunk) => chunks.push(chunk));
        putRes.on('end', () => {
          if (putRes.statusCode >= 200 && putRes.statusCode < 300) resolve(true);
          else reject(new Error(`Step2: PUT failed ${putRes.statusCode}`));
        });
      });
      putReq.on('error', (err) => reject(new Error('Step2 error: ' + err.message)));
      putReq.write(imageBuffer);
      putReq.end();
    });

    // Step 3: POST /media/{id}/upload 确认（优先浏览器 fetch）
    console.log('[HF Upload] Step 3: Confirm upload for', mediaId);
    let step3Result;
    if (hfBrowsers.has(userId)) {
      try {
        step3Result = await hfBrowserFetch(userId, `https://fnf.higgsfield.ai/media/${mediaId}/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, job_id: null }),
        });
      } catch (e) {
        console.warn('[HF Upload] Step3 browser fetch failed:', e.message);
      }
    }
    if (!step3Result) {
      step3Result = await makeHttpRequest({
        url: `https://fnf.higgsfield.ai/media/${mediaId}/upload`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, job_id: null }),
        timeout: 30000,
      });
    }

    if (!step3Result.ok) {
      throw new Error(`Step3: confirm failed ${step3Result.status}`);
    }

    console.log('[HF Upload] All 3 steps done! mediaId:', mediaId);
    res.json({ ok: true, publicUrl, mediaId });
  } catch (error) {
    console.error('[HF Upload] Error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ============================================================================
// 🔗 Higgsfield Token Bridge
// ============================================================================

// 内存存储: bridgeId -> { token, updatedAt }
const tokenBridgeStore = {};

// 接收 token (GET - 通过 img tag 绕过 CSP)
app.get('/api/higgsfield/token-bridge', (req, res) => {
  const { token, bridgeId } = req.query;
  if (token && bridgeId) {
    tokenBridgeStore[bridgeId] = { token, updatedAt: Date.now() };
    // 清理超过 5 分钟的旧条目
    const now = Date.now();
    for (const key of Object.keys(tokenBridgeStore)) {
      if (now - tokenBridgeStore[key].updatedAt > 5 * 60 * 1000) {
        delete tokenBridgeStore[key];
      }
    }
  }
  // 返回 1x1 透明 GIF
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(pixel);
});

// 获取最新 token
app.get('/api/higgsfield/token-latest', (req, res) => {
  const { bridgeId } = req.query;
  if (!bridgeId) return res.json({ ok: false, error: 'Missing bridgeId' });

  const entry = tokenBridgeStore[bridgeId];
  if (!entry) return res.json({ ok: false, error: 'No token found' });

  const age = (Date.now() - entry.updatedAt) / 1000;
  if (age > 120) return res.json({ ok: false, error: 'Token expired' });

  res.json({ ok: true, token: entry.token, age: Math.round(age) });
});

// ============================================================================
// 🔐 Higgsfield Clerk 服务端代登录 (per-user)
// ============================================================================

const CLERK_FAPI = 'https://clerk.higgsfield.ai';
const CLERK_JS_VERSION = '5.56.0';

// 辅助: 从 set-cookie header 提取 __client 的值
function extractClientCookie(headers) {
  const cookies = headers['set-cookie'];
  if (!cookies) return null;
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of arr) {
    const match = c.match(/__client=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// 辅助: 调用 Clerk FAPI (per-user)
async function clerkFetch(userId, endpoint, method, body, cookie) {
  const headers = {
    'Accept': 'application/json',
    'Origin': 'https://higgsfield.ai',
    'Referer': 'https://higgsfield.ai/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  };
  if (cookie) headers['Cookie'] = `__client=${cookie}`;
  if (body && method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const url = `${CLERK_FAPI}${endpoint}${endpoint.includes('?') ? '&' : '?'}_clerk_js_version=${CLERK_JS_VERSION}`;
  console.log(`[Clerk] user:${userId} ${method} ${endpoint}`);
  const result = await makeHttpRequest({ url, method, headers, body: body || undefined });

  if (typeof result.data === 'string' && result.data.includes('<!DOCTYPE')) {
    console.error('[Clerk] FAPI returned HTML instead of JSON, status:', result.status);
    return { ...result, ok: false, data: { errors: [{ message: 'Clerk API 返回了非预期响应' }] } };
  }

  // 更新 __client cookie
  const newCookie = extractClientCookie(result.headers || {});
  if (newCookie) {
    const sess = getHfSession(userId);
    sess.clientCookie = newCookie;
  }

  console.log(`[Clerk] Response: ${result.status}, data:`, JSON.stringify(result.data).substring(0, 200));
  return result;
}

// 刷新 Clerk JWT token (per-user)
async function refreshClerkToken(userId) {
  const sess = getHfSession(userId);
  if (!sess.sessionId) return;

  // 策略1: 用活跃的 Puppeteer 浏览器直接调 Clerk.session.getToken()（最可靠）
  const browserEntry = hfBrowsers.get(userId);
  if (browserEntry && browserEntry.page) {
    try {
      const token = await browserEntry.page.evaluate(async () => {
        if (window.Clerk && window.Clerk.session) {
          // touch() 保持 session 活跃，防止 Clerk 过期
          try { await window.Clerk.session.touch(); } catch {}
          return await window.Clerk.session.getToken();
        }
        return null;
      });
      if (token) {
        sess.currentToken = token;
        sess.tokenExpiresAt = Date.now() + 55000;
        sess.refreshFailCount = 0;
        console.log('[Clerk] user:', userId, 'Token 已刷新 (via browser)');
        return;
      }
    } catch (e) {
      console.warn('[Clerk] user:', userId, 'Browser getToken 失败:', e.message, '— 尝试 reload 恢复');
    }

    // 策略1b: getToken 失败 → reload 页面重新取 session
    try {
      await browserEntry.page.goto('https://higgsfield.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await browserEntry.page.waitForFunction(() => {
        return window.Clerk && window.Clerk.loaded && window.Clerk.session && window.Clerk.session.id;
      }, { timeout: 15000 });
      const token = await browserEntry.page.evaluate(async () => {
        try { await window.Clerk.session.touch(); } catch {}
        return await window.Clerk.session.getToken();
      });
      if (token) {
        sess.currentToken = token;
        sess.tokenExpiresAt = Date.now() + 55000;
        sess.refreshFailCount = 0;
        // 顺便更新 cookie
        const cookies = await browserEntry.page.cookies('https://clerk.higgsfield.ai');
        const cc = cookies.find(c => c.name === '__client');
        if (cc) sess.clientCookie = cc.value;
        console.log('[Clerk] user:', userId, 'Token 已刷新 (via browser reload)');
        return;
      }
    } catch (e2) {
      console.warn('[Clerk] user:', userId, 'Browser reload 恢复失败:', e2.message);
    }
  }

  // 策略2: 用 __client cookie 调 Clerk FAPI
  if (!sess.clientCookie) {
    console.warn('[Clerk] user:', userId, 'Token 刷新跳过: 无 clientCookie 且无活跃浏览器');
    return;
  }
  try {
    // 先 touch 保活 session
    await clerkFetch(userId, `/v1/client/sessions/${sess.sessionId}/touch`, 'POST', null, sess.clientCookie);
    // 再拿新 token
    const result = await clerkFetch(userId,
      `/v1/client/sessions/${sess.sessionId}/tokens`,
      'POST', null, sess.clientCookie
    );
    if (result.ok && result.data?.jwt) {
      sess.currentToken = result.data.jwt;
      sess.tokenExpiresAt = Date.now() + 55000;
      sess.refreshFailCount = 0;
      console.log('[Clerk] user:', userId, 'Token 已刷新 (via cookie)');
      return;
    } else {
      console.warn('[Clerk] user:', userId, 'Token 刷新失败:', result.data?.errors?.[0]?.message || result.status);
    }
  } catch (e) {
    console.error('[Clerk] user:', userId, 'Token 刷新异常:', e.message);
  }

}

function startClerkRefresh(userId) {
  stopClerkRefresh(userId);
  refreshClerkToken(userId);
  const sess = getHfSession(userId);
  sess.refreshTimer = setInterval(() => refreshClerkToken(userId), 45000);
  console.log('[Clerk] user:', userId, '自动刷新已启动');
}

function stopClerkRefresh(userId) {
  const sess = hfSessions.get(userId);
  if (sess && sess.refreshTimer) {
    clearInterval(sess.refreshTimer);
    sess.refreshTimer = null;
  }
}


// 从 Puppeteer page 提取 session 并存储 (per-user)
async function extractAndStoreSession(userId, page, emailFallback) {
  const hasSession = await page.evaluate(() => !!(window.Clerk.session && window.Clerk.session.id));
  if (!hasSession) {
    const sid = await page.evaluate(() => window.Clerk.client?.activeSessions?.[0]?.id);
    if (sid) {
      await page.evaluate(async (s) => { await window.Clerk.setActive({ session: s }); }, sid);
    }
    await page.waitForFunction(() => {
      return window.Clerk.session && window.Clerk.session.id;
    }, { timeout: 10000 });
  }

  const sessionData = await page.evaluate(async () => {
    const token = await window.Clerk.session.getToken();
    return {
      sessionId: window.Clerk.session.id,
      currentToken: token,
      email: window.Clerk.user?.primaryEmailAddress?.emailAddress || '',
    };
  });

  const cookies = await page.cookies('https://clerk.higgsfield.ai');
  const clientCookie = cookies.find(c => c.name === '__client');
  if (!clientCookie) {
    const cookies2 = await page.cookies('https://higgsfield.ai');
    const cc2 = cookies2.find(c => c.name === '__client');
    if (cc2) sessionData.clientCookie = cc2.value;
  } else {
    sessionData.clientCookie = clientCookie.value;
  }

  const sess = getHfSession(userId);
  sess.clientCookie = sessionData.clientCookie || null;
  sess.sessionId = sessionData.sessionId;
  sess.email = sessionData.email || emailFallback;
  sess.currentToken = sessionData.currentToken;
  sess.tokenExpiresAt = sessionData.currentToken ? Date.now() + 55000 : 0;
  sess.signInId = null;

  if (!sess.clientCookie) {
    console.warn('[HF Login] user:', userId, '警告: __client cookie 未提取到，将依赖浏览器直连刷新');
  }

  startClerkRefresh(userId);

  return sessionData;
}

// --- 登录 (Puppeteer + Clerk JS API) ---
app.post('/api/higgsfield/clerk-login', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: '请输入邮箱和密码' });

  closePendingLogin(userId);
  closeHfBrowser(userId);

  let browser;
  try {
    console.log('[HF Login] user:', userId, '启动 Puppeteer...');
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: findHfBrowserPath() || 'chromium',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log('[HF Login] 加载 Clerk...');
    await page.goto('https://higgsfield.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForFunction(() => {
      return window.Clerk && window.Clerk.loaded && window.Clerk.client;
    }, { timeout: 60000 });

    console.log('[HF Login] 调用 Clerk signIn.create...');
    const signInResult = await page.evaluate(async (em, pw) => {
      try {
        const signIn = await window.Clerk.client.signIn.create({
          identifier: em,
          password: pw,
        });

        // 如果需要二步验证，立即在同一个 evaluate 里触发发送邮件
        let secondFactors = null;
        let prepareError = null;
        if (signIn.status === 'needs_second_factor') {
          if (signIn.supportedSecondFactors) {
            secondFactors = signIn.supportedSecondFactors.map(f => f.strategy);
          }
          // 自动触发发送验证码邮件
          if (secondFactors && secondFactors.includes('email_code')) {
            try {
              await signIn.prepareSecondFactor({ strategy: 'email_code' });
            } catch (pe) {
              prepareError = pe.errors ? (pe.errors[0].longMessage || pe.errors[0].message) : pe.message;
            }
          }
        }

        return {
          success: signIn.status === 'complete',
          status: signIn.status,
          sessionId: signIn.createdSessionId,
          signInId: signIn.id,
          secondFactors,
          prepareError,
        };
      } catch (err) {
        const firstErr = err.errors && err.errors[0];
        return {
          success: false,
          error: firstErr ? firstErr.longMessage || firstErr.message : err.message || String(err),
          code: firstErr ? firstErr.code : null,
        };
      }
    }, email, password);

    // 需要二步验证 - 保持浏览器打开
    if (signInResult.status === 'needs_second_factor') {
      var sfList = signInResult.secondFactors || ['totp'];
      console.log('[HF Login] user:', userId, '需要二步验证, sfList:', sfList);
      hfPendingLogins.set(userId, {
        browser, page,
        timeout: setTimeout(function() { closePendingLogin(userId); }, 180000),
      });
      var resp = { ok: false, needsSecondFactor: true, strategies: sfList };
      return res.json(resp);
    }

    if (!signInResult.success) {
      await browser.close();
      return res.json({ ok: false, error: signInResult.error || '登录失败 (' + signInResult.status + ')' });
    }

    // 登录成功 (无 2FA)
    console.log('[HF Login] user:', userId, '登录成功, 激活 session:', signInResult.sessionId);
    await page.evaluate(async (sid) => {
      await window.Clerk.setActive({ session: sid });
    }, signInResult.sessionId);

    const sessionData = await extractAndStoreSession(userId, page, email);
    hfBrowsers.set(userId, { browser, page, launchTime: Date.now() });
    console.log('[HF Login] user:', userId, '浏览器已保持活跃用于 API 代理');

    const sess = getHfSession(userId);
    console.log('[HF Login] 完成! email:', sess.email, 'clientCookie:', !!sess.clientCookie);
    return res.json({ ok: true, email: sess.email, sessionId: sessionData.sessionId, token: sessionData.currentToken, hasCookie: !!sess.clientCookie });

  } catch (e) {
    const pending = hfPendingLogins.get(userId);
    const active = hfBrowsers.get(userId);
    if (browser && (!pending || browser !== pending.browser) && (!active || browser !== active.browser)) {
      try { await browser.close(); } catch (_) {}
    }
    console.error('[HF Login] user:', userId, 'Error:', e.message, '\n', e.stack);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- 浏览器登录 (打开真实浏览器窗口让用户自己登录) ---
app.post('/api/higgsfield/browser-login', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // 如果已经在登录中，返回状态
  if (hfPendingLogins.has(userId)) {
    return res.json({ ok: true, message: '浏览器已打开，请在浏览器中登录' });
  }

  // 清理旧的 session 和浏览器
  closePendingLogin(userId);
  closeHfBrowser(userId);

  try {
    const puppeteerCore = require('puppeteer-core');
    const browserPath = findHfBrowserPath();
    console.log('[HF Browser Login] user:', userId, '启动可见浏览器... path:', browserPath || '(内置 Chromium)');

    const HF_AUTH_URL = 'https://higgsfield.ai/auth';
    const launchOptions = {
      headless: false,
      defaultViewport: null,
      args: [
        '--window-size=500,700',
        `--app=${HF_AUTH_URL}`,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    let browser;
    if (browserPath) {
      launchOptions.executablePath = browserPath;
      browser = await puppeteerCore.launch(launchOptions);
    } else {
      // 没找到系统浏览器，尝试 puppeteer 内置 Chromium
      try {
        const puppeteerFull = require('puppeteer');
        browser = await puppeteerFull.launch(launchOptions);
      } catch (_) {
        return res.status(500).json({ ok: false, error: '未找到可用的浏览器，请安装 Chrome 或 Edge' });
      }
    }

    // --app 模式: 等页面加载，找到正确的 page
    let page;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const pages = await browser.pages();
      page = pages.find(p => p.url().includes('higgsfield'));
      if (page) break;
    }
    if (!page) {
      // fallback: 用第一个页面手动导航
      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();
      await page.goto(HF_AUTH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    }
    console.log('[HF Browser Login] user:', userId, '浏览器已打开，等待用户登录...');

    // 存入 pending，5 分钟超时
    const timeoutHandle = setTimeout(() => {
      console.log('[HF Browser Login] user:', userId, '5 分钟超时，关闭浏览器');
      closePendingLogin(userId);
    }, 300000);

    hfPendingLogins.set(userId, { browser, page, timeout: timeoutHandle });

    // 后台轮询 Clerk.session
    (async () => {
      try {
        await page.waitForFunction(() => {
          return window.Clerk && window.Clerk.session && window.Clerk.session.id;
        }, { timeout: 300000, polling: 2000 });

        console.log('[HF Browser Login] user:', userId, '检测到登录成功!');

        // 提取 session (复用已有函数)
        await extractAndStoreSession(userId, page, '');

        // 清理 pending 状态
        if (hfPendingLogins.has(userId)) {
          const pending = hfPendingLogins.get(userId);
          if (pending.timeout) clearTimeout(pending.timeout);
          hfPendingLogins.delete(userId);
        }

        const sess = getHfSession(userId);
        console.log('[HF Browser Login] user:', userId, '完成! email:', sess.email);

        // 启动无头浏览器继承 session
        try {
          const allCookies = await page.cookies();
          const puppeteerForHeadless = require('puppeteer');
          const hb = await puppeteerForHeadless.launch({
            headless: 'new',
            executablePath: findHfBrowserPath() || 'chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                   '--disable-blink-features=AutomationControlled'],
            ignoreDefaultArgs: ['--enable-automation'],
          });
          const hp = await hb.newPage();
          await hp.setViewport({ width: 1280, height: 720 });
          await hp.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
          await hp.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
          if (allCookies.length > 0) await hp.setCookie(...allCookies);
          await hp.goto('https://higgsfield.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await hp.waitForFunction(() => window.Clerk && window.Clerk.loaded && window.Clerk.session && window.Clerk.session.id, { timeout: 15000 });
          hfBrowsers.set(userId, { browser: hb, page: hp, launchTime: Date.now() });
        } catch (e) {
          console.warn('[HF Browser Login] 无头浏览器启动失败:', e.message);
        }

        // 关闭可见窗口
        setTimeout(() => {
          try { browser.close(); } catch (_) {}
        }, 1500);

      } catch (e) {
        console.log('[HF Browser Login] user:', userId, '登录等待失败:', e.message);
        closePendingLogin(userId);
      }
    })();

    return res.json({ ok: true, message: '浏览器已打开，请在浏览器中登录' });

  } catch (e) {
    console.error('[HF Browser Login] user:', userId, 'Error:', e.message);
    return res.status(500).json({ ok: false, error: '无法打开浏览器: ' + e.message });
  }
});

// --- 二步验证 ---
app.post('/api/higgsfield/clerk-verify', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { code, strategy } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: '请输入验证码' });
  const pending = hfPendingLogins.get(userId);
  if (!pending || !pending.page) return res.status(400).json({ ok: false, error: '登录会话已过期，请重新登录' });

  try {
    console.log('[HF 2FA] user:', userId, '验证码:', code, 'strategy:', strategy || 'totp');
    const verifyResult = await pending.page.evaluate(async (c, s) => {
      try {
        const signIn = window.Clerk.client.signIn;
        const result = await signIn.attemptSecondFactor({ strategy: s || 'totp', code: c });
        return { success: result.status === 'complete', status: result.status, sessionId: result.createdSessionId };
      } catch (err) {
        const firstErr = err.errors && err.errors[0];
        return { success: false, error: firstErr ? firstErr.longMessage || firstErr.message : err.message || String(err) };
      }
    }, code, strategy || 'totp');

    if (!verifyResult.success) {
      return res.json({ ok: false, error: verifyResult.error || '验证失败' });
    }

    // 验证成功 - 提取 session
    console.log('[HF 2FA] user:', userId, '验证成功!');
    if (verifyResult.sessionId) {
      await pending.page.evaluate(async (sid) => {
        await window.Clerk.setActive({ session: sid });
      }, verifyResult.sessionId);
    }

    const sessionData = await extractAndStoreSession(userId, pending.page, '');
    // 清理 pending 状态
    if (pending.timeout) clearTimeout(pending.timeout);
    hfPendingLogins.delete(userId);

    const sess = getHfSession(userId);
    console.log('[HF 2FA] 完成! email:', sess.email);

    // 启动无头浏览器继承 cookie（包括 DataDome/Cloudflare cookie）
    try {
      const allCookies = await pending.page.cookies();
      const puppeteerForHeadless = require('puppeteer');
      const hb = await puppeteerForHeadless.launch({
        headless: 'new',
        executablePath: findHfBrowserPath() || 'chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      const hp = await hb.newPage();
      await hp.setViewport({ width: 1280, height: 720 });
      await hp.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      await hp.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
      if (allCookies.length > 0) await hp.setCookie(...allCookies);
      await hp.goto('https://higgsfield.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await hp.waitForFunction(() => window.Clerk && window.Clerk.loaded && window.Clerk.session && window.Clerk.session.id, { timeout: 15000 });
      hfBrowsers.set(userId, { browser: hb, page: hp, launchTime: Date.now() });
      console.log('[HF 2FA] 无头浏览器继承 cookie 完成');
      // 关闭旧的 pending 浏览器
      setTimeout(() => { try { pending.browser.close(); } catch (_) {} }, 1500);
    } catch (e) {
      console.warn('[HF 2FA] 无头浏览器继承失败:', e.message, '— 使用原浏览器');
      hfBrowsers.set(userId, { browser: pending.browser, page: pending.page, launchTime: Date.now() });
    }

    return res.json({ ok: true, email: sess.email, sessionId: sessionData.sessionId, token: sessionData.currentToken });

  } catch (e) {
    closePendingLogin(userId);
    console.error('[HF 2FA] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Session 导入 (从本地登录推送到线上) ---
app.post('/api/higgsfield/clerk-session-import', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { clientCookie, sessionId, email, currentToken } = req.body;
  if (!clientCookie || !sessionId) return res.status(400).json({ ok: false, error: '缺少参数' });
  const sess = getHfSession(userId);
  sess.clientCookie = clientCookie;
  sess.sessionId = sessionId;
  sess.email = email || '';
  sess.currentToken = currentToken || null;
  sess.tokenExpiresAt = currentToken ? Date.now() + 55000 : 0;
  sess.signInId = null;
  startClerkRefresh(userId);
  console.log('[Clerk] user:', userId, 'Session 已从外部导入, email:', email);
  res.json({ ok: true });
});

// --- Session 导出 (获取当前 session 完整信息) ---
app.get('/api/higgsfield/clerk-session-export', authMiddleware, (req, res) => {
  const sess = getHfSession(req.user.id);
  res.json({
    clientCookie: sess.clientCookie,
    sessionId: sess.sessionId,
    email: sess.email,
    currentToken: sess.currentToken,
  });
});

// --- 获取 token ---
app.get('/api/higgsfield/clerk-token', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const sess = getHfSession(userId);
  if (!sess.sessionId) return res.json({ ok: false, error: '未登录' });

  if (Date.now() > sess.tokenExpiresAt - 5000) {
    await refreshClerkToken(userId);
  }

  if (sess.currentToken) {
    return res.json({ ok: true, token: sess.currentToken, email: sess.email });
  }
  return res.json({ ok: false, error: 'Token 不可用' });
});

// --- 登出 ---
app.post('/api/higgsfield/clerk-logout', authMiddleware, (req, res) => {
  const userId = req.user.id;
  stopClerkRefresh(userId);
  closeHfBrowser(userId);
  closePendingLogin(userId);
  hfSessions.delete(userId);
  console.log('[Clerk] user:', userId, '已登出');
  res.json({ ok: true });
});

// --- 状态 ---
app.get('/api/higgsfield/clerk-status', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const sess = getHfSession(userId);
  res.json({
    loggedIn: !!sess.sessionId,
    email: sess.email,
    sessionId: sess.sessionId || null,
    hasToken: !!sess.currentToken,
    token: sess.currentToken || null,
    tokenFresh: Date.now() < sess.tokenExpiresAt,
    browserLoginPending: hfPendingLogins.has(userId),
  });
});

// --- 弹窗登录页面 (邮箱密码 → 服务端 Puppeteer 登录) ---
// 注意: 登录页通过 query param 传递 auth token，页面内 JS 用它做 Authorization header
app.get('/api/higgsfield/login-page', (req, res) => {
  const authToken = req.query.t || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Higgsfield 登录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{width:100%;max-width:400px;background:#121217;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden}
.header{padding:24px;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(236,72,153,0.1));border-bottom:1px solid rgba(255,255,255,0.05);text-align:center}
.header h1{font-size:20px;font-weight:700;margin-bottom:4px}
.header p{font-size:12px;color:#94a3b8}
.body{padding:24px}
.field{margin-bottom:16px}
.field label{display:block;font-size:11px;color:#94a3b8;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.field input{width:100%;padding:12px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:14px;outline:none;transition:all 0.2s}
.field input:focus{border-color:rgba(168,85,247,0.5);box-shadow:0 0 15px rgba(168,85,247,0.15)}
.field input::placeholder{color:#475569}
.btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;margin-top:8px}
.btn:hover{opacity:0.9;transform:scale(1.01)}
.btn:disabled{opacity:0.5;cursor:wait;transform:none}
.error{padding:10px 14px;margin-bottom:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;color:#f87171;font-size:12px}
.success{text-align:center;padding:40px 24px}
.success .check{width:60px;height:60px;margin:0 auto 16px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(34,197,94,0.4)}
.success h2{color:#22c55e;margin-bottom:8px}
.success p{color:#94a3b8;font-size:13px}
.hidden{display:none}
.note{font-size:10px;color:#475569;text-align:center;margin-top:12px}
.remember{display:flex;align-items:center;gap:8px;margin:4px 0 12px;cursor:pointer;user-select:none}
.remember input{width:16px;height:16px;accent-color:#a855f7;cursor:pointer}
.remember label{font-size:12px;color:#94a3b8;cursor:pointer}
</style></head><body>
<div class="card">
  <div class="header">
    <h1>Higgsfield</h1>
    <p id="header-subtitle">登录你的 Higgsfield 账号</p>
  </div>
  <div class="body">
    <div id="login-form">
      <div class="field"><label>邮箱</label>
        <input type="email" id="email" placeholder="your@email.com" autocomplete="email">
      </div>
      <div class="field"><label>密码</label>
        <input type="password" id="password" placeholder="输入密码" autocomplete="current-password">
      </div>
      <div class="remember"><input type="checkbox" id="remember-me"><label for="remember-me">记住账号密码</label></div>
      <div id="login-error" class="error hidden"></div>
      <button id="login-btn" class="btn" onclick="doLogin()">登录</button>
      <p class="note">登录后服务端自动保持连接</p>
    </div>
    <div id="verify-form" class="hidden">
      <div class="field"><label>验证码</label>
        <input type="text" id="verify-code" placeholder="输入 6 位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric" style="text-align:center;font-size:20px;letter-spacing:8px">
      </div>
      <div id="verify-error" class="error hidden"></div>
      <button id="verify-btn" class="btn" onclick="doVerify()">验证</button>
      <p id="verify-note" class="note">请输入验证码</p>
    </div>
    <div id="success-view" class="hidden success">
      <div class="check"><svg width="30" height="30" fill="none" stroke="#fff" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
      <h2>连接成功!</h2>
      <p>Higgsfield 已连接，窗口将自动关闭</p>
    </div>
  </div>
</div>
<script>
var _authToken='${authToken}';
var _authHeaders={'Content-Type':'application/json','Authorization':'Bearer '+_authToken};
async function doLogin(){
  var email=document.getElementById('email').value.trim();
  var pw=document.getElementById('password').value;
  if(!email||!pw)return;
  var btn=document.getElementById('login-btn');
  if(btn.disabled)return;
  btn.disabled=true;btn.textContent='登录中... (约10秒)';
  document.getElementById('login-error').classList.add('hidden');
  try{
    var r=await fetch('/api/higgsfield/clerk-login',{method:'POST',headers:_authHeaders,body:JSON.stringify({email:email,password:pw})});
    var d=await r.json();
    if(d.ok){
      showSuccess(d.email||email,d.sessionId,d.token);
    }else if(d.needsSecondFactor){
      window._hfStrategy=(d.strategies&&d.strategies[0])||'totp';
      document.getElementById('login-form').classList.add('hidden');
      document.getElementById('verify-form').classList.remove('hidden');
      if(window._hfStrategy==='email_code'){
        document.getElementById('header-subtitle').textContent='验证码已发送到你的邮箱';
        document.getElementById('verify-note').textContent='请查看邮箱 '+email+' 中的验证码';
      }else{
        document.getElementById('header-subtitle').textContent='请输入二步验证码';
        document.getElementById('verify-note').textContent='请输入身份验证器 (Authenticator) 中的验证码';
      }
      document.getElementById('verify-code').focus();
    }else{
      var e=document.getElementById('login-error');
      e.textContent=d.error||'登录失败';e.classList.remove('hidden');
    }
  }catch(e){
    var el=document.getElementById('login-error');
    el.textContent=e.message||'网络错误';el.classList.remove('hidden');
  }finally{btn.disabled=false;btn.textContent='登录'}
}
async function doVerify(){
  var code=document.getElementById('verify-code').value.trim();
  if(!code)return;
  var btn=document.getElementById('verify-btn');
  if(btn.disabled)return;
  btn.disabled=true;btn.textContent='验证中...';
  document.getElementById('verify-error').classList.add('hidden');
  try{
    var r=await fetch('/api/higgsfield/clerk-verify',{method:'POST',headers:_authHeaders,body:JSON.stringify({code:code,strategy:window._hfStrategy||'totp'})});
    var d=await r.json();
    if(d.ok){
      showSuccess(d.email,d.sessionId,d.token);
    }else{
      var e=document.getElementById('verify-error');
      e.textContent=d.error||'验证失败';e.classList.remove('hidden');
      document.getElementById('verify-code').value='';
      document.getElementById('verify-code').focus();
    }
  }catch(e){
    var el=document.getElementById('verify-error');
    el.textContent=e.message||'网络错误';el.classList.remove('hidden');
  }finally{btn.disabled=false;btn.textContent='验证'}
}
function showSuccess(email,sessionId,token){
  // 记住账号密码
  if(document.getElementById('remember-me').checked){localStorage.setItem('aluo_hf_saved_email',document.getElementById('email').value);localStorage.setItem('aluo_hf_saved_password',document.getElementById('password').value)}else{localStorage.removeItem('aluo_hf_saved_email');localStorage.removeItem('aluo_hf_saved_password')}
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('verify-form').classList.add('hidden');
  document.getElementById('success-view').classList.remove('hidden');
  if(window.opener){window.opener.postMessage({type:'hf-clerk-login-success',email:email||'',sessionId:sessionId||'',token:token||''},'*')}
  setTimeout(function(){try{window.close()}catch(e){}},2000);
}
document.getElementById('password').addEventListener('keypress',function(e){if(e.key==='Enter')doLogin()});
document.getElementById('verify-code').addEventListener('keypress',function(e){if(e.key==='Enter')doVerify()});
// 记住账号密码
var _se=localStorage.getItem('aluo_hf_saved_email');
var _sp=localStorage.getItem('aluo_hf_saved_password');
if(_se&&_sp){document.getElementById('email').value=_se;document.getElementById('password').value=_sp;document.getElementById('remember-me').checked=true}
document.getElementById('email').focus();
</script></body></html>`);
});

// ============================================================================
// 📊 系统路由
// ============================================================================

// ── 版本号 ──
app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    res.json({ version: pkg.version });
  } catch (error) {
    res.json({ version: 'unknown' });
  }
});

// ============================================================================
// 🔐 用户认证 (auth 已在上方 RPA 路由前初始化)
// ============================================================================

// ============================================================================
// 📦 静态文件 + SPA Fallback
// ============================================================================

// 自动更新文件托管（安装版上传更新包到此目录）
const updatesDir = path.join(process.env.USER_DATA_PATH || __dirname, 'updates');
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true });
app.use('/updates', express.static(updatesDir));

// 生产模式: 提供 Vite 构建输出
const distPath = process.env.STATIC_DIR || path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  // [LOStudio Open Fork Start]
// 1. Frontend Hijack: Serve patched JS
app.get('/dist/assets/index-z0ISuRAp.js', (req, res) => {
  const forkPath = path.join(__dirname, 'patched-index-z0ISuRAp-fork.js');
  if (fs.existsSync(forkPath)) {
    res.sendFile(forkPath);
  } else {
    res.sendFile(path.join(distPath, 'assets', 'index-z0ISuRAp.js'));
  }
});

// 2. OneAPI Proxy
app.all('/api/oneapi/*path', async (req, res) => {
    try {
        const targetUrl = req.body?.endpoint || req.headers['x-custom-target-url'] || process.env.DEFAULT_ONE_API_URL;
        if (!targetUrl) return res.status(400).json({ error: 'Missing target endpoint' });
        
        const rawPayload = req.body.body || req.body;
        const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
        
        const response = await fetch(targetUrl, {
            method: req.body.method || req.method,
            headers: { 'Content-Type': 'application/json', 'Authorization': req.headers['authorization'] || '' },
            body: payloadStr
        });

        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
            response.body.pipe(res);
        } else {
            const data = await response.json().catch(() => null);
            res.status(response.status).json(data || { error: 'Response parse error' });
        }
    } catch (error) {
        console.error('[OneAPI Proxy Error]', error);
        if (!res.headersSent) res.status(502).json({ error: 'Proxy failed', detail: error.message });
    }
});

// 3. Fallback Mock Route
app.all('/api/*path', (req, res) => res.json({ success: true, data: null, message: "Local Fork Mock" }));
// [LOStudio Open Fork End]

app.use(express.static(distPath));
}

// SPA fallback - 所有非 API 路由返回 index.html
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('App not built yet. Run "npm run build" first, or use "npm run dev:web" for development.');
  }
});

// ============================================================================
// 🚀 启动服务器
// ============================================================================

// ============================================================================
// 🧹 media-cache 自动清理 (7天过期)
// ============================================================================

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7天

function cleanMediaCache() {
  try {
    const files = fs.readdirSync(MEDIA_CACHE_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      const filePath = path.join(MEDIA_CACHE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && (now - stat.mtimeMs) > CACHE_MAX_AGE_MS) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (_) { /* skip individual file errors */ }
    }
    if (cleaned > 0) {
      console.log(`[CacheClean] Deleted ${cleaned} expired file(s) from media-cache`);
    }
  } catch (e) {
    console.error('[CacheClean] Error:', e.message);
  }
}

// 启动时清理一次，之后每小时检查
cleanMediaCache();
setInterval(cleanMediaCache, 60 * 60 * 1000);


// ==========================================
// [LOStudio Open Fork] AI Proxy Gateway
// ==========================================

app.all("/api/oneapi/*path", async (req, res) => {
    try {
        let targetUrl = req.headers["x-custom-target-url"];
        let targetKey = req.headers["x-custom-api-key"];

        if (!targetUrl) {
            targetUrl = process.env.DEFAULT_ONE_API_URL || "";
            targetKey = process.env.DEFAULT_ONE_API_KEY || "";
        }

        if (!targetUrl) {
            return res.status(400).json({ error: "代理失败：未配置目标地址" });
        }

        const pathSuffix = req.originalUrl.replace("/api/oneapi", "");
        const finalUrl = targetUrl.replace(/\/$/, "") + pathSuffix;

        const headers = {
            ...req.headers,
            "Authorization": targetKey ? "Bearer " + targetKey : undefined,
            "Host": new URL(finalUrl).host,
            "Connection": "keep-alive"
        };
        delete headers["x-custom-target-url"];
        delete headers["x-custom-api-key"];
        delete headers["content-length"];
        delete headers["x-forwarded-for"];

        const response = await fetch(finalUrl, {
            method: req.method,
            headers: headers,
            body: ["POST", "PUT", "PATCH"].includes(req.method) ? JSON.stringify(req.body) : undefined,
        });

        res.status(response.status);
        const contentType = response.headers.get("content-type") || "";
        
        if (contentType.includes("text/event-stream")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            const data = await response.json();
            res.json(data);
        }
    } catch (error) {
        console.error("[AI Proxy Error]", error);
        res.status(502).json({ error: "Proxy failed: " + error.message });
    }
});

// 2. 兜底路由：拦截所有未处理的 API 请求，防止前端崩溃
app.all("/api/*path", (req, res) => {
    res.json({ success: true, data: null });
});

// ==========================================


const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  LO Studio Web Server');
  console.log('='.repeat(60));
  console.log(`  URL:    http://localhost:${PORT}`);
  console.log(`  Cache:  ${MEDIA_CACHE_DIR}`);
  console.log(`  Mode:   ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60));
});

// ============================================================================
// 🔌 WebSocket 服务器 — 即梦远程浏览器 Screencast
// ============================================================================

const wss = new WebSocketLib.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/ws/jimeng') {
      socket.destroy();
      return;
    }

    // JWT 认证（LOCAL_MODE 跳过）
    let userId = 1;
    if (process.env.LOCAL_MODE !== '1') {
      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let payload;
      try {
        payload = verifyToken(token);
      } catch (e) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      userId = payload.userId;
    }

    // 即梦多账号: account=2 / dreamina 时用独立 session
    const account = url.searchParams.get('account');
    const effectiveUserId = account === '2' ? `${userId}_account2`
      : account === 'dreamina' ? `${userId}_dreamina`
      : userId;

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = effectiveUserId;
      wss.emit('connection', ws, request);
    });
  } catch (e) {
    console.error('[WebSocket] Upgrade error:', e.message);
    socket.destroy();
  }
});

wss.on('connection', async (ws) => {
  const userId = ws.userId;
  console.log(`[WebSocket] 用户 ${userId} 连接`);

  try {
    // 获取或创建用户会话
    const session = await jimengRPA.getSession(userId);
    session.wsClient = ws;

    // 启动 screencast
    await jimengRPA.startScreencast(session);

    // 发送初始状态
    ws.send(JSON.stringify({ type: 'connected', loggedIn: session.loggedIn }));

    // 发送 worker pool 状态
    ws.send(JSON.stringify({ type: 'worker_status', ...jimengRPA._getWorkerStatus(session) }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Tab 切换
        if (msg.type === 'switch-tab') {
          const tabIndex = typeof msg.tabIndex === 'number' ? msg.tabIndex : -1;
          await jimengRPA.switchScreencastTab(session, tabIndex);
          return;
        }

        // 获取 worker 状态
        if (msg.type === 'get-worker-status') {
          ws.send(JSON.stringify({ type: 'worker_status', ...jimengRPA._getWorkerStatus(session) }));
          return;
        }

        // 设置最大并行页面数
        if (msg.type === 'set-max-pages') {
          const maxPages = typeof msg.maxPages === 'number' ? msg.maxPages : 3;
          jimengRPA.setMaxPages(userId, maxPages);
          ws.send(JSON.stringify({ type: 'worker_status', ...jimengRPA._getWorkerStatus(session) }));
          return;
        }

        // 刷新当前查看的页面（F5）
        if (msg.type === 'reload-page') {
          try {
            const page = session.viewedPage;
            if (page) {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
            }
          } catch (e) {
            console.warn(`[WebSocket] reload-page failed: ${e.message}`);
          }
          return;
        }

        // 手动新开 worker tab
        if (msg.type === 'create-worker') {
          try {
            const result = await jimengRPA.createManualWorkerPage(userId);
            ws.send(JSON.stringify({ type: 'create-worker-result', ...result }));
          } catch (e) {
            console.warn(`[WebSocket] create-worker failed: ${e.message}`);
            ws.send(JSON.stringify({ type: 'create-worker-result', ok: false, error: e.message }));
          }
          return;
        }

        // 关闭指定 worker tab（用户手动干预卡住的 tab）
        if (msg.type === 'close-worker') {
          const idx = typeof msg.index === 'number' ? msg.index : -1;
          if (idx >= 0) {
            try {
              const result = await jimengRPA.closeWorkerPage(userId, idx);
              ws.send(JSON.stringify({ type: 'close-worker-result', index: idx, ...result }));
            } catch (e) {
              console.warn(`[WebSocket] close-worker failed: ${e.message}`);
              ws.send(JSON.stringify({ type: 'close-worker-result', index: idx, ok: false, error: e.message }));
            }
          }
          return;
        }

        // 普通输入事件
        await jimengRPA.handleInput(session, msg);
      } catch (e) {
        // 忽略无效消息
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] 用户 ${userId} 断开`);
      session.wsClient = null;
      jimengRPA.stopScreencast(session);
    });

    ws.on('error', (e) => {
      console.error(`[WebSocket] 用户 ${userId} 错误:`, e.message);
      session.wsClient = null;
    });
  } catch (e) {
    console.error(`[WebSocket] 用户 ${userId} 初始化失败:`, e.message);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
    ws.close();
  }
});
