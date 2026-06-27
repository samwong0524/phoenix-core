/**
 * jimeng-rpa.js — 即梦浏览器自动化模块（多用户版）
 *
 * 用 Puppeteer 操控真实浏览器访问即梦官网，
 * 自动填写提示词、选模型、点生成、拦截结果。
 * 所有 API 请求由即梦自己的前端代码发出，不走逆向 API。
 *
 * 多用户架构:
 *   - 共享单 Chrome 进程（省内存）
 *   - 每用户独立 BrowserContext（隔离 cookie/页面）
 *   - CDP Screencast 推送帧到 WebSocket
 *   - CDP Input.dispatch* 中转用户操作
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

// ============================================================================
// DOM 选择器配置 — 即梦改版只需改这里
// ============================================================================
const SELECTORS = {
  // 使用协议弹窗
  agreeButton: '[class*=agree-button]',

  // 图片创作页 (从 DOM 探索确认)
  promptTextarea: 'textarea[class*=prompt-textarea]:not([class*=collapsed])',
  promptInput: 'input[class*=prompt-input]:not([class*=collapsed])',
  generateBtn: 'button.lv-btn-primary.lv-btn-shape-circle:not(.lv-btn-disabled)',
  generateBtnDisabled: 'button.lv-btn-primary.lv-btn-shape-circle.lv-btn-disabled',
  fileInput: 'input[class*=file-input]',
  ratioButton: 'button[class*=button-]',        // 显示 "1:1高清 2K" 的按钮
  typeSelect: '[class*=toolbar-select]',         // 第一个=类型(图片生成), 第二个=模型(图片4.1)
  modelSelectValue: '.select-j',               // 模型下拉 (class 含 select-j)

  // 视频创作页 (已确认 2026-02-22)
  // Prompt: 同图片页面用 promptTextarea / promptInput
  // 生成按钮: 同图片 submit-button-KJTUYS
  // Toolbar select (non-type): [0]=模型, [1]=模式, [2]=时长
  // 比例按钮: 同图片 button-lc3WzE.toolbar-button-FhFnQ_
  videoToolbarSelect: '[class*=toolbar-select]',
};

// 即梦页面 URL
const JIMENG_URLS = {
  home: 'https://jimeng.jianying.com/ai-tool/home',
  generate: 'https://jimeng.jianying.com/ai-tool/generate',
  imageGen: 'https://jimeng.jianying.com/ai-tool/home?type=image',
  videoGen: 'https://jimeng.jianying.com/ai-tool/home?type=video',
  login: 'https://jimeng.jianying.com',
};

const DREAMINA_URLS = {
  home: 'https://dreamina.capcut.com/ai-tool/home',
  generate: 'https://dreamina.capcut.com/ai-tool/generate',
  imageGen: 'https://dreamina.capcut.com/ai-tool/home?type=image',
  videoGen: 'https://dreamina.capcut.com/ai-tool/home?type=video',
  login: 'https://dreamina.capcut.com',
};

// 判断 userId 是否为 Dreamina 国际版
function isDreaminaUser(userId) {
  return userId && userId.toString().endsWith('_dreamina');
}

// 根据 userId 获取对应的 URL 集
function getUrlsForUser(userId) {
  return isDreaminaUser(userId) ? DREAMINA_URLS : JIMENG_URLS;
}

// 判断 URL 是否属于即梦/Dreamina 平台
function isPlatformUrl(url, userId) {
  if (isDreaminaUser(userId)) return url.includes('dreamina.capcut.com');
  return url.includes('jimeng.jianying.com');
}

// 媒体缓存目录（与 server.js 共用，HD 视频下载用）
const DATA_DIR = process.env.USER_DATA_PATH || __dirname;
const MEDIA_CACHE_DIR = path.join(DATA_DIR, 'media-cache');
if (!fs.existsSync(MEDIA_CACHE_DIR)) fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });

// Cookie 持久化目录（按用户 ID 存储）
const COOKIE_DIR = path.join(process.env.USER_DATA_PATH || __dirname, 'jimeng-cookies');
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });
function cookiePathForUser(userId) {
  return path.join(COOKIE_DIR, `${userId}.json`);
}

// 自动检测浏览器路径（Chrome > Edge > Puppeteer 内置）
function findBrowserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'linux') return '/snap/bin/chromium';
  // Windows: 按优先级搜索
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null; // 让 Puppeteer 用内置 Chromium
}
const CHROME_PATH = findBrowserPath();

// ============================================================================
// PageSlot — Worker Pool 中的一个页面槽位
// ============================================================================

class PageSlot {
  constructor(index, page) {
    this.index = index;           // 槽位索引 (0, 1, 2, ...)
    this.page = page;             // Puppeteer Page 实例
    this.busy = false;            // 是否正在执行任务
    this.currentTaskId = null;    // 当前任务 ID
    this.currentTaskType = null;  // 'image' | 'video' | null
    this.currentProgress = null;  // 进度字符串
    this.ready = true;            // 页面是否健康
    this.pageSetupInProgress = false; // RPA 设置中（锁定用户输入）
  }
}

// ============================================================================
// UserSession — 每个用户的独立会话
// ============================================================================

class UserSession {
  constructor(userId) {
    this.userId = userId;
    this.context = null;       // BrowserContext (isolated)
    this.page = null;          // 主页面（登录/手动浏览/默认 screencast）
    this.cdpSession = null;    // 当前查看页面的 CDP session
    this.isReady = false;
    this.loggedIn = false;
    this.username = null;
    this.screencastActive = false;
    this.wsClient = null;      // WebSocket connection

    // Worker Pool
    this.workerPages = [];     // PageSlot[] — 任务执行用的 worker 页面
    this.maxPages = 3;         // 最大并行页面数（可配置 3/5/8）
    this.viewingTabIndex = -1; // 当前查看的 tab（-1=主页, 0+=worker 页）

    // Per-user task queue
    this.tasks = new Map();       // taskId → task object
    this.taskQueue = [];          // pending taskId queue
    this.processing = false;

    // Login detection
    this.loginPollInterval = null;
    this.loginStatus = 'idle';
    this._loginDetectInterval = null;
    this.douyinPage = null;

    // Idle timer
    this.lastActivity = Date.now();
    this.idleTimer = null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /** 当前查看的页面 */
  get viewedPage() {
    if (this.viewingTabIndex < 0) return this.page;
    return this.workerPages[this.viewingTabIndex]?.page || this.page;
  }

  /** 当前查看的页面是否在 RPA 设置中 */
  get viewedPageSetupInProgress() {
    if (this.viewingTabIndex < 0) return false;
    const slot = this.workerPages[this.viewingTabIndex];
    return slot?.pageSetupInProgress || false;
  }
}

// ============================================================================
// JimengRPA 类（多用户版）
// ============================================================================
class JimengRPA {
  constructor() {
    this.browser = null;               // Shared Chrome instance
    this.userSessions = new Map();     // userId → UserSession
    this._initPromise = null;          // Browser launch lock

    // Global task lookup (for getTaskStatus by taskId)
    this.allTasks = new Map();         // taskId → task object

    // Idle cleanup: 30 minutes
    this.IDLE_TIMEOUT = 30 * 60 * 1000;
  }

  // ────────────────────────────────────────────────────
  // 浏览器生命周期（共享 Chrome 实例）
  // ────────────────────────────────────────────────────

  /**
   * 确保共享浏览器实例存在
   */
  async ensureBrowser() {
    if (this.browser) {
      try {
        // 健康检查: 获取浏览器版本
        await this.browser.version();
        return;
      } catch (e) {
        console.log('[Jimeng-RPA] 浏览器失联，重启...');
        await this.close();
      }
    }

    // 防止并发初始化
    if (this._initPromise) {
      await this._initPromise;
      return;
    }

    this._initPromise = this._launchBrowser();
    await this._initPromise;
    this._initPromise = null;
  }

  /**
   * 启动共享浏览器（不创建页面，页面由各用户 session 创建）
   */
  async _launchBrowser() {
    // 清理可能残留的孤儿 Chrome 进程（上次服务器重启后遗留的）
    if (process.platform === 'linux') {
      try {
        const { execSync } = require('child_process');
        const output = execSync(
          "ps -eo pid,etimes,args | grep 'puppeteer_dev_chrome_profile' | grep 'snap/chromium' | grep -v grep | awk '$2 > 3600 {print $1}'",
          { encoding: 'utf8', timeout: 5000 }
        );
        if (output.trim()) {
          const pids = output.trim().split('\n');
          console.log(`[Jimeng-RPA] 清理 ${pids.length} 个孤儿 Chrome 进程`);
          pids.forEach(pid => { try { process.kill(parseInt(pid), 'SIGKILL'); } catch (_) {} });
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (_) {}
    }

    // 一律 headless — BrowserViewer 已提供可视化操作界面
    const useHeadless = true;
    console.log('[Jimeng-RPA] 启动浏览器... (headless)');
    this.browser = await puppeteer.launch({
      headless: useHeadless ? 'new' : false,
      ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1300,1024',
        '--window-position=50,0',
        // 服务器无 GPU 才禁用；本地有 GPU 保持启用，screencast 更流畅
        ...(process.platform === 'linux' ? ['--disable-gpu'] : []),
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    console.log('[Jimeng-RPA] 浏览器就绪');
  }

  // ────────────────────────────────────────────────────
  // 用户会话管理
  // ────────────────────────────────────────────────────

  /**
   * 获取或创建用户会话
   */
  async getSession(userId) {
    let session = this.userSessions.get(userId);
    if (session && session.page) {
      try {
        await session.page.evaluate(() => true); // 健康检查
        session.touch();
        return session;
      } catch (e) {
        console.log(`[Jimeng-RPA] 用户 ${userId} 页面失联，重建会话`);
        await this.closeSessionForUser(userId);
      }
    }

    // account2 / dreamina 用独立浏览器，其他用共享浏览器
    if (userId.toString().endsWith('_account2') || isDreaminaUser(userId)) {
      session = await this._createAccount2Session(userId);
    } else {
      await this.ensureBrowser();
      session = await this._createSession(userId);
    }
    return session;
  }

  /**
   * 创建新的用户会话（独立 BrowserContext + Page）
   */
  async _createSession(userId) {
    const session = new UserSession(userId);
    session.urls = getUrlsForUser(userId);

    // 创建隔离的浏览器上下文
    session.context = await this.browser.createBrowserContext();
    session.page = await session.context.newPage();
    await session.page.setViewport({ width: 1280, height: 900 });
    await session.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // 隐藏 webdriver 特征
    await session.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 加载持久化 cookies
    await this._loadCookiesForUser(session);

    // 监听 SSO 弹窗（抖音登录弹窗）
    session.context.on('targetcreated', async (target) => {
      if (target.type() !== 'page') return;
      try {
        const newPage = await target.page();
        const url = newPage.url();
        if (url.includes('douyin.com') || url.includes('oauth') || url.includes('sso')) {
          console.log(`[Jimeng-RPA] 用户 ${userId} SSO 弹窗: ${url.substring(0, 60)}`);
          session.douyinPage = newPage;
          // 切换 screencast 到弹窗
          if (session.screencastActive) {
            await this.stopScreencast(session);
            const mainPage = session.page;
            session.page = newPage;
            await this.startScreencast(session);
            session._mainPage = mainPage; // 暂存主页面引用
          }
        }
      } catch (_) {}
    });

    session.context.on('targetdestroyed', async (target) => {
      if (!session.douyinPage) return;
      try {
        const pages = await session.context.pages();
        const douyinStillOpen = pages.some(p => {
          try { return p === session.douyinPage; } catch (_) { return false; }
        });
        if (!douyinStillOpen) {
          console.log(`[Jimeng-RPA] 用户 ${userId} SSO 弹窗已关闭`);
          session.douyinPage = null;
          // 切回主页面
          if (session._mainPage) {
            if (session.screencastActive) {
              await this.stopScreencast(session);
            }
            session.page = session._mainPage;
            session._mainPage = null;
            if (session.wsClient?.readyState === WebSocket.OPEN) {
              await this.startScreencast(session);
            }
          }
        }
      } catch (_) {}
    });

    session.isReady = true;
    this.userSessions.set(userId, session);

    // 启动空闲计时器
    this._startIdleTimer(session);

    console.log(`[Jimeng-RPA] 用户 ${userId} 会话已创建 (共 ${this.userSessions.size} 个活跃会话)`);
    return session;
  }

  /**
   * 创建账号2的独立会话（独立浏览器进程，完全隔离）
   */
  async _createAccount2Session(userId) {
    const label = isDreaminaUser(userId) ? 'Dreamina国际版' : '账号2';
    console.log(`[Jimeng-RPA] 启动${label}独立浏览器...`);
    const browser2 = await puppeteer.launch({
      headless: 'new',
      ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1300,1024',
        ...(process.platform === 'linux' ? ['--disable-gpu'] : []),
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const session = new UserSession(userId);
    session._ownBrowser = browser2; // 标记独立浏览器，关闭时要一起关
    session.urls = getUrlsForUser(userId);

    // 跟账号1一样用 createBrowserContext（隔离 context + cookie 文件持久化）
    session.context = await browser2.createBrowserContext();
    session.page = await session.context.newPage();
    await session.page.setViewport({ width: 1280, height: 900 });
    await session.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    await session.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 加载 cookies
    await this._loadCookiesForUser(session);

    // SSO 弹窗监听
    session.context.on('targetcreated', async (target) => {
      if (target.type() !== 'page') return;
      try {
        const newPage = await target.page();
        const url = newPage.url();
        if (url.includes('douyin.com') || url.includes('oauth') || url.includes('sso')) {
          console.log(`[Jimeng-RPA] 用户 ${userId} SSO 弹窗: ${url.substring(0, 60)}`);
          session.douyinPage = newPage;
          if (session.screencastActive) {
            await this.stopScreencast(session);
            const mainPage = session.page;
            session.page = newPage;
            await this.startScreencast(session);
            session._mainPage = mainPage;
          }
        }
      } catch (_) {}
    });

    session.context.on('targetdestroyed', async (target) => {
      if (!session.douyinPage) return;
      try {
        const pages = await session.context.pages();
        const douyinStillOpen = pages.some(p => {
          try { return p === session.douyinPage; } catch (_) { return false; }
        });
        if (!douyinStillOpen) {
          console.log(`[Jimeng-RPA] 用户 ${userId} SSO 弹窗已关闭`);
          session.douyinPage = null;
          if (session._mainPage) {
            if (session.screencastActive) await this.stopScreencast(session);
            session.page = session._mainPage;
            session._mainPage = null;
            if (session.wsClient?.readyState === WebSocket.OPEN) await this.startScreencast(session);
          }
        }
      } catch (_) {}
    });

    session.isReady = true;
    this.userSessions.set(userId, session);
    this._startIdleTimer(session);

    console.log(`[Jimeng-RPA] 用户 ${userId} 独立会话已创建 (共 ${this.userSessions.size} 个活跃会话)`);
    return session;
  }

  /**
   * 创建 Worker Page（在同一 BrowserContext 中新开 tab）
   * Worker page 用于执行任务，与主页面隔离
   */
  async _createWorkerPage(session) {
    const index = session.workerPages.length;
    const page = await session.context.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const slot = new PageSlot(index, page);
    session.workerPages.push(slot);

    // 监听页面崩溃/关闭
    page.on('close', () => {
      console.log(`[Jimeng-RPA] Worker page ${index} closed for user ${session.userId}`);
      slot.ready = false;
      slot.busy = false;
    });
    page.on('error', (err) => {
      console.error(`[Jimeng-RPA] Worker page ${index} error for user ${session.userId}:`, err.message);
      slot.ready = false;
    });

    console.log(`[Jimeng-RPA] Worker page ${index} created for user ${session.userId} (total: ${session.workerPages.length}/${session.maxPages})`);

    // 新 page 会抢走"活动页面"焦点，把正在看的页面拉回前台，保持 screencast 不断
    try {
      const viewedPage = session.viewingTabIndex < 0 ? session.page : session.workerPages[session.viewingTabIndex]?.page;
      if (viewedPage && viewedPage !== page) await viewedPage.bringToFront();
    } catch (_) {}

    return slot;
  }

  // ── 输入阶段互斥锁 ─────────────────────────────────
  // keyboard/mouse CDP 事件只对前台 tab 生效，
  // 多个 worker 并发时，输入阶段必须排队执行
  async _acquireInputLock(session) {
    if (!session._inputLock) session._inputLock = { locked: false, queue: [] };
    if (!session._inputLock.locked) {
      session._inputLock.locked = true;
      return;
    }
    return new Promise(resolve => session._inputLock.queue.push(resolve));
  }

  _releaseInputLock(session) {
    if (!session._inputLock) return;
    if (session._inputLock.queue.length > 0) {
      const next = session._inputLock.queue.shift();
      next();
    } else {
      session._inputLock.locked = false;
    }
    // 恢复监看页面到前台（如果没有下一个输入任务排队）
    if (!session._inputLock.locked) {
      try {
        const viewedPage = session.viewingTabIndex < 0 ? session.page : session.workerPages[session.viewingTabIndex]?.page;
        if (viewedPage) viewedPage.bringToFront().catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * 关闭指定用户的会话
   */
  async closeSessionForUser(userId) {
    const session = this.userSessions.get(userId);
    if (!session) return;

    // 停止 screencast
    await this.stopScreencast(session);

    // 停止登录检测
    if (session.loginPollInterval) {
      clearInterval(session.loginPollInterval);
      session.loginPollInterval = null;
    }
    if (session._loginDetectInterval) {
      clearInterval(session._loginDetectInterval);
      session._loginDetectInterval = null;
    }

    // 停止空闲计时器
    if (session.idleTimer) {
      clearInterval(session.idleTimer);
      session.idleTimer = null;
    }

    // 通知 WebSocket 客户端
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({ type: 'session_closed' }));
    }

    // 清理 worker pages
    for (const slot of session.workerPages) {
      slot.busy = false;
      slot.ready = false;
    }
    session.workerPages = [];

    // 关闭浏览器上下文（关闭该用户所有页面）
    if (session._ownBrowser) {
      // 账号2：关闭独立浏览器进程
      try { await session._ownBrowser.close(); } catch (_) {}
      session._ownBrowser = null;
    } else if (session.context) {
      try { await session.context.close(); } catch (_) {}
    }

    // 清理该用户的任务
    for (const [taskId, task] of session.tasks) {
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'failed';
        task.error = '会话已关闭';
      }
    }

    this.userSessions.delete(userId);
    console.log(`[Jimeng-RPA] 用户 ${userId} 会话已关闭 (剩余 ${this.userSessions.size} 个)`);

    // 所有会话都关闭了 → 也释放浏览器进程
    if (this.userSessions.size === 0 && this.browser) {
      console.log('[Jimeng-RPA] 所有会话已关闭，释放浏览器');
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
    }
  }

  /**
   * 关闭所有会话和浏览器
   */
  async close() {
    for (const userId of [...this.userSessions.keys()]) {
      await this.closeSessionForUser(userId);
    }
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
    }
    console.log('[Jimeng-RPA] 浏览器已关闭');
  }

  // ────────────────────────────────────────────────────
  // 用户手动登录流程（打开浏览器 → 用户自行登录 → 自动检测）
  // ────────────────────────────────────────────────────

  /**
   * 打开浏览器窗口，导航到即梦首页，用户自己登录
   */
  async openBrowserForUser(userId) {
    const session = await this.getSession(userId);
    const page = session.page;

    // 如果已经在平台页面，不重复导航
    const currentUrl = page.url();
    const urls = session.urls || getUrlsForUser(userId);
    if (!isPlatformUrl(currentUrl, userId)) {
      const platformLabel = isDreaminaUser(userId) ? 'Dreamina' : '即梦';
      console.log(`[Jimeng-RPA] 用户 ${userId} 打开${platformLabel}首页...`);
      await page.goto(urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    }

    // 等页面完全加载后再检查登录状态
    await new Promise(r => setTimeout(r, 3000));

    // 检查已有 cookies 是否有效（用户可能之前登录过）
    const status = await this._getLoginStatus(session);
    console.log(`[Jimeng-RPA] 用户 ${userId} openBrowser 登录检测:`, JSON.stringify(status), 'loggedIn:', session.loggedIn);

    // 如果仍未登录，启动轮询检测
    if (!session.loggedIn) {
      this._startLoginDetect(session);
    }

    session.touch();
    return { browserOpen: true, url: page.url(), loggedIn: session.loggedIn };
  }

  /**
   * 获取浏览器状态（不会启动浏览器）
   */
  async getBrowserStatusForUser(userId) {
    const session = this.userSessions.get(userId);
    if (!session || !session.page) {
      return { browserOpen: false, loggedIn: false, url: null };
    }

    try {
      await session.page.evaluate(() => true); // 健康检查
      const url = session.page.url();
      // 如果浏览器在运行但登录状态未知，主动检测一次
      if (!session.loggedIn && (url.includes('jimeng.jianying.com') || url.includes('dreamina.capcut.com'))) {
        await this._getLoginStatus(session);
      }
      return { browserOpen: true, loggedIn: session.loggedIn, url };
    } catch (e) {
      return { browserOpen: false, loggedIn: false, url: null };
    }
  }

  /**
   * 关闭浏览器（供前端调用）
   */
  async closeBrowserForUser(userId) {
    await this.closeSessionForUser(userId);
    return { browserOpen: false };
  }

  /**
   * 后台轮询检测用户是否已在浏览器中完成登录
   * 每 5 秒检查一次，检测到登录后自动保存 cookies
   */
  _startLoginDetect(session) {
    if (session._loginDetectInterval) return; // 已在轮询

    session._loginDetectInterval = setInterval(async () => {
      if (!session.page || session.loggedIn) {
        clearInterval(session._loginDetectInterval);
        session._loginDetectInterval = null;
        return;
      }

      try {
        const status = await this._getLoginStatus(session);
        if (status.loggedIn) {
          console.log(`[Jimeng-RPA] 用户 ${session.userId} 检测到已登录！`);
          clearInterval(session._loginDetectInterval);
          session._loginDetectInterval = null;
          // 通知 WebSocket 客户端
          if (session.wsClient?.readyState === WebSocket.OPEN) {
            session.wsClient.send(JSON.stringify({ type: 'login_detected' }));
          }
        }
      } catch (_) {}
    }, 5000);
  }

  // ────────────────────────────────────────────────────
  // Cookie 持久化（按用户 ID）
  // ────────────────────────────────────────────────────

  async _saveCookiesForUser(session) {
    if (!session.page) return;
    try {
      // 用 CDP 获取所有域名的 cookies（不只是当前页面的）
      const client = await session.page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      await client.detach();
      fs.writeFileSync(cookiePathForUser(session.userId), JSON.stringify(cookies, null, 2), 'utf-8');
      console.log(`[Jimeng-RPA] 用户 ${session.userId} Cookies 已保存 (${cookies.length} 条)`);
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${session.userId} 保存 cookies 失败:`, e.message);
    }
  }

  async _loadCookiesForUser(session) {
    if (!session.page) return false;
    try {
      const cookiePath = cookiePathForUser(session.userId);
      if (!fs.existsSync(cookiePath)) return false;
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      if (cookies.length > 0) {
        await session.page.setCookie(...cookies);
        console.log(`[Jimeng-RPA] 用户 ${session.userId} 已加载 ${cookies.length} 条 cookies`);
        return true;
      }
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${session.userId} 加载 cookies 失败:`, e.message);
    }
    return false;
  }

  // ────────────────────────────────────────────────────
  // 登录
  // ────────────────────────────────────────────────────

  /**
   * 检查登录状态（内部方法，接受 session）
   */
  async _getLoginStatus(session) {
    try {
      if (!session.page) return { loggedIn: false };

      // 如果当前不在平台页面，返回内存状态（不要为了检查就导航）
      const currentUrl = session.page.url();
      if (!currentUrl.includes('jimeng.jianying.com') && !currentUrl.includes('dreamina.capcut.com')) {
        return { loggedIn: session.loggedIn, username: session.username };
      }

      // 在即梦页面上，检查登录按钮是否存在
      const hasLoginBtn = await session.page.evaluate(() => {
        return !!document.querySelector('[class*=login-button]');
      });

      // 多种正向指标检测已登录
      const loginIndicators = await session.page.evaluate(() => {
        const body = document.body.innerText || '';
        return {
          hasLoginBtn: !!document.querySelector('[class*=login-button]'),
          hasVipText: body.includes('开会员'),
          hasAvatar: !!document.querySelector('[class*=avatar], [class*=Avatar], .user-avatar, img[class*=avatar]'),
          hasCreditsNum: !!(body.match(/剩余.*?\d/) || body.match(/\d+.*积分/)),
          hasUserMenu: !!document.querySelector('[class*=user-info], [class*=userInfo], [class*=user-center]'),
          urlHint: window.location.href,
        };
      });
      console.log(`[Jimeng-RPA] 用户 ${session.userId} 登录指标:`, JSON.stringify(loginIndicators));

      if (hasLoginBtn) {
        // 有登录按钮 → 确定未登录
        session.loggedIn = false;
      } else {
        // 没有登录按钮 → 用多种正向指标确认
        const isLoggedIn = loginIndicators.hasVipText || loginIndicators.hasAvatar || loginIndicators.hasCreditsNum || loginIndicators.hasUserMenu;
        if (isLoggedIn && !session.loggedIn) {
          session.loggedIn = true;
          session.loginStatus = 'confirmed';
          await this._saveCookiesForUser(session);
          console.log(`[Jimeng-RPA] 用户 ${session.userId} 检测到已登录，cookies 已保存`);
        }
        if (!isLoggedIn && !hasLoginBtn && !session.loggedIn) {
          console.log(`[Jimeng-RPA] 用户 ${session.userId} 无法确认登录状态，页面可能还在加载`);
        }
      }

      return { loggedIn: session.loggedIn, username: session.username };
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${session.userId} 检查登录状态失败:`, e.message);
      return { loggedIn: session.loggedIn || false };
    }
  }

  /**
   * 获取登录状态（供路由调用，接受 userId）
   */
  async getLoginStatus(userId) {
    const session = this.userSessions.get(userId);
    if (!session) return { loggedIn: false };
    return await this._getLoginStatus(session);
  }

  /**
   * QR 码登录 — 完整流程
   */
  async startQRLogin(userId) {
    try {
      const session = await this.getSession(userId);
      const page = session.page;
      session.loginStatus = 'waiting';
      session.douyinPage = null;

      // 1. 导航到即梦图片生成页
      const urls = session.urls || getUrlsForUser(userId);
      console.log(`[Jimeng-RPA] 用户 ${userId} QR登录: 导航到即梦...`);
      await page.goto(urls.imageGen, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      // 2. 注册弹窗监听（在点击登录之前）
      const popupPromise = new Promise((resolve) => {
        const onTarget = async (target) => {
          if (target.type() === 'page') {
            const newPage = await target.page();
            const url = newPage.url();
            if (url.includes('douyin.com') || url.includes('oauth')) {
              session.context.off('targetcreated', onTarget);
              resolve(newPage);
            }
          }
        };
        session.context.on('targetcreated', onTarget);
        setTimeout(() => {
          session.context.off('targetcreated', onTarget);
          resolve(null);
        }, 30000);
      });

      // 3. 点击登录按钮
      console.log(`[Jimeng-RPA] 用户 ${userId} QR登录: 点击登录...`);
      const loginBtn = await page.$('[class*=login-button]');
      if (!loginBtn) throw new Error('找不到登录按钮');
      await loginBtn.click();
      await new Promise(r => setTimeout(r, 2000));

      // 4. 同意隐私协议（如果出现）
      const agreeBtn = await page.$('.lv-modal-wrapper button.lv-btn-primary');
      if (agreeBtn) {
        const btnText = await page.evaluate(el => el.textContent.trim(), agreeBtn);
        if (btnText === '同意') {
          console.log(`[Jimeng-RPA] 用户 ${userId} QR登录: 同意协议...`);
          await agreeBtn.click();
        }
      }

      // 5. 等待抖音 SSO 弹窗
      console.log(`[Jimeng-RPA] 用户 ${userId} QR登录: 等待抖音登录窗口...`);
      const douyinPage = await popupPromise;
      if (!douyinPage) throw new Error('抖音登录窗口未打开');

      session.douyinPage = douyinPage;
      console.log(`[Jimeng-RPA] 用户 ${userId} QR登录: 抖音窗口已打开:`, douyinPage.url().substring(0, 60));

      // 6. 等待 QR 码加载
      await new Promise(r => setTimeout(r, 3000));

      // 7. 截取 QR 码区域
      const qrScreenshot = await douyinPage.screenshot({ encoding: 'base64', fullPage: false });

      // 8. 启动登录检测轮询
      this._startLoginPoll(session);

      session.touch();
      return { qrImageBase64: qrScreenshot, loginId: 'qr-' + Date.now() };
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${userId} 获取 QR 码失败:`, e.message);
      const session = this.userSessions.get(userId);
      if (session) session.loginStatus = 'expired';
      throw e;
    }
  }

  /**
   * 刷新 QR 码
   */
  async refreshQRCode(userId) {
    const session = this.userSessions.get(userId);
    if (!session?.douyinPage) throw new Error('抖音登录窗口不存在');
    try {
      await session.douyinPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await new Promise(r => setTimeout(r, 3000));
      const qrScreenshot = await session.douyinPage.screenshot({ encoding: 'base64', fullPage: false });
      return { qrImageBase64: qrScreenshot };
    } catch (e) {
      throw new Error('刷新 QR 码失败: ' + e.message);
    }
  }

  /**
   * 轮询检测登录成功
   */
  _startLoginPoll(session) {
    if (session.loginPollInterval) clearInterval(session.loginPollInterval);
    let polling = false;

    session.loginPollInterval = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        if (!session.page) { polling = false; return; }

        // 检查抖音弹窗是否已关闭
        let douyinClosed = false;
        if (session.douyinPage) {
          try {
            await session.douyinPage.evaluate(() => true);
            const douyinUrl = session.douyinPage.url();
            if (douyinUrl.includes('login_success') || douyinUrl.includes('callback')) {
              douyinClosed = true;
            }
          } catch (e) {
            douyinClosed = true;
          }
        } else {
          polling = false;
          return;
        }

        if (!douyinClosed) { polling = false; return; }

        console.log(`[Jimeng-RPA] 用户 ${session.userId} 检测到抖音弹窗关闭，验证登录状态...`);

        let loginBtnGone = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          await new Promise(r => setTimeout(r, 5000));
          await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(r => setTimeout(r, 3000));

          loginBtnGone = await session.page.evaluate(() => {
            return !document.querySelector('[class*=login-button]');
          });
          console.log(`[Jimeng-RPA] 用户 ${session.userId} 登录验证第 ${attempt} 次: loginBtnGone=${loginBtnGone}`);
          if (loginBtnGone) break;
        }

        if (loginBtnGone) {
          session.loggedIn = true;
          session.loginStatus = 'confirmed';
          session.douyinPage = null;
          await this._saveCookiesForUser(session);
          clearInterval(session.loginPollInterval);
          session.loginPollInterval = null;
          console.log(`[Jimeng-RPA] 用户 ${session.userId} QR 码登录成功！`);
          // 通知 WebSocket
          if (session.wsClient?.readyState === WebSocket.OPEN) {
            session.wsClient.send(JSON.stringify({ type: 'login_detected' }));
          }
        } else {
          console.log(`[Jimeng-RPA] 用户 ${session.userId} 抖音弹窗关闭但登录未成功`);
          session.loginStatus = 'expired';
          session.douyinPage = null;
          clearInterval(session.loginPollInterval);
          session.loginPollInterval = null;
        }
      } catch (e) {
        console.error(`[Jimeng-RPA] 用户 ${session.userId} 轮询检测出错:`, e.message);
      } finally {
        polling = false;
      }
    }, 3000);
  }

  /**
   * Session ID 导入（兜底方案）
   */
  async importSession(userId, sessionId) {
    try {
      const session = await this.getSession(userId);
      const page = session.page;

      const cookies = this._parseSessionCookies(sessionId);
      await page.setCookie(...cookies);

      const urls = session.urls || getUrlsForUser(userId);
      await page.goto(urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      await this._saveCookiesForUser(session);
      const status = await this._getLoginStatus(session);
      session.touch();
      return status;
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${userId} 导入 Session 失败:`, e.message);
      return { loggedIn: false, error: e.message };
    }
  }

  /**
   * 将 sessionId 字符串转为 cookie 数组
   */
  _parseSessionCookies(input) {
    const domain = '.jianying.com';
    const cookies = [];

    if (input.includes('sessionid=')) {
      for (const pair of input.split(';')) {
        const [name, ...rest] = pair.trim().split('=');
        if (name && rest.length) {
          cookies.push({
            name: name.trim(),
            value: rest.join('=').trim(),
            domain,
            path: '/',
          });
        }
      }
    } else {
      const sid = input.trim();
      const now = Math.floor(Date.now() / 1000);
      cookies.push(
        { name: 'sessionid', value: sid, domain, path: '/' },
        { name: 'sessionid_ss', value: sid, domain, path: '/' },
        { name: 'sid_tt', value: sid, domain, path: '/' },
        { name: 'sid_guard', value: `${sid}%7C${now}%7C5184000%7C${now + 5184000}`, domain, path: '/' },
      );
    }
    return cookies;
  }

  /**
   * 退出登录
   */
  async logout(userId) {
    try {
      const cookiePath = cookiePathForUser(userId);
      if (fs.existsSync(cookiePath)) {
        fs.unlinkSync(cookiePath);
      }
      const session = this.userSessions.get(userId);
      if (session?.page) {
        const cookies = await session.page.cookies();
        if (cookies.length > 0) {
          await session.page.deleteCookie(...cookies);
        }
        session.loggedIn = false;
        session.username = null;
      }
      console.log(`[Jimeng-RPA] 用户 ${userId} 已退出登录`);
      return { ok: true };
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${userId} 退出登录失败:`, e.message);
      return { ok: false, error: e.message };
    }
  }

  // ────────────────────────────────────────────────────
  // 截图调试（用于发现 DOM 选择器）
  // ────────────────────────────────────────────────────

  async takeScreenshot(userId) {
    const session = await this.getSession(userId);
    const screenshot = await session.page.screenshot({ encoding: 'base64', fullPage: false });
    session.touch();
    return screenshot;
  }

  async navigateAndScreenshot(userId, url) {
    const session = await this.getSession(userId);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const screenshot = await session.page.screenshot({ encoding: 'base64', fullPage: false });
    session.touch();
    return screenshot;
  }

  async clickButtonAndScreenshot(userId, index, waitMs = 3000) {
    const session = await this.getSession(userId);
    const page = session.page;
    const clicked = await page.evaluate((idx) => {
      const buttons = document.querySelectorAll('button, [class*="button-"]');
      if (idx >= buttons.length) return null;
      const btn = buttons[idx];
      btn.click();
      return { text: btn.textContent?.trim().substring(0, 60), tag: btn.tagName, className: btn.className?.substring(0, 80) };
    }, index);

    if (!clicked) {
      throw new Error(`Button index ${index} not found`);
    }

    await new Promise(r => setTimeout(r, waitMs));
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
    const newUrl = page.url();
    session.touch();
    return { screenshot, clicked, newUrl };
  }

  async evalAndScreenshot(userId, code, waitMs = 3000) {
    const session = await this.getSession(userId);
    const page = session.page;
    const evalResult = await page.evaluate(code);
    await new Promise(r => setTimeout(r, waitMs));
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
    const newUrl = page.url();
    session.touch();
    return { screenshot, evalResult, newUrl };
  }

  async listPages(userId) {
    const session = this.userSessions.get(userId);
    if (!session?.context) return [];
    const pages = await session.context.pages();
    const info = [];
    for (const p of pages) {
      try {
        info.push({ url: p.url(), title: await p.title() });
      } catch (e) {
        info.push({ url: '(error)', title: e.message });
      }
    }
    return info;
  }

  async getDOMSummary(userId) {
    const session = await this.getSession(userId);
    const page = session.page;
    session.touch();
    return await page.evaluate(() => {
      const summary = {
        url: window.location.href,
        title: document.title,
        inputs: [],
        buttons: [],
        textareas: [],
        fileInputs: [],
        contentEditables: [],
      };

      document.querySelectorAll('input').forEach(el => {
        summary.inputs.push({
          type: el.type,
          placeholder: el.placeholder,
          className: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').substring(0, 100),
          id: el.id,
        });
      });

      document.querySelectorAll('button').forEach(el => {
        summary.buttons.push({
          text: el.textContent?.trim().substring(0, 50),
          className: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').substring(0, 100),
          id: el.id,
        });
      });

      document.querySelectorAll('textarea').forEach(el => {
        summary.textareas.push({
          placeholder: el.placeholder,
          className: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').substring(0, 100),
          id: el.id,
        });
      });

      document.querySelectorAll('input[type="file"]').forEach(el => {
        summary.fileInputs.push({
          accept: el.accept,
          className: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').substring(0, 100),
          id: el.id,
        });
      });

      document.querySelectorAll('[contenteditable="true"]').forEach(el => {
        summary.contentEditables.push({
          tagName: el.tagName,
          className: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').substring(0, 100),
          id: el.id,
          text: el.textContent?.trim().substring(0, 50),
        });
      });

      return summary;
    });
  }

  // ────────────────────────────────────────────────────
  // 任务队列（每用户独立队列，全局 Map 供查询）
  // ────────────────────────────────────────────────────

  /**
   * 加入任务队列
   */
  enqueueTask(userId, type, opts) {
    const session = this.userSessions.get(userId);
    if (!session) throw new Error('会话不存在，请先打开浏览器');

    const taskId = `jimeng-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task = {
      id: taskId,
      userId,
      type,       // 'image' | 'video'
      opts,
      status: 'queued',
      progress: null,
      createdAt: Date.now(),
      result: null,
      error: null,
    };
    session.tasks.set(taskId, task);
    this.allTasks.set(taskId, task);
    session.taskQueue.push(taskId);
    console.log(`[Jimeng-RPA] 用户 ${userId} 任务入队: ${taskId} (${type}), 队列长度: ${session.taskQueue.length}`);
    this._processQueue(session); // 非阻塞启动
    session.touch();
    return taskId;
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId) {
    const task = this.allTasks.get(taskId);
    if (!task) return null;

    // 计算在对应用户队列中的位置
    const session = this.userSessions.get(task.userId);
    const queuePosition = session ? session.taskQueue.indexOf(taskId) : -1;

    return {
      id: task.id,
      type: task.type,
      status: task.status,
      progress: task.progress || null,
      result: task.status === 'completed' ? task.result : undefined,
      error: task.status === 'failed' ? task.error : undefined,
      queuePosition: task.status === 'queued' ? queuePosition : undefined,
    };
  }

  /**
   * 取消任务（通过 nodeId 匹配，因为前端用 nodeId 作为 taskId）
   */
  cancelTask(userId, nodeId) {
    // 通过 userId + nodeId 精确匹配任务
    for (const [taskId, task] of this.allTasks) {
      if (task.userId === userId && task.opts?.nodeId === nodeId && (task.status === 'queued' || task.status === 'running')) {
        task.cancelled = true;
        task.status = 'failed';
        task.error = '已取消';
        console.log(`[Jimeng-RPA] 任务 ${taskId} (nodeId=${nodeId}) 已标记取消`);
        return true;
      }
    }
    return false;
  }

  /**
   * 处理队列 — Worker Pool 模式（每用户独立）
   * 将排队任务分配给空闲的 worker page，多 page 并行执行
   */
  async _processQueue(session) {
    if (session.processing) return;
    if (session.taskQueue.length === 0) return;

    session.processing = true;
    let createFailCount = 0;

    while (session.taskQueue.length > 0) {
      // 尝试恢复崩溃的 worker page
      for (const slot of session.workerPages) {
        if (!slot.ready && !slot.busy) {
          try {
            await slot.page.evaluate(() => true);
            slot.ready = true;
          } catch (_) {
            try {
              const newPage = await session.context.newPage();
              await newPage.setViewport({ width: 1280, height: 900 });
              await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
              await newPage.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
              });
              slot.page = newPage;
              slot.ready = true;
              console.log(`[Jimeng-RPA] Worker page ${slot.index} recovered for user ${session.userId}`);
              // 恢复的 page 会抢焦点，把正在看的页面拉回前台
              try {
                const viewedPage = session.viewingTabIndex < 0 ? session.page : session.workerPages[session.viewingTabIndex]?.page;
                if (viewedPage && viewedPage !== newPage) await viewedPage.bringToFront();
              } catch (_) {}
            } catch (recoverErr) {
              console.error(`[Jimeng-RPA] Worker page ${slot.index} recovery failed:`, recoverErr.message);
            }
          }
        }
      }

      // 找空闲 worker page
      let freeSlot = session.workerPages.find(ws => !ws.busy && ws.ready);

      // 没有空闲且未达上限 → 创建新 worker page
      // 但如果输入锁被占用，必须等锁释放后再创建（browser.newPage() 会抢焦点）
      if (!freeSlot && session.workerPages.length < session.maxPages) {
        let holdingLock = false;
        if (session._inputLock && session._inputLock.locked) {
          console.log(`[Jimeng-RPA] 输入锁占用中，等待释放后再创建新 worker page`);
          await new Promise(resolve => session._inputLock.queue.push(resolve));
          holdingLock = true;
        }
        try {
          freeSlot = await this._createWorkerPage(session);
          createFailCount = 0;
        } catch (err) {
          createFailCount++;
          console.error(`[Jimeng-RPA] Failed to create worker page (attempt ${createFailCount}):`, err.message);
          if (createFailCount >= 3) {
            console.error(`[Jimeng-RPA] 连续 3 次创建 worker page 失败，停止尝试`);
            if (holdingLock) this._releaseInputLock(session);
            break;
          }
          if (holdingLock) this._releaseInputLock(session);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        // 创建完成，释放锁（下面 _executeTaskOnWorker 会自己再拿锁）
        if (holdingLock) this._releaseInputLock(session);
      }

      // 所有 page 都忙且已达上限 → 等待
      if (!freeSlot) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // 取出任务
      const taskId = session.taskQueue.shift();
      const task = session.tasks.get(taskId);
      if (!task || task.cancelled) continue;

      // 分配到 worker
      freeSlot.busy = true;
      freeSlot.currentTaskId = taskId;
      freeSlot.currentTaskType = task.type;
      task.status = 'running';
      task.workerIndex = freeSlot.index;

      console.log(`[Jimeng-RPA] 用户 ${session.userId} 任务 ${taskId} (${task.type}) → worker page ${freeSlot.index}`);

      // 在 worker 上执行任务（非阻塞 — 不等待完成，继续分配下一个任务）
      this._executeTaskOnWorker(session, freeSlot, task);

      // 推送 worker 状态给前端
      this._sendWorkerStatusUpdate(session);

      // 任务间小间隔，避免太快
      await new Promise(r => setTimeout(r, 500));
    }

    session.processing = false;
  }

  /**
   * 在指定 worker page 上执行任务
   * 输入阶段（导航 + 设置 + 点生成）通过互斥锁排队，确保 bringToFront 不冲突
   * 轮询阶段不需要前台，可以多 worker 并发等待
   */
  async _executeTaskOnWorker(session, slot, task) {
    const page = slot.page;
    try {
      if (task.type === 'image') {
        // ── 输入阶段：加锁 + bringToFront ──
        await this._acquireInputLock(session);
        let setupInfo;
        try {
          await page.bringToFront();
          console.log(`[Jimeng-RPA] 任务 ${task.id} 输入阶段开始 (worker ${slot.index})`);
          setupInfo = await this._imageSetupAndClickOnPage(page, session, task.opts);
        } finally {
          this._releaseInputLock(session);
        }
        // ── 等待阶段：DOM 轮询（不需要前台，与视频一致） ──
        const urls = await this._pollForImageResult(page, setupInfo.initialRecordCount, setupInfo.markerId, task);
        task.result = urls;
        task.status = 'completed';
        console.log(`[Jimeng-RPA] 任务 ${task.id} 完成 (worker ${slot.index}), ${urls.length} 张原图`);
      } else if (task.type === 'video') {
        // ── 输入阶段：加锁 + bringToFront ──
        slot.pageSetupInProgress = true;
        await this._acquireInputLock(session);
        let pollInfo;
        try {
          await page.bringToFront();
          console.log(`[Jimeng-RPA] 视频任务 ${task.id} 输入阶段开始 (worker ${slot.index})`);
          pollInfo = await this._videoSetupAndClickOnPage(page, session, task.opts, task);
        } finally {
          slot.pageSetupInProgress = false;
          this._releaseInputLock(session);
        }
        // ── 轮询阶段：无锁，并发等待 ──
        const urls = await this._pollForVideoResult(page, pollInfo.submitId, pollInfo.prompt, pollInfo.initialRecordCount, task, session, pollInfo.markerId);
        task.result = urls;
        task.status = 'completed';
        console.log(`[Jimeng-RPA] 视频任务 ${task.id} 完成 (worker ${slot.index})`);
        console.log(`[Jimeng-RPA] ============================================================`);
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err.message;
      console.error(`[Jimeng-RPA] 任务 ${task.id} 失败 (worker ${slot.index}):`, err.message);

      // 检查 page 是否还活着
      try { await page.evaluate(() => true); } catch (_) {
        slot.ready = false;
        console.warn(`[Jimeng-RPA] Worker page ${slot.index} 已失联，标记为不可用`);
      }
    }

    // 释放 slot
    slot.busy = false;
    slot.currentTaskId = null;
    slot.currentTaskType = null;
    slot.currentProgress = null;

    // 推送状态更新
    this._sendWorkerStatusUpdate(session);

    // 如果队列还有任务，重新触发
    if (session.taskQueue.length > 0) {
      this._processQueue(session);
    }
  }

  // ────────────────────────────────────────────────────
  // 网络拦截 — 从即梦自己的 API 响应里拿结果
  // ────────────────────────────────────────────────────

  /**
   * 拦截 get_history_by_ids 响应，等待生成完成
   * @param {Page} page
   * @param {string} mode - 'image' | 'video'
   */
  async _waitForGenerationResult(page, mode) {
    if (!page) throw new Error('浏览器未就绪');

    return new Promise((resolve, reject) => {
      let resolved = false;
      const done = (fn, val) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        page.off('response', onResponse);
        fn(val);
      };

      const onResponse = async (response) => {
        if (resolved) return;
        try {
          const url = response.url();
          if (!url.includes('get_history_by_ids')) return;
          if (response.status() !== 200) return;

          const data = await response.json().catch(() => null);
          if (!data) return;

          const historyList = data?.data?.history_list || [];
          for (const h of historyList) {
            console.log(`[Jimeng-RPA] history status=${h.status}, fail_code=${h.fail_code || 'none'}, items=${h.item_list?.length || 0}`);
            // 还在处理中
            if (h.status === 20 || h.status === 42 || h.status === 45) continue;

            // 失败
            if (h.status === 30) {
              done(reject, new Error(`即梦生成失败 (fail_code: ${h.fail_code || 'unknown'}): ${h.fail_message || h.fail_reason || '未知错误'}`));
              return;
            }

            // 成功 (status 10 或 50)
            if (h.status === 10 || h.status === 50) {
              const urls = [];
              const itemList = h.item_list || [];

              if (mode === 'image') {
                for (const item of itemList) {
                  const imgUrl = item?.image?.large_images?.[0]?.image_url;
                  if (imgUrl) urls.push(imgUrl);
                }
              } else {
                for (const item of itemList) {
                  const vidUrl = item?.video?.transcoded_video?.origin?.video_url
                    || item?.video?.transcoded_video?.origin?.play_url;
                  if (vidUrl) urls.push(vidUrl);
                }
              }

              if (urls.length > 0) {
                done(resolve, { urls, historyId: h.history_id });
                return;
              }
            }
          }
        } catch (e) {
          // 解析失败，继续等
        }
      };

      page.on('response', onResponse);

      // DOM 轮询检测页面错误提示（如「网络异常」）— 比 5 分钟 timeout 快得多
      const errorCheckInterval = setInterval(async () => {
        if (resolved) { clearInterval(errorCheckInterval); return; }
        try {
          const errorText = await page.evaluate(() => {
            // 检查 toast / 提示文字
            const toasts = document.querySelectorAll('.lv-message, .lv-notification, [class*=toast], [class*=error], [class*=fail]');
            for (const t of toasts) {
              const txt = t.textContent?.trim();
              const lower = (txt || '').toLowerCase();
              if (txt && (txt.includes('网络异常') || txt.includes('失败') || txt.includes('错误') || txt.includes('违规') || txt.includes('敏感')
                || txt.includes('失敗') || txt.includes('錯誤') || txt.includes('違規') || txt.includes('網路') || txt.includes('網絡') || txt.includes('異常') || txt.includes('不當')
                || lower.includes('failed') || lower.includes('error') || lower.includes('violat') || lower.includes('sensitive') || lower.includes('network') || lower.includes('inappropriate') || lower.includes('community guidelines'))) {
                return txt.slice(0, 100);
              }
            }
            // 检查历史记录里的失败标记
            const failItems = document.querySelectorAll('[class*=status-fail], [class*=error-tip], [class*=fail-reason]');
            for (const f of failItems) {
              const txt = f.textContent?.trim();
              if (txt) return txt.slice(0, 100);
            }
            return null;
          });
          if (errorText) {
            console.log(`[Jimeng-RPA] DOM 检测到错误: ${errorText}`);
            clearInterval(errorCheckInterval);
            done(reject, new Error(`即梦生成失败: ${errorText}`));
          }
        } catch (_) { /* page 可能已关闭 */ }
      }, 3000);

      // 超时保护：5分钟后如果还没有结果，reject
      const timeout = setTimeout(() => {
        clearInterval(errorCheckInterval);
        done(reject, new Error('即梦生成超时（5分钟未收到结果）'));
      }, 5 * 60 * 1000);
    });
  }

  // ────────────────────────────────────────────────────
  // 图片生成 RPA
  // ────────────────────────────────────────────────────

  /**
   * 图片生成第一阶段：设置参数 + 点击生成（在指定 page 上执行）
   * 返回 { initialRecordCount, markerId } 供轮询使用
   */
  async _imageSetupAndClickOnPage(page, session, opts) {
    const { prompt, model, aspectRatio, resolution, referenceImages } = opts;
    if (!page) throw new Error('浏览器未就绪');

    console.log(`[Jimeng-RPA] 用户 ${session.userId} 图片生成: "${prompt.substring(0, 30)}..." 模型=${model} 比例=${aspectRatio}`);

    // 1. 导航到生成页面
    const urls = session.urls || JIMENG_URLS;
    await page.goto(urls.generate, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // 1.5 切换到"图片生成"模式
    await this._detectAndSwitchToImageMode(page);

    // 兼容新版 ProseMirror 编辑器 + 旧版 textarea
    await page.waitForFunction(() => {
      return document.querySelector('.ProseMirror[contenteditable=true]') ||
             document.querySelector('[contenteditable=true][class*=prompt]') ||
             document.querySelector('[contenteditable=true][class*=editor]') ||
             document.querySelector('textarea[class*=prompt-textarea]');
    }, { timeout: 15000 });

    // 2. 记录列表滚到底部，标记最后一条记录
    if (isDreaminaUser(session.userId)) await new Promise(r => setTimeout(r, 3000));
    await this._scrollRecordListToBottom(page);
    const BROAD_SELECTOR = '[class*=record-content-], [class*=video-record-]:not([class*=video-record-content])';
    const initialRecordCount = await page.evaluate((sel) => {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) els[els.length - 1].setAttribute('data-lo-existing', 'true');
      return els.length;
    }, BROAD_SELECTOR);
    console.log(`[Jimeng-RPA] 已标记最后一条记录 (共 ${initialRecordCount} 条)`);

    // 3. 选择模型
    if (model) {
      await this._selectImageModel(page, model);
    }

    // 4. 选择比例
    if (aspectRatio) {
      await this._selectAspectRatio(page, aspectRatio, resolution);
    }

    // 5. 上传参考图（复用视频的 DataTransfer 上传方式，与新版即梦页面兼容）
    if (referenceImages && referenceImages.length > 0) {
      await this._uploadVideoRefImages(page, referenceImages);
    } else {
      console.log(`[Jimeng-RPA] 无参考图`);
    }

    // 6. 输入提示词
    await this._enterPrompt(page, prompt);

    // 7. 点击生成按钮
    await this._clickGenerate(page);

    // 8. 立刻等待新记录出现并打标记
    const markerId = `jimeng-img-${Date.now()}`;
    const marked = await this._waitAndMarkNewRecord(page, markerId);
    if (!marked) {
      console.warn(`[Jimeng-RPA] 图片生成未能标记新记录，使用位置 fallback`);
    }

    return { initialRecordCount, markerId: marked ? markerId : null };
  }

  /**
   * 通过浏览器自动化生成图片（在指定 page 上执行）
   * 兼容旧调用：setup + poll 一步完成
   */
  async _generateImageOnPage(page, session, opts) {
    const resultPromise = this._waitForGenerationResult(page, 'image');
    await this._imageSetupAndClickOnPage(page, session, opts);
    const imgResult = await resultPromise;
    console.log(`[Jimeng-RPA] 图片生成完成: ${imgResult.urls.length} 张原图`);
    return imgResult.urls;
  }

  /**
   * DOM 轮询等待图片生成结果
   */
  async _pollForImageResult(page, initialRecordCount, markerId) {
    const pollInterval = 3000;
    let generationStarted = false;
    console.log(`[Jimeng-RPA] 图片轮询开始: markerId=${markerId || '(无)'}, initialCount=${initialRecordCount}`);

    while (true) {
      await new Promise(r => setTimeout(r, pollInterval));

      const result = await page.evaluate((args) => {
        const { initCount, markerId } = args;
        const RECORD_SELECTOR = '[class*=record-content]';

        // 优先用标记定位
        let newRecord = null;
        if (markerId) {
          newRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
        }
        // Fallback: 位置（图片页新记录在顶部 index 0）
        if (!newRecord) {
          const records = document.querySelectorAll(RECORD_SELECTOR);
          if (records.length <= initCount) return { status: 'waiting' };
          newRecord = records[0];
        }

        // 错误检测：只靠 CSS class 错误元素
        const errorEl = newRecord.querySelector('[class*=error-tips], [class*=error-msg]');
        if (errorEl) {
          return { status: 'failed', error: errorEl.textContent?.trim() || '生成失败' };
        }

        // 图片查找（加 fallback 选择器）
        const imgs = newRecord.querySelectorAll('[class*=slot-card-container] img, [class*=slot-card] img');
        if (imgs.length > 0) {
          const urls = Array.from(imgs).map(img => img.src).filter(src => src && src.startsWith('http'));
          if (urls.length > 0) {
            return { status: 'completed', urls };
          }
        }

        return { status: 'generating' };
      }, { initCount: initialRecordCount, markerId });

      if (result.status === 'completed') {
        return result.urls;
      } else if (result.status === 'failed') {
        throw new Error(result.error);
      } else if (result.status === 'generating') {
        generationStarted = true;
      } else if (result.status === 'waiting' && !generationStarted) {
        // 还没出现新记录，继续等待
      }
    }
  }

  /**
   * 选择图片模型
   */
  async _selectImageModel(page, model) {
    const MODEL_MAP = {
      'seedream-5.0-lite': 0, 'seedream-5.0': 0, '5.0': 0, '5.0-lite': 0,
      'seedream-4.6': 1, '4.6': 1,
      'seedream-4.5': 2, '4.5': 2,
      'seedream-4.1': 3, '4.1': 3, 'seedream-4.0-design': 3,
      'seedream-4.0': 4, '4.0': 4,
      'seedream-3.1': 5, '3.1': 5,
      'seedream-3.0': 6, '3.0': 6,
    };

    const targetIndex = MODEL_MAP[model];
    if (targetIndex === undefined) {
      console.log(`[Jimeng-RPA] 未知模型 "${model}"，使用页面默认`);
      return;
    }

    try {
      await page.evaluate(() => {
        // 跳过模式下拉（含 Agent/图片生成/视频生成 等文字），找模型下拉
        const MODE_KEYWORDS = ['Agent', '图片生成', '视频生成', '数字人', '配音', '动作', 'AI 影像', 'AI 影片', 'AI 代理', '虛擬替身', '音訊生成', '模仿動作'];
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of selects) {
          const vv = sel.querySelector('.lv-select-view-value');
          if (!vv) continue;
          const text = vv.textContent.trim();
          const isMode = MODE_KEYWORDS.some(kw => text.includes(kw));
          if (!isMode) {
            vv.click();
            return;
          }
        }
      });
      await new Promise(r => setTimeout(r, 1000));

      await page.evaluate((idx) => {
        const popups = document.querySelectorAll('.lv-select-popup');
        for (const popup of popups) {
          const options = popup.querySelectorAll('li.lv-select-option');
          if (options.length > 3 && options[idx]) {
            options[idx].click();
            return;
          }
        }
      }, targetIndex);
      await new Promise(r => setTimeout(r, 500));
      console.log(`[Jimeng-RPA] 已选择模型: ${model}`);
    } catch (e) {
      console.error('[Jimeng-RPA] 选择模型失败:', e.message);
    }
  }

  /**
   * 选择比例和分辨率
   */
  async _selectAspectRatio(page, ratio, resolution) {
    try {
      // 打开比例弹窗：找工具栏上的比例按钮
      const btnSelector = 'button[class*=button-][class*=toolbar-button]:not(.lv-btn-icon-only)';
      try {
        await page.waitForSelector(btnSelector, { timeout: 5000 });
        await page.click(btnSelector);
      } catch (e) {
        console.error('[Jimeng-RPA] 比例按钮未找到:', e.message);
        return;
      }
      await new Promise(r => setTimeout(r, 1000));

      // 检测弹窗是否打开（兼容 radio 和非 radio 布局）
      const popoverOpen = await page.evaluate(() => {
        const p = document.querySelector('.lv-popover-inner-content');
        return !!(p && p.offsetHeight > 0);
      });
      if (!popoverOpen) {
        console.warn('[Jimeng-RPA] 比例弹窗未打开，重试...');
        await page.click(btnSelector);
        await new Promise(r => setTimeout(r, 1000));
      }

      // 先 dump 弹窗结构便于调试
      const popoverDebug = await page.evaluate(() => {
        const p = document.querySelector('.lv-popover-inner-content');
        if (!p) return 'no popover';
        const radios = p.querySelectorAll('input[type=radio]');
        const clickables = p.querySelectorAll('label, span, div, button');
        const texts = [];
        for (const el of clickables) {
          const t = el.textContent?.trim();
          if (t && t.length < 20 && !texts.includes(t)) texts.push(t);
        }
        return { radioCount: radios.length, radioValues: Array.from(radios).map(r => r.value), clickableTexts: texts.slice(0, 30) };
      });
      console.log(`[Jimeng-RPA] 比例弹窗结构:`, JSON.stringify(popoverDebug));

      // 通用点击函数：在弹窗内找目标文字并点击
      const clickInPopover = async (targetText) => {
        return await page.evaluate((target) => {
          const p = document.querySelector('.lv-popover-inner-content');
          if (!p) return { found: false, reason: 'no popover' };

          // 策略1: radio value 匹配
          const radios = p.querySelectorAll('input[type=radio]');
          for (const radio of radios) {
            if (radio.value === target) {
              radio.click();
              return { found: true, method: 'radio-value', value: target };
            }
          }

          // 策略2: 精确文字匹配 — 找最小的(最内层的)匹配元素
          let bestMatch = null;
          let bestLen = Infinity;
          const all = p.querySelectorAll('*');
          for (const el of all) {
            // 只看叶子级或文本内容精确匹配的
            const t = el.textContent?.trim();
            if (t === target && t.length < bestLen) {
              bestLen = t.length;
              bestMatch = el;
            }
          }
          if (bestMatch) {
            // 优先点内部 radio，否则直接 click
            const radio = bestMatch.querySelector('input[type=radio]') || bestMatch.closest('label')?.querySelector('input[type=radio]');
            if (radio) { radio.click(); return { found: true, method: 'text-match-radio', text: target }; }
            bestMatch.click();
            return { found: true, method: 'text-match-click', text: target };
          }

          return { found: false, reason: `no match for "${target}"` };
        }, targetText);
      };

      // 选择分辨率
      if (resolution) {
        const resText = resolution === '4k' || resolution === '4K' ? '极清 4K' : '高清 2K';
        // 先尝试带前缀的文字，再 fallback 到纯 2k/4k radio value
        let resResult = await clickInPopover(resText);
        if (!resResult.found) {
          const resValue = resolution === '4k' || resolution === '4K' ? '4k' : '2k';
          resResult = await clickInPopover(resValue);
        }
        console.log(`[Jimeng-RPA] 分辨率选择:`, JSON.stringify(resResult));
        await new Promise(r => setTimeout(r, 300));
      }

      // 选择比例
      if (ratio) {
        const isAuto = ratio === 'auto' || ratio === 'smart';
        const targetText = isAuto ? '智能' : ratio;
        const ratioResult = await clickInPopover(targetText);
        console.log(`[Jimeng-RPA] 比例选择 (${targetText}):`, JSON.stringify(ratioResult));
        await new Promise(r => setTimeout(r, 500));
      }

      // 关闭弹窗：点击页面空白处
      await page.mouse.click(10, 10);
      await new Promise(r => setTimeout(r, 300));

      console.log(`[Jimeng-RPA] 已选择比例: ${ratio || '默认'}, 分辨率: ${resolution || '默认'}`);
    } catch (e) {
      console.error('[Jimeng-RPA] 选择比例失败:', e.message);
    }
  }

  /**
   * 输入提示词（React 受控组件方式）
   */
  async _enterPrompt(page, prompt) {
    // 优先 ProseMirror 编辑器（新版即梦），fallback 到旧版 textarea
    const usedEditor = await page.evaluate((text) => {
      // 尝试 ProseMirror / contenteditable 编辑器
      const editors = document.querySelectorAll('.ProseMirror[contenteditable=true], [contenteditable=true][class*=prompt], [contenteditable=true][class*=editor]');
      for (const ed of editors) {
        const rect = ed.getBoundingClientRect();
        if (rect.width > 200 && ed.offsetParent !== null) {
          ed.focus();
          document.execCommand('selectAll');
          document.execCommand('delete');
          document.execCommand('insertText', false, text);
          return 'contenteditable';
        }
      }
      // 更宽松：任何可见的 contenteditable
      const allCe = document.querySelectorAll('[contenteditable=true]');
      for (const ed of allCe) {
        const rect = ed.getBoundingClientRect();
        if (rect.width > 200 && ed.offsetParent !== null) {
          ed.focus();
          document.execCommand('selectAll');
          document.execCommand('delete');
          document.execCommand('insertText', false, text);
          return 'contenteditable-fallback';
        }
      }
      // 旧版 textarea
      const textarea = document.querySelector('textarea[class*=prompt-textarea]');
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(textarea, text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return 'textarea';
      }
      throw new Error('找不到 prompt 输入框（ProseMirror 和 textarea 都未找到）');
    }, prompt);
    await new Promise(r => setTimeout(r, 500));
    console.log(`[Jimeng-RPA] 已输入提示词 (${usedEditor}): "${prompt.substring(0, 40)}..."`);
  }

  /**
   * 点击生成按钮
   */
  async _clickGenerate(page) {
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[class*=submit-button]');
      return btn && !btn.classList.contains('lv-btn-disabled') && !btn.disabled;
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const btn = document.querySelector('button[class*=submit-button]:not(.lv-btn-disabled)');
      if (btn) btn.click();
    });
    console.log('[Jimeng-RPA] 已点击生成按钮');
  }

  /** 兼容旧调用：在主页面上生成图片 */
  async _generateImage(session, opts) {
    return this._generateImageOnPage(session.page, session, opts);
  }

  // ────────────────────────────────────────────────────
  // 视频生成 RPA（对齐第三方 Seedance 2.0 插件流程）
  // ────────────────────────────────────────────────────

  /**
   * 视频生成第一阶段：设置参数 + 点击生成（在指定 page 上执行）
   */
  async _videoSetupAndClickOnPage(page, session, opts, task) {
    const { prompt, model, aspectRatio, duration, mode, referenceImages, referenceVideos, referenceAudios, resolution } = opts;
    if (!page) throw new Error('浏览器未就绪');

    const effectiveModel = model || 'seedance-2.0';
    const hasRefs = referenceImages && referenceImages.length > 0;
    const hasVideoRefs = referenceVideos && referenceVideos.length > 0;
    const hasAudioRefs = referenceAudios && referenceAudios.length > 0;
    const effectiveMode = mode || (hasRefs || hasVideoRefs || hasAudioRefs ? 'first-last-frame' : 'omni-reference');

    console.log(`[Jimeng-RPA] ============================================================`);
    console.log(`[Jimeng-RPA] 用户 ${session.userId} 视频生成开始（设置阶段）`);
    console.log(`[Jimeng-RPA] config: model=${effectiveModel} mode=${effectiveMode} ratio=${aspectRatio || '16:9'} duration=${duration || '5s'} resolution=${resolution || '(无)'}`);
    console.log(`[Jimeng-RPA] config: ref_images=${hasRefs ? referenceImages.length : 0} ref_videos=${hasVideoRefs ? referenceVideos.length : 0} ref_audios=${hasAudioRefs ? referenceAudios.length : 0} prompt_len=${prompt.length}`);

    try {
      // 1. 检查是否已在生成页面
      const urls = session.urls || JIMENG_URLS;
      const currentUrl = page.url();
      const isOnGeneratePage = currentUrl.includes('/ai-tool/generate');
      if (isOnGeneratePage) {
        console.log(`[Jimeng-RPA] 已在生成页面，清理旧状态...`);
        const removedCount = await page.evaluate(() => {
          const closeBtns = document.querySelectorAll(
            '[class*=close], [class*=delete], [class*=remove], ' +
            '.upload-card-close, [class*=upload] [class*=close], ' +
            '[class*=ref] [class*=close], [class*=ref] [class*=delete]'
          );
          let count = 0;
          for (const btn of closeBtns) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.width < 40 && rect.height > 0 && rect.height < 40 && rect.bottom > 100) {
              btn.click();
              count++;
            }
          }
          return count;
        });
        if (removedCount > 0) {
          console.log(`[Jimeng-RPA] 已清理 ${removedCount} 个旧参考图`);
          await new Promise(r => setTimeout(r, 500));
        }
        await page.evaluate(() => {
          const editors = document.querySelectorAll('.ProseMirror[contenteditable=true], .tiptap[contenteditable=true], [contenteditable=true]');
          for (const ed of editors) {
            const rect = ed.getBoundingClientRect();
            if (rect.width > 200 && ed.offsetParent !== null) {
              ed.focus();
              document.execCommand('selectAll');
              document.execCommand('delete');
              break;
            }
          }
          const ta = document.querySelector('textarea[class*=prompt-textarea]');
          if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        console.log(`[Jimeng-RPA] 旧状态已清理`);
      } else {
        console.log(`[Jimeng-RPA] 导航到视频生成页面...`);
        await page.goto(urls.generate, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        // 等待底栏工具栏出现（最多 10 秒）
        try {
          await page.waitForSelector('[class*=toolbar-select], [class*=type-select], [class*=toolbar-select], [class*=type-sel]', { timeout: 10000 });
          console.log('[Jimeng-RPA] 底栏工具栏已加载');
        } catch (_) {
          console.warn('[Jimeng-RPA] 底栏工具栏 10s 内未出现');
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // 取消检查辅助函数
      const checkCancelled = () => {
        if (task && task.cancelled) {
          throw new Error('任务已取消');
        }
      };

      // 2. 检测底栏模式，确保在"视频生成"模式
      await this._detectAndSwitchToVideoMode(page);
      checkCancelled();

      // 3. 先选模型
      await this._selectVideoModel(page, effectiveModel);
      checkCancelled();

      // 4. 选择参考模式
      await this._selectVideoMode(page, effectiveMode);
      checkCancelled();

      // 5. 验证模型没被模式切换重置
      await this._selectVideoModel(page, effectiveModel);
      checkCancelled();

      // 6. 上传参考图（参数全部设定完毕后才上传）
      if (hasRefs) {
        if (effectiveMode === 'first-last-frame' && referenceImages.length === 2) {
          // 首尾帧模式：两张图分别上传到首帧和尾帧槽位
          await this._uploadFirstLastFrame(page, referenceImages[0], referenceImages[1]);
        } else {
          await this._uploadVideoRefImages(page, referenceImages);
        }
      }
      checkCancelled();

      // 8b. 上传参考视频
      if (hasVideoRefs) {
        await this._uploadVideoRefVideos(page, referenceVideos);
      }
      checkCancelled();

      // 8c. 上传参考音频
      if (hasAudioRefs) {
        await this._uploadVideoRefAudios(page, referenceAudios);
      }
      checkCancelled();

      // 9. 输入提示词（在图片/视频/音频之后，因为提示词里有 @图片1 @音频1 引用）
      const refCount = (hasRefs ? referenceImages.length : 0) + (hasVideoRefs ? referenceVideos.length : 0) + (hasAudioRefs ? referenceAudios.length : 0);
      await this._enterVideoPrompt(page, prompt, effectiveMode, refCount, session);
      checkCancelled();

      // 9b. 点击工具栏小箭头展开隐藏选项（国际版会把比例/时长收起来）
      await this._clickToolbarExpandArrow(page);
      checkCancelled();

      // 9c. 确认比例+分辨率（即梦会在上传参考/输入提示词时自动重置比例）
      // 首尾帧模式下比例自动跟随图片，不需要手动设定
      if ((aspectRatio && effectiveMode !== 'first-last-frame') || resolution) {
        await this._selectVideoAspectRatio(page, aspectRatio, resolution);
      }
      checkCancelled();

      // 9d. 设置时长（选两次，第一次可能展开动画没完成选不到）
      if (duration) {
        await this._selectVideoDuration(page, duration);
        await this._selectVideoDuration(page, duration);
      }
      checkCancelled();

      // 10. 滚到底部，标记最后一条记录（新记录会出现在最下面）
      if (isDreaminaUser(session.userId)) await new Promise(r => setTimeout(r, 3000));
      await this._scrollRecordListToBottom(page);
      const BROAD_SELECTOR = '[class*=record-content-], [class*=video-record-]:not([class*=video-record-content])';
      const initialRecordCount = await page.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) els[els.length - 1].setAttribute('data-lo-existing', 'true');
        return els.length;
      }, BROAD_SELECTOR);
      console.log(`[Jimeng-RPA] 已标记最后一条记录 (共 ${initialRecordCount} 条)`);

      // 10b. 点击生成按钮
      if (task) task.progress = 'generating';
      const submitId = await this._clickVideoGenerateWithCapture(page);

      // 11. 立刻等待新记录出现并打标记（在 pageSetupInProgress 锁内，不会有其他任务干扰）
      const markerId = task ? task.id : `jimeng-v-${Date.now()}`;
      const marked = await this._waitAndMarkNewRecord(page, markerId);
      if (!marked) {
        console.warn(`[Jimeng-RPA] 未能标记新记录，将使用位置 fallback`);
      }

      return { prompt, submitId, initialRecordCount, markerId: marked ? markerId : null };
    } catch (err) {
      throw err;
    }
  }

  /** 兼容旧调用：在主页面上执行视频设置 */
  async _videoSetupAndClick(session, opts, task) {
    return this._videoSetupAndClickOnPage(session.page, session, opts, task);
  }

  /**
   * 视频生成第二阶段：后台轮询（不阻塞队列）
   */
  _startBackgroundVideoPoll(session, task, pollInfo) {
    const taskId = task.id;
    (async () => {
      try {
        const page = session.page;
        if (!page) throw new Error('浏览器未就绪');
        const urls = await this._pollForVideoResult(page, pollInfo.submitId, pollInfo.prompt, pollInfo.initialRecordCount, task, session, pollInfo.markerId);
        task.result = urls;
        task.status = 'completed';
        console.log(`[Jimeng-RPA] 用户 ${session.userId} 视频任务 ${taskId} 轮询完成: ${urls.length} 个视频`);
        console.log(`[Jimeng-RPA] ============================================================`);
      } catch (err) {
        task.status = 'failed';
        task.error = err.message;
        console.error(`[Jimeng-RPA] 用户 ${session.userId} 视频任务 ${taskId} 轮询失败:`, err.message);
      }
    })();
  }

  /**
   * 通过浏览器自动化生成视频 (保留供兼容)
   */
  async _generateVideo(session, opts, task) {
    const pollInfo = await this._videoSetupAndClick(session, opts, task);
    const page = session.page;
    if (!page) throw new Error('浏览器未就绪');
    const urls = await this._pollForVideoResult(page, pollInfo.submitId, pollInfo.prompt, pollInfo.initialRecordCount, task, session, pollInfo.markerId);
    console.log(`[Jimeng-RPA] 视频生成完成: ${urls.length} 个`);
    console.log(`[Jimeng-RPA] ============================================================`);
    return urls;
  }

  /**
   * 检测底栏当前模式，如果不是"视频生成"则切换
   */
  async _detectAndSwitchToVideoMode(page) {
    // 先确保底栏工具栏已加载
    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      const found = await page.evaluate(() => {
        // 宽泛搜索：任何含 type-sel 或 toolbar-select 的元素
        const el = document.querySelector('[class*=type-select], [class*=type-sel], [class*=toolbar-select], [class*=toolbar-select]');
        return el ? true : false;
      });
      if (found) {
        console.log(`[Jimeng-RPA] 底栏工具栏已就绪 (等待 ${waitAttempt * 500}ms)`);
        break;
      }
      if (waitAttempt === 9) {
        console.warn('[Jimeng-RPA] 底栏工具栏 5s 内未出现，继续尝试...');
      }
      await new Promise(r => setTimeout(r, 500));
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const barMode = await page.evaluate(() => {
        // 用多种选择器查找类型 select
        const selectors = ['[class*=type-select] .lv-select-view-value', '[class*=type-sel] .lv-select-view-value'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el.textContent.trim();
        }
        // 备用：遍历所有 toolbar-select，找内容含 Agent/视频/图片/影片/影像/代理 的
        const allSelects = document.querySelectorAll('[class*=toolbar-select] .lv-select-view-value');
        for (const sv of allSelects) {
          const t = sv.textContent.trim();
          if (t.includes('Agent') || t.includes('视频') || t.includes('图片') || t.includes('影片') || t.includes('影像') || t.includes('代理')) return t;
        }
        return null;
      });

      console.log(`[Jimeng-RPA] 底栏模式: ${barMode || '(未检测到)'}`);

      // 国内"视频"，国际"影片"
      if (barMode && (barMode.includes('视频') || barMode.includes('影片') || barMode === 'video_mode')) {
        console.log('[Jimeng-RPA] 已在视频生成模式');
        return;
      }

      if (!barMode && attempt < 3) {
        console.log(`[Jimeng-RPA] 底栏未检测到，等待 2s 后重试 (${attempt}/3)`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      console.log(`[Jimeng-RPA] 切换到视频模式 (attempt ${attempt})`);

      // 点击类型 select 打开下拉
      const clicked = await page.evaluate(() => {
        const selectors = ['[class*=type-select]', '[class*=type-sel]'];
        for (const sel of selectors) {
          const typeSelect = document.querySelector(sel);
          if (typeSelect) {
            const viewValue = typeSelect.querySelector('.lv-select-view-value');
            if (viewValue) { viewValue.click(); return { ok: true, text: viewValue.textContent.trim(), sel }; }
          }
        }
        // 备用：遍历所有 toolbar-select
        const allSelects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of allSelects) {
          const vv = sel.querySelector('.lv-select-view-value');
          if (vv) {
            const t = vv.textContent.trim();
            if (t.includes('Agent') || t.includes('图片') || t.includes('视频') || t.includes('影片') || t.includes('影像') || t.includes('代理')) {
              vv.click();
              return { ok: true, text: t, sel: 'toolbar-select fallback' };
            }
          }
        }
        return { ok: false };
      });

      console.log(`[Jimeng-RPA] 模式按钮点击:`, JSON.stringify(clicked));

      if (!clicked.ok) {
        console.warn('[Jimeng-RPA] 无法找到模式 select，等待后重试');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      await new Promise(r => setTimeout(r, 1000));

      // 在弹出的下拉中选择 "视频生成" 或 "AI 影片"（国际版）
      const selected = await page.evaluate(() => {
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, [class*=select-popup]');
        for (const popup of popups) {
          if (popup.offsetParent === null && !popup.classList.contains('lv-trigger-popup')) continue;
          const options = popup.querySelectorAll('li, div[role=option], .option-item, [class*=option]');
          for (const opt of options) {
            const text = opt.textContent.trim();
            if (text.includes('视频生成') || text === '视频生成' || text.includes('AI 影片') || text === 'AI 影片') {
              opt.click();
              return text;
            }
          }
        }
        return null;
      });

      if (selected) {
        console.log(`[Jimeng-RPA] '视频生成' 选项点击: ${selected}`);
        await new Promise(r => setTimeout(r, 2000)); // 等 UI 切换完成
        // 切换后等待视频模式的 toolbar 重新渲染
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.warn(`[Jimeng-RPA] 未找到"视频生成"选项，可能已在正确模式`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  /**
   * 检测并切换到"图片生成"模式（与 _detectAndSwitchToVideoMode 同结构，只是选"图片生成"）
   */
  async _detectAndSwitchToImageMode(page) {
    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      const found = await page.evaluate(() => {
        const el = document.querySelector('[class*=type-select], [class*=type-sel], [class*=toolbar-select]');
        return el ? true : false;
      });
      if (found) {
        console.log(`[Jimeng-RPA] 底栏工具栏已就绪 (等待 ${waitAttempt * 500}ms)`);
        break;
      }
      if (waitAttempt === 9) console.warn('[Jimeng-RPA] 底栏工具栏 5s 内未出现，继续尝试...');
      await new Promise(r => setTimeout(r, 500));
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const barMode = await page.evaluate(() => {
        const selectors = ['[class*=type-select] .lv-select-view-value', '[class*=type-sel] .lv-select-view-value'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el.textContent.trim();
        }
        const allSelects = document.querySelectorAll('[class*=toolbar-select] .lv-select-view-value');
        for (const sv of allSelects) {
          const t = sv.textContent.trim();
          if (t.includes('Agent') || t.includes('视频') || t.includes('图片') || t.includes('影片') || t.includes('影像') || t.includes('代理')) return t;
        }
        return null;
      });

      console.log(`[Jimeng-RPA] 底栏模式(图片): ${barMode || '(未检测到)'}`);

      // 国内"图片"，国际"影像"
      if (barMode && (barMode.includes('图片') || barMode.includes('影像'))) {
        console.log('[Jimeng-RPA] 已在图片生成模式');
        return;
      }

      if (!barMode && attempt < 3) {
        console.log(`[Jimeng-RPA] 底栏未检测到，等待 2s 后重试 (${attempt}/3)`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      console.log(`[Jimeng-RPA] 切换到图片模式 (attempt ${attempt})`);

      const clicked = await page.evaluate(() => {
        const selectors = ['[class*=type-select]', '[class*=type-sel]'];
        for (const sel of selectors) {
          const typeSelect = document.querySelector(sel);
          if (typeSelect) {
            const viewValue = typeSelect.querySelector('.lv-select-view-value');
            if (viewValue) { viewValue.click(); return { ok: true, text: viewValue.textContent.trim(), sel }; }
          }
        }
        const allSelects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of allSelects) {
          const vv = sel.querySelector('.lv-select-view-value');
          if (vv) {
            const t = vv.textContent.trim();
            if (t.includes('Agent') || t.includes('图片') || t.includes('视频') || t.includes('影片') || t.includes('影像') || t.includes('代理')) {
              vv.click();
              return { ok: true, text: t, sel: 'toolbar-select fallback' };
            }
          }
        }
        return { ok: false };
      });

      console.log(`[Jimeng-RPA] 模式按钮点击(图片):`, JSON.stringify(clicked));

      if (!clicked.ok) {
        console.warn('[Jimeng-RPA] 无法找到模式 select，等待后重试');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      await new Promise(r => setTimeout(r, 1000));

      // 国内"图片生成"，国际"AI 影像"
      const selected = await page.evaluate(() => {
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, [class*=select-popup]');
        for (const popup of popups) {
          if (popup.offsetParent === null && !popup.classList.contains('lv-trigger-popup')) continue;
          const options = popup.querySelectorAll('li, div[role=option], .option-item, [class*=option]');
          for (const opt of options) {
            const text = opt.textContent.trim();
            if (text.includes('图片生成') || text === '图片生成' || text.includes('AI 影像') || text === 'AI 影像') {
              opt.click();
              return text;
            }
          }
        }
        return null;
      });

      if (selected) {
        console.log(`[Jimeng-RPA] '图片生成' 选项点击: ${selected}`);
        await new Promise(r => setTimeout(r, 2000));
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.warn(`[Jimeng-RPA] 未找到"图片生成"选项，可能已在正确模式`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  /**
   * 选择视频参考模式
   */
  async _selectVideoMode(page, mode) {
    const MODE_MAP = {
      'omni-reference': '全能参考',
      'omni': '全能参考',
      'first-last-frame': '首尾帧',
      'flf': '首尾帧',
      'smart-multi-frame': '智能多帧',
      'smf': '智能多帧',
      'subject-reference': '主体参考',
      'subject': '主体参考',
    };
    // 国内 + 国际版别名（繁体/英文）
    const ALIAS = {
      '全能参考': ['全能参考', '全部参考', '全方位參考', '全方位参考'],
      '首尾帧': ['首尾帧', '第一個和最後一個影格', '第一个和最后一个影格'],
      '智能多帧': ['智能多帧', '多影格'],
      '主体参考': ['主体参考', '主體參考'],
    };
    const targetText = MODE_MAP[mode] || mode;

    try {
      const currentMode = await page.evaluate(() => {
        const modeKeywords = ['首尾帧', '全能参考', '全部参考', '智能多帧', '主体参考', '全方位參考', '第一個和最後一個影格', '多影格', '主體參考'];
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of selects) {
          const val = sel.querySelector('.lv-select-view-value')?.textContent?.trim() || '';
          if (modeKeywords.some(m => val.includes(m))) return val;
        }
        return '';
      });

      const aliases = ALIAS[targetText] || [targetText];
      if (aliases.some(a => currentMode.includes(a))) {
        console.log(`[Jimeng-RPA] 参考模式已是 ${targetText}，跳过`);
        return;
      }

      console.log(`[Jimeng-RPA] 切换参考模式: ${currentMode || '(未知)'} → ${targetText}`);

      const triggerClicked = await page.evaluate(() => {
        const modeKeywords = ['首尾帧', '全能参考', '全部参考', '智能多帧', '主体参考', '全方位參考', '第一個和最後一個影格', '多影格', '主體參考'];
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of selects) {
          const val = sel.querySelector('.lv-select-view-value')?.textContent?.trim() || '';
          if (modeKeywords.some(m => val.includes(m))) {
            sel.querySelector('.lv-select-view-value').click();
            return { ok: true, text: val };
          }
        }
        return { ok: false };
      });

      console.log(`[Jimeng-RPA] 模式 trigger 点击:`, JSON.stringify(triggerClicked));
      await new Promise(r => setTimeout(r, 1000));

      const popupDebug = await page.evaluate(() => {
        const results = [];
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, .lv-dropdown-popup, .lv-popover, [class*=popup]');
        for (const popup of popups) {
          if (popup.offsetParent === null && popup.style?.display === 'none') continue;
          const options = popup.querySelectorAll('li, [role=option], [class*=option]');
          const texts = Array.from(options).map(o => o.textContent.trim().substring(0, 40));
          if (texts.length > 0) results.push({ class: (typeof popup.className === 'string' ? popup.className : popup.className?.baseVal || '').substring(0, 80), options: texts });
        }
        return results;
      });
      console.log(`[Jimeng-RPA] 模式 popup 调试:`, JSON.stringify(popupDebug));

      const selected = await page.evaluate((aliases) => {
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, .lv-dropdown-popup, .lv-popover');
        for (const popup of popups) {
          if (popup.offsetParent === null && popup.style?.display === 'none') continue;
          const options = popup.querySelectorAll('li.lv-select-option, li[role=option], li, .lv-select-option');
          for (const opt of options) {
            const text = opt.textContent.trim();
            if (aliases.some(a => text.includes(a))) {
              opt.click();
              return text;
            }
          }
        }
        return null;
      }, aliases);

      if (selected) {
        console.log(`[Jimeng-RPA] 已选择参考模式: ${selected}`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.warn(`[Jimeng-RPA] 未找到模式 "${targetText}"，使用页面默认`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('[Jimeng-RPA] 选择参考模式失败:', e.message);
      try { await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 500)); } catch (_) {}
    }
  }

  /**
   * 选择视频模型
   */
  async _selectVideoModel(page, model) {
    const VIDEO_MODEL_MAP = {
      'seedance-2.0-fast-vip': 'Seedance 2.0 Fast VIP',
      'seedance-2.0-fast': 'Seedance 2.0 Fast',
      '2.0-fast': 'Seedance 2.0 Fast',
      'seedance-2.0-vip': 'Seedance 2.0 VIP',
      'seedance-2.0': 'Seedance 2.0',
      '2.0': 'Seedance 2.0',
      '3.5-pro': '视频 3.5 Pro',
      '3.0-pro': '视频 3.0 Pro',
      '3.0-fast': '视频 3.0 Fast',
      '3.0': '视频 3.0',
    };
    // 国际版 Dreamina 前缀: "Dreamina Seedance 2.0" — startsWith 需要同时匹配两种
    const targetText = VIDEO_MODEL_MAP[model] || 'Seedance 2.0';
    const dreaminaTarget = targetText.startsWith('Seedance') ? `Dreamina ${targetText}` : targetText;

    try {
      // 找到模型 select（通过模型关键词正向匹配）
      const currentModel = await page.evaluate(() => {
        const modelKeywords = ['Seedance', 'Dreamina', 'Video', '视频 3', '视频 2'];
        const allSelects = document.querySelectorAll('[class*=toolbar-select] .lv-select-view-value');
        for (const sv of allSelects) {
          const t = sv.textContent.trim();
          if (modelKeywords.some(k => t.includes(k))) return t;
        }
        return '';
      });

      console.log(`[Jimeng-RPA] 当前模型: "${currentModel}", 目标: "${targetText}" / "${dreaminaTarget}"`);

      const modelMatch = (text, target) => text.startsWith(target) && !/^[\sa-zA-Z]/.test(text.substring(target.length));
      if (modelMatch(currentModel, targetText) || modelMatch(currentModel, dreaminaTarget)) {
        console.log(`[Jimeng-RPA] 模型已是 ${targetText}，跳过`);
        return;
      }

      console.log(`[Jimeng-RPA] 选择模型: ${currentModel || '(未知)'} → ${targetText}`);

      // 点击模型 select 打开下拉（通过模型关键词正向匹配）
      await page.evaluate(() => {
        const modelKeywords = ['Seedance', 'Dreamina', 'Video', '视频 3', '视频 2'];
        const allSelects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of allSelects) {
          const vv = sel.querySelector('.lv-select-view-value');
          if (vv && modelKeywords.some(k => vv.textContent.trim().includes(k))) {
            vv.click();
            return;
          }
        }
      });
      await new Promise(r => setTimeout(r, 1000));

      const selected = await page.evaluate((target, dreaminaT) => {
        const matchFn = (text, t) => text.startsWith(t) && !/^[\sa-zA-Z]/.test(text.substring(t.length));
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, .lv-dropdown-popup');
        for (const popup of popups) {
          if (popup.offsetParent === null && popup.style?.display === 'none') continue;
          const options = popup.querySelectorAll('li.lv-select-option, li[role=option], .lv-select-option');
          const allTexts = [];
          let matched = null;
          for (const opt of options) {
            const text = opt.textContent.trim();
            allTexts.push(text.substring(0, 50));
            if ((matchFn(text, target) || matchFn(text, dreaminaT)) && !matched) {
              matched = opt;
            }
          }
          if (matched) {
            matched.click();
            return { selected: matched.textContent.trim().substring(0, 50), allOptions: allTexts };
          }
          if (allTexts.length > 0) return { selected: null, allOptions: allTexts };
        }
        return { selected: null, allOptions: [] };
      }, targetText, dreaminaTarget);

      if (selected?.selected) {
        console.log(`[Jimeng-RPA] 模型选择: ${selected.selected}`);
        await new Promise(r => setTimeout(r, 1500));

        const barText = await page.evaluate(() => {
          const modelKeywords = ['Seedance', 'Dreamina', 'Video', '视频 3', '视频 2'];
          const allSelects = document.querySelectorAll('[class*=toolbar-select] .lv-select-view-value');
          for (const sv of allSelects) {
            const t = sv.textContent.trim();
            if (modelKeywords.some(k => t.includes(k))) return t;
          }
          return '';
        });
        const verified = (barText.startsWith(targetText) || barText.startsWith(dreaminaTarget)) && !/^[\sa-zA-Z]/.test(barText.substring(barText.startsWith(dreaminaTarget) ? dreaminaTarget.length : targetText.length));
        console.log(`[Jimeng-RPA] ${targetText} 验证: ${verified} (底栏显示: "${barText}")`);
      } else {
        console.warn(`[Jimeng-RPA] 未找到模型 "${targetText}"，可用选项: [${selected?.allOptions?.join(', ')}]`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('[Jimeng-RPA] 选择视频模型失败:', e.message);
    }
  }

  /**
   * 设置视频比例（按钮 + radio 弹窗，跟图片生成一样）
   */
  async _selectVideoAspectRatio(page, ratio, resolution) {
    try {
      // 比例是 toolbar-button，不是 toolbar-select
      const btnSelector = 'button[class*=button-][class*=toolbar-button]:not(.lv-btn-icon-only)';

      // 等待按钮出现（模型切换后可能需要时间）
      let btnFound = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        btnFound = await page.evaluate((sel) => !!document.querySelector(sel), btnSelector);
        if (btnFound) break;
        console.log(`[Jimeng-RPA] 比例按钮未出现，等待重试 (${attempt + 1}/3)...`);
        await new Promise(r => setTimeout(r, 1500));
      }
      if (!btnFound) {
        console.warn(`[Jimeng-RPA] 比例按钮始终未找到，跳过`);
        return;
      }

      // 点击比例按钮打开弹窗
      await page.click(btnSelector);
      await new Promise(r => setTimeout(r, 1000));

      // 检查弹窗是否打开
      const popoverOpen = await page.evaluate(() => {
        return !!document.querySelector('.lv-popover-inner-content input[type=radio]');
      });
      if (!popoverOpen) {
        console.warn('[Jimeng-RPA] 比例弹窗未打开，重试...');
        await page.click(btnSelector);
        await new Promise(r => setTimeout(r, 1000));
      }

      // 选择比例 radio
      if (ratio) {
        const result = await page.evaluate((val) => {
          const radios = document.querySelectorAll('.lv-popover-inner-content input[type=radio]');
          const allValues = [];
          for (const radio of radios) {
            allValues.push(radio.value);
            if (radio.value === val) {
              radio.click();
              return { selected: true, value: val, allValues };
            }
          }
          return { selected: false, allValues };
        }, ratio);

        if (result.selected) {
          console.log(`[Jimeng-RPA] 已选择比例: ${ratio}`);
        } else {
          console.warn(`[Jimeng-RPA] 未找到比例 "${ratio}"，可用: [${result.allValues.join(', ')}]`);
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // 选择分辨率（在同一个弹窗内，比例 radio 下方的按钮）
      if (resolution) {
        const targetNum = resolution.replace(/p$/i, ''); // '1080p' → '1080'
        const resResult = await page.evaluate((targetNum) => {
          const popover = document.querySelector('.lv-popover-inner-content');
          if (!popover) return { selected: false, allTexts: [], popoverFound: false };
          // 先 dump 弹窗完整结构用于调试
          const debugTexts = [];
          const allEls = popover.querySelectorAll('*');
          for (const el of allEls) {
            // 只看叶子节点或接近叶子的元素
            if (el.children.length > 3) continue;
            const t = el.textContent.trim();
            if (t && t.length < 30) debugTexts.push(`<${el.tagName.toLowerCase()}${el.className ? ' class="' + el.className.substring(0, 40) + '"' : ''}> "${t}"`);
          }
          // 找包含目标分辨率数字的可点击元素（720P/1080P，可能带 ✦ 等装饰符号）
          const allTexts = [];
          let matched = null;
          for (const el of allEls) {
            const t = el.textContent.trim();
            // 匹配: 文字以目标数字开头 + P（如 "1080P" "1080P ✦"），且元素不是太大的容器
            if (t.match(new RegExp('^' + targetNum + 'P', 'i')) && el.children.length <= 2 && !matched) {
              allTexts.push(t);
              matched = el;
            } else if (/^\d+P/i.test(t) && el.children.length <= 2) {
              allTexts.push(t);
            }
          }
          if (matched) {
            matched.click();
            return { selected: true, value: matched.textContent.trim(), allTexts, debugTexts };
          }
          return { selected: false, allTexts, debugTexts, popoverFound: true };
        }, targetNum);

        if (resResult.selected) {
          console.log(`[Jimeng-RPA] 已选择分辨率: ${resResult.value}`);
        } else {
          console.warn(`[Jimeng-RPA] 未找到分辨率 "${targetNum}P"，可用: [${resResult.allTexts.join(', ')}]`);
          console.warn(`[Jimeng-RPA] 弹窗内容调试:`, resResult.debugTexts?.slice(0, 30));
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // 关闭弹窗
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error('[Jimeng-RPA] 设置比例/分辨率失败:', e.message);
    }
  }

  /**
   * 点击工具栏的 ">" 展开箭头，让隐藏的选项（比例/时长）显示出来
   * 箭头需要 hover 工具栏才会出现
   */
  async _clickToolbarExpandArrow(page) {
    try {
      // 先 hover 工具栏 select 区域，让箭头出现
      const selectRect = await page.evaluate(() => {
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        const last = selects[selects.length - 1];
        if (!last) return null;
        const rect = last.getBoundingClientRect();
        return { x: rect.right + 20, y: rect.y + rect.height / 2 };
      });

      if (selectRect) {
        await page.mouse.move(selectRect.x, selectRect.y);
        await new Promise(r => setTimeout(r, 800));
      }

      // 在工具栏 select 右侧附近找 ">" 箭头
      const clicked = await page.evaluate(() => {
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        if (selects.length === 0) return false;
        const lastSelect = selects[selects.length - 1];
        const lastRect = lastSelect.getBoundingClientRect();
        // 从最后一个 select 的父容器往上找工具栏
        let toolbar = lastSelect.parentElement;
        while (toolbar && toolbar !== document.body) {
          const r = toolbar.getBoundingClientRect();
          if (r.width > 300) break;
          toolbar = toolbar.parentElement;
        }
        if (!toolbar) return false;
        // 在工具栏内找小的可点击元素，文字只有 ">"
        const candidates = toolbar.querySelectorAll('*');
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.width > 30 || rect.height > 30) continue;
          // 必须在最后一个 select 的右边
          if (rect.left < lastRect.right) continue;
          const text = el.textContent?.trim() || '';
          if (text === '>' || text === '›') {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        console.log('[Jimeng-RPA] 已点击工具栏展开箭头');
        // 鼠标移到页面中央，避免 hover 状态干扰后续操作
        await page.mouse.move(400, 300);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        console.log('[Jimeng-RPA] 未找到工具栏展开箭头（可能已展开）');
      }
    } catch (e) {
      console.warn('[Jimeng-RPA] 点击工具栏展开箭头失败:', e.message);
    }
  }

  /**
   * 选择视频时长
   */
  async _selectVideoDuration(page, duration) {
    const targetText = duration.toString().replace(/[^0-9]/g, '') + 's';

    try {
      const current = await page.evaluate(() => {
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of selects) {
          const val = sel.querySelector('.lv-select-view-value')?.textContent?.trim() || '';
          if (val.match(/^\d+s$/)) return val;
        }
        return '';
      });

      console.log(`[Jimeng-RPA] 当前时长: "${current}", 目标: "${targetText}"`);
      if (current === targetText) {
        console.log(`[Jimeng-RPA] 时长已是 ${targetText}，跳过`);
        return;
      }

      const clicked = await page.evaluate(() => {
        const selects = document.querySelectorAll('[class*=toolbar-select]');
        for (const sel of selects) {
          const val = sel.querySelector('.lv-select-view-value')?.textContent?.trim() || '';
          if (val.match(/^\d+s$/)) {
            sel.querySelector('.lv-select-view-value').click();
            return val;
          }
        }
        return null;
      });
      if (!clicked) {
        console.warn(`[Jimeng-RPA] 未找到时长 select，跳过`);
        return;
      }
      await new Promise(r => setTimeout(r, 1000));

      const selected = await page.evaluate((target) => {
        const popups = document.querySelectorAll('.lv-select-popup, .lv-trigger-popup, .lv-dropdown-popup');
        for (const popup of popups) {
          if (popup.offsetParent === null && popup.style?.display === 'none') continue;
          const options = popup.querySelectorAll('li.lv-select-option, li[role=option], li');
          const allTexts = [];
          for (const opt of options) {
            const text = opt.textContent.trim();
            allTexts.push(text);
            if (text === target || text.includes(target)) {
              opt.click();
              return { selected: target, allOptions: allTexts };
            }
          }
          if (allTexts.length > 0) return { selected: null, allOptions: allTexts };
        }
        return { selected: null, allOptions: [] };
      }, targetText);

      if (selected?.selected) {
        console.log(`[Jimeng-RPA] 已选择时长: ${selected.selected}`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        console.warn(`[Jimeng-RPA] 未找到时长 "${targetText}"，可用: [${selected?.allOptions?.join(', ')}]`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('[Jimeng-RPA] 选择时长失败:', e.message);
    }
  }

  /**
   * 首尾帧模式：分别上传首帧和尾帧到各自的槽位
   * input[0] = 首帧, input[1] = 尾帧
   */
  async _uploadFirstLastFrame(page, firstImage, lastImage) {
    console.log(`[Jimeng-RPA] 首尾帧模式：分别上传首帧和尾帧`);

    // 解析 base64
    const parseImage = (ref, label) => {
      let base64, mimeType;
      if (typeof ref === 'string') {
        const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) { mimeType = match[1]; base64 = match[2]; }
        else { base64 = ref; mimeType = 'image/png'; }
      } else {
        base64 = ref.base64; mimeType = ref.mimeType || 'image/png';
      }
      const ext = mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.png';
      const name = `ref-${label}${ext}`;
      const size = Buffer.from(base64, 'base64').length;
      console.log(`[Jimeng-RPA] ${label}: type=${mimeType}, size=${size} bytes`);
      return { base64, mimeType, ext, name, size };
    };

    const frames = [
      { data: parseImage(firstImage, '首帧'), inputIndex: 0, label: '首帧' },
      { data: parseImage(lastImage, '尾帧'), inputIndex: 1, label: '尾帧' },
    ];

    for (const frame of frames) {
      console.log(`[Jimeng-RPA] 上传 ${frame.label} → input[${frame.inputIndex}]`);

      // 监听上传网络请求
      const uploadResponses = [];
      const responseHandler = async (response) => {
        const url = response.url();
        if (url.includes('upload') || url.includes('tos-')) {
          try {
            const status = response.status();
            uploadResponses.push({ url: url.substring(0, 120), status });
          } catch (_) {}
        }
      };
      page.on('response', responseHandler);

      let uploadSuccess = false;
      const methods = ['datatransfer', 'uploadfile', 'filechooser'];

      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const method = methods[attempt % methods.length];
          if (attempt > 0) {
            console.log(`[Jimeng-RPA] ${frame.label} 上传重试 ${attempt + 1}/3，方法: ${method}`);
            await new Promise(r => setTimeout(r, 1500));
          }

          console.log(`[Jimeng-RPA] ${frame.label} 上传方法: ${method}`);

          if (method === 'datatransfer') {
            const result = await page.evaluate((fileData, targetIdx) => {
              try {
                // 只在 reference-upload 区域内找 file input，避免页面其他隐藏 input 干扰
                // 首帧上传后其 area 的 input 会消失，所以尾帧时只剩 1 个 input，直接用它
                const areas = Array.from(document.querySelectorAll('[class*=reference-upload]'));
                let allInputs;
                if (areas.length > 0) {
                  allInputs = areas.map(area => area.querySelector('input[type="file"]')).filter(Boolean);
                }
                if (!allInputs || allInputs.length === 0) {
                  allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
                }
                // 如果目标 index 超出范围但还有可用 input，用最后一个（首帧上传后尾帧 input 变成 [0]）
                const actualIdx = targetIdx < allInputs.length ? targetIdx : allInputs.length - 1;
                if (allInputs.length === 0) return { ok: false, error: 'no file input found, areas=' + areas.length };
                const input = allInputs[actualIdx];
                const dt = new DataTransfer();
                const binaryStr = atob(fileData.base64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                const blob = new Blob([bytes], { type: fileData.mimeType });
                const file = new File([blob], fileData.name, { type: fileData.mimeType, lastModified: Date.now() });
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return { ok: true, fileCount: dt.files.length, inputIdx: targetIdx };
              } catch (e) {
                return { ok: false, error: e.message };
              }
            }, { base64: frame.data.base64, mimeType: frame.data.mimeType, name: frame.data.name }, frame.inputIndex);
            console.log(`[Jimeng-RPA] ${frame.label} DataTransfer 结果:`, JSON.stringify(result));

          } else if (method === 'uploadfile') {
            const tmpPath = path.join(os.tmpdir(), `jimeng-${frame.label}-${Date.now()}${frame.data.ext}`);
            try {
              fs.writeFileSync(tmpPath, Buffer.from(frame.data.base64, 'base64'));
              // 只在 reference-upload 区域内找 file input
              // 首帧上传后其 input 消失，尾帧时用剩余的那个
              let allInputs = await page.$$('[class*=reference-upload] input[type="file"]');
              if (allInputs.length === 0) {
                allInputs = await page.$$('input[type="file"]');
              }
              const actualIdx = frame.inputIndex < allInputs.length ? frame.inputIndex : allInputs.length - 1;
              if (allInputs.length > 0) {
                const fileInput = allInputs[actualIdx];
                await fileInput.uploadFile(tmpPath);
                await fileInput.evaluate(el => {
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                });
                console.log(`[Jimeng-RPA] ${frame.label} uploadFile 完成`);
              } else {
                console.warn(`[Jimeng-RPA] ${frame.label} input[${frame.inputIndex}] 不存在`);
              }
            } finally {
              try { fs.unlinkSync(tmpPath); } catch (_) {}
            }

          } else {
            // filechooser: 点击对应上传区域
            const tmpPath = path.join(os.tmpdir(), `jimeng-${frame.label}-${Date.now()}${frame.data.ext}`);
            try {
              fs.writeFileSync(tmpPath, Buffer.from(frame.data.base64, 'base64'));
              const uploadAreas = await page.$$('[class*=reference-upload]');
              if (uploadAreas.length > frame.inputIndex) {
                const area = uploadAreas[frame.inputIndex];
                const box = await area.boundingBox();
                if (box) {
                  const [fileChooser] = await Promise.all([
                    page.waitForFileChooser({ timeout: 8000 }),
                    page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
                  ]);
                  await fileChooser.accept([tmpPath]);
                  console.log(`[Jimeng-RPA] ${frame.label} fileChooser.accept 完成`);
                }
              } else {
                console.warn(`[Jimeng-RPA] ${frame.label} 上传区域[${frame.inputIndex}] 不存在`);
              }
            } finally {
              try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
          }

          // 等待上传完成：检查 tos 上传请求
          for (let waitRound = 0; waitRound < 6; waitRound++) {
            await new Promise(r => setTimeout(r, 2000));
            const tosUploads = uploadResponses.filter(r => r.url.includes('tos-') && r.status === 200);
            if (tosUploads.length > 0) {
              uploadSuccess = true;
              console.log(`[Jimeng-RPA] ${frame.label} tos 上传确认成功`);
              break;
            }
            // 也检查 DOM 图片变化
            const hasImg = await page.evaluate((idx) => {
              const areas = document.querySelectorAll('[class*=reference-upload]');
              if (areas.length <= idx) return false;
              return areas[idx].querySelector('img[src]') !== null;
            }, frame.inputIndex);
            if (hasImg) {
              uploadSuccess = true;
              console.log(`[Jimeng-RPA] ${frame.label} DOM 检测到图片`);
              break;
            }
          }

          if (uploadSuccess) {
            console.log(`[Jimeng-RPA] ${frame.label} 上传成功 (方法: ${method})`);
            break;
          }
        }
      } finally {
        page.off('response', responseHandler);
      }

      if (!uploadSuccess) {
        console.error(`[Jimeng-RPA] ${frame.label} 上传失败（3次重试均失败）`);
        throw new Error(`${frame.label}图片上传失败`);
      }

      // 两张图之间等一下，让即梦处理完
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`[Jimeng-RPA] 首尾帧上传完成`);
  }

  /**
   * 上传视频参考图
   */
  async _uploadVideoRefImages(page, referenceImages) {
    console.log(`[Jimeng-RPA] 开始上传 ${referenceImages.length} 张参考图`);

    // 解析所有参考图为 { base64, mimeType, ext } 数组
    const filesData = [];
    for (let i = 0; i < referenceImages.length; i++) {
      const ref = referenceImages[i];
      let base64, mimeType;
      if (typeof ref === 'string') {
        const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        } else {
          base64 = ref;
          mimeType = 'image/png';
        }
      } else {
        base64 = ref.base64;
        mimeType = ref.mimeType || 'image/png';
      }
      const ext = mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.bin';
      const buffer = Buffer.from(base64, 'base64');
      console.log(`[Jimeng-RPA] 参考图 [${i}]: type=${mimeType}, size=${buffer.length} bytes`);
      filesData.push({ base64, mimeType, ext, name: `影像${i + 1}${ext}`, size: buffer.length });
    }

    // 监听上传相关网络请求（诊断用）
    const uploadResponses = [];
    const responseHandler = async (response) => {
      const url = response.url();
      if (url.includes('upload') || url.includes('material') || url.includes('resource')) {
        try {
          const status = response.status();
          const body = status >= 400 ? await response.text().catch(() => '(无法读取)') : '(ok)';
          uploadResponses.push({ url: url.substring(0, 120), status, body: body.substring(0, 200) });
          console.log(`[Jimeng-RPA] 上传请求: ${status} ${url.substring(0, 120)} ${status >= 400 ? body.substring(0, 200) : ''}`);
        } catch (_) {}
      }
    };
    page.on('response', responseHandler);

    const MAX_RETRIES = 3;
    // datatransfer 实测有触发 tos 上传；uploadfile 之前成功过但需要正确的 input
    const methods = ['datatransfer', 'uploadfile', 'filechooser'];

    // 记录上传前已有的参考图数量（用于对比验证）
    const preUploadCount = await page.evaluate(() => {
      const imgSelectors = [
        '[class*=reference-upload] img',
        '[class*=upload-card] img',
        '[class*=ref-item] img',
        '[class*=material] img[src]',
        '[class*=reference] img[src]',
      ];
      for (const sel of imgSelectors) {
        const imgs = document.querySelectorAll(sel);
        if (imgs.length > 0) return { count: imgs.length, selector: sel };
      }
      return { count: 0, selector: '(none)' };
    });
    console.log(`[Jimeng-RPA] 上传前已有 ${preUploadCount.count} 张图 (${preUploadCount.selector})`);

    // 列出页面上所有 file input，诊断用
    const fileInputInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="file"]');
      return Array.from(inputs).map((inp, i) => {
        const parent = inp.parentElement;
        const grandParent = parent?.parentElement;
        return {
          idx: i,
          accept: inp.accept || '',
          multiple: inp.multiple,
          parentClass: (parent?.className || '').substring(0, 80),
          grandParentClass: (grandParent?.className || '').substring(0, 80),
          visible: inp.offsetParent !== null || (inp.parentElement?.offsetParent !== null),
        };
      });
    });
    console.log(`[Jimeng-RPA] 页面 file inputs (${fileInputInfo.length}个):`, JSON.stringify(fileInputInfo));

    let uploadSuccess = false;

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const method = methods[attempt % methods.length];
        if (attempt > 0) {
          console.log(`[Jimeng-RPA] 上传重试 ${attempt + 1}/${MAX_RETRIES}，方法: ${method}`);
          await page.evaluate(() => {
            document.querySelectorAll('.lv-notification, .lv-message, [class*=toast]').forEach(el => {
              const closeBtn = el.querySelector('[class*=close], .lv-notification-close, .lv-icon-close');
              if (closeBtn) closeBtn.click();
              else el.remove();
            });
          });
          await new Promise(r => setTimeout(r, 1500));
        }

        console.log(`[Jimeng-RPA] 上传方法: ${method}`);

        if (method === 'datatransfer') {
          // === 方法 A: DataTransfer ===
          const result = await page.evaluate((files) => {
            try {
              const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
              if (allInputs.length === 0) return { ok: false, error: 'no file input found' };

              // 优先：reference-upload 内 accept 含 video 的 input（跟之前成功时参数一致）
              let input = allInputs.find(inp => {
                const inRef = inp.closest('[class*=reference-upload]') !== null;
                return inRef && (inp.accept || '').includes('video');
              });
              // 其次：reference-upload 内最后一个
              if (!input) {
                const refInputs = allInputs.filter(inp => inp.closest('[class*=reference-upload]') !== null);
                if (refInputs.length > 0) input = refInputs[refInputs.length - 1];
              }
              // 回退：最后一个 file input
              if (!input) input = allInputs[allInputs.length - 1];

              const inputIdx = allInputs.indexOf(input);

              const dt = new DataTransfer();
              let addedCount = 0;
              for (const f of files) {
                try {
                  const binaryStr = atob(f.base64);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                  const blob = new Blob([bytes], { type: f.mimeType });
                  const file = new File([blob], f.name, { type: f.mimeType, lastModified: Date.now() });
                  dt.items.add(file);
                  addedCount++;
                } catch (e) {
                  return { ok: false, error: `file ${f.name}: ${e.message}` };
                }
              }

              if (dt.files.length === 0 && addedCount > 0) {
                // dt.items.add succeeded but dt.files is empty — try Object.defineProperty workaround
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
                if (nativeSet) {
                  nativeSet.call(input, dt.files);
                } else {
                  input.files = dt.files;
                }
              } else {
                input.files = dt.files;
              }

              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));

              return { ok: true, fileCount: dt.files.length, addedCount, inputIdx, totalInputs: allInputs.length };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, filesData.map(f => ({ base64: f.base64, mimeType: f.mimeType, name: f.name })));

          console.log(`[Jimeng-RPA] DataTransfer 结果:`, JSON.stringify(result));

          // 如果 fileCount 是 0 但 addedCount > 0，DataTransfer 可能有 bug，标记为失败让下一轮重试
          if (result.ok && result.fileCount === 0) {
            console.warn(`[Jimeng-RPA] DataTransfer fileCount=0 (addedCount=${result.addedCount})，此方法可能失效`);
          }

        } else if (method === 'filechooser') {
          // === 方法 B: fileChooser ===
          const tmpPaths = [];
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
            }

            // 寻找参考图上传区域
            const uploadSelectors = [
              '[class*=reference-upload]', '[class*=reference-upload]', '[class*=upload-trigger]',
              '[class*=ref-upload]', '[class*=add-reference]',
            ];
            let uploadArea = null;
            for (const sel of uploadSelectors) {
              uploadArea = await page.$(sel);
              if (uploadArea) break;
            }

            if (uploadArea) {
              const box = await uploadArea.boundingBox();
              if (box) {
                const [fileChooser] = await Promise.all([
                  page.waitForFileChooser({ timeout: 8000 }),
                  page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
                ]);
                await fileChooser.accept(tmpPaths);
                console.log(`[Jimeng-RPA] fileChooser.accept 完成: ${tmpPaths.length} 个文件`);
              } else {
                console.warn(`[Jimeng-RPA] 上传区域无 boundingBox`);
              }
            } else {
              console.warn(`[Jimeng-RPA] 未找到参考图上传区域`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }

        } else {
          // === 方法 C: uploadFile（之前确认成功的方式：临时文件 + Puppeteer uploadFile）===
          const tmpPaths = [];
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
              console.log(`[Jimeng-RPA] 参考图 [${i}] → ${tmpPath}`);
            }
            // 选择正确的 file input：优先选 accept 含 video 的（跟之前成功时参数一致）
            const allRefInputs = await page.$$('[class*=reference-upload] input[type="file"]');
            let fileInput = null;
            // 优先：accept 含 video 的（之前成功的 input 特征）
            for (const inp of allRefInputs) {
              const accept = await inp.evaluate(el => el.accept || '');
              if (accept.includes('video')) { fileInput = inp; break; }
            }
            // 其次：最后一个 reference-upload input
            if (!fileInput && allRefInputs.length > 0) fileInput = allRefInputs[allRefInputs.length - 1];
            // 回退：任何 file input
            if (!fileInput) {
              const anyInputs = await page.$$('input[type="file"]');
              if (anyInputs.length > 0) fileInput = anyInputs[anyInputs.length - 1];
            }

            if (fileInput) {
              const inputInfo = await fileInput.evaluate(el => ({
                className: el.className,
                accept: el.accept,
                parentClass: el.parentElement?.className?.substring(0, 60) || '',
              }));
              console.log(`[Jimeng-RPA] 使用 file input:`, JSON.stringify(inputInfo));
              await fileInput.uploadFile(...tmpPaths);
              await fileInput.evaluate(el => {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
              });
              console.log(`[Jimeng-RPA] uploadFile 完成: ${tmpPaths.length} 个文件`);
            } else {
              console.warn(`[Jimeng-RPA] 未找到 file input`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }
        }

        // 等待上传完成：检查 tos 上传请求 + DOM 图片数量
        let newImagesDetected = false;
        for (let waitRound = 0; waitRound < 8; waitRound++) {
          await new Promise(r => setTimeout(r, 2000));

          // 检查 tos 上传请求数量（最可靠的指标）
          const tosUploads = uploadResponses.filter(r => r.url.includes('tos-') && r.url.includes('/upload/') && r.status === 200);
          // 去重（同一个 URL 可能重试）
          const uniqueTosUrls = new Set(tosUploads.map(r => r.url));

          const postCheck = await page.evaluate(() => {
            const imgSelectors = [
              '[class*=reference-upload] img',
              '[class*=upload-card] img',
              '[class*=ref-item] img',
              '[class*=material] img[src]',
              '[class*=reference] img[src]',
            ];
            for (const sel of imgSelectors) {
              const imgs = document.querySelectorAll(sel);
              if (imgs.length > 0) return { count: imgs.length, selector: sel };
            }
            const errors = [];
            document.querySelectorAll('.lv-notification, .lv-message, [class*=toast], [class*=error-tip]').forEach(el => {
              if (el.textContent.trim()) errors.push(el.textContent.trim().substring(0, 100));
            });
            return { count: 0, selector: '(none)', errors };
          });

          const countDiff = postCheck.count - preUploadCount.count;
          console.log(`[Jimeng-RPA] 上传后 ${(waitRound + 1) * 2}s: DOM ${postCheck.count} 张 (新增 ${countDiff}), tos 上传 ${uniqueTosUrls.size}/${filesData.length}`);

          // 成功条件 1: DOM 图片数量增加
          if (countDiff > 0) {
            newImagesDetected = true;
            console.log(`[Jimeng-RPA] DOM 检测到新增 ${countDiff} 张参考图`);
            break;
          }
          // 成功条件 2: tos 上传请求数 >= 参考图数量（文件确实上传到了即梦服务器）
          if (uniqueTosUrls.size >= filesData.length) {
            newImagesDetected = true;
            console.log(`[Jimeng-RPA] tos 上传 ${uniqueTosUrls.size} 个文件确认成功`);
            break;
          }
          if (postCheck.errors && postCheck.errors.length > 0) {
            const uploadError = postCheck.errors.find(e => e.includes('上传失败') || e.includes('upload') || e.includes('失败'));
            if (uploadError) {
              console.warn(`[Jimeng-RPA] 上传错误: "${uploadError}"，方法 ${method} 失败`);
              break;
            }
          }
        }

        if (newImagesDetected) {
          uploadSuccess = true;
          console.log(`[Jimeng-RPA] 参考图上传成功 (方法: ${method})`);
          break;
        }

        console.warn(`[Jimeng-RPA] 方法 ${method} 未成功，${attempt < MAX_RETRIES - 1 ? '尝试下一方法' : '所有方法都失败'}`);
      }

      if (uploadResponses.length > 0) {
        console.log(`[Jimeng-RPA] 上传期间网络请求: ${JSON.stringify(uploadResponses)}`);
      }

      if (!uploadSuccess) {
        console.error(`[Jimeng-RPA] 参考图上传失败！3种方法都未成功`);
        throw new Error('参考图上传失败');
      }
    } finally {
      page.off('response', responseHandler);
    }

    console.log(`[Jimeng-RPA] 参考图上传完成: ${referenceImages.length} 张`);
  }

  /**
   * 上传参考视频（视频文件作为参考输入）
   * 结构与 _uploadVideoRefImages 类似，但处理 video mime type
   * 注意：不修改 _uploadVideoRefImages（已锁定）
   */
  async _uploadVideoRefVideos(page, referenceVideos) {
    console.log(`[Jimeng-RPA] 开始上传 ${referenceVideos.length} 个参考视频`);

    // 解析所有参考视频为 { base64, mimeType, ext } 数组
    const filesData = [];
    for (let i = 0; i < referenceVideos.length; i++) {
      const ref = referenceVideos[i];
      let base64, mimeType;
      if (typeof ref === 'string') {
        const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        } else {
          base64 = ref;
          mimeType = 'video/mp4';
        }
      } else {
        base64 = ref.base64;
        mimeType = ref.mimeType || 'video/mp4';
      }
      const ext = mimeType.includes('webm') ? '.webm' : mimeType.includes('mov') ? '.mov' : '.mp4';
      const buffer = Buffer.from(base64, 'base64');
      console.log(`[Jimeng-RPA] 参考视频 [${i}]: type=${mimeType}, size=${buffer.length} bytes`);
      filesData.push({ base64, mimeType, ext, name: `影片${i + 1}${ext}`, size: buffer.length });
    }

    // 监听上传网络请求
    const uploadResponses = [];
    const responseHandler = async (response) => {
      const url = response.url();
      if (url.includes('upload') || url.includes('material') || url.includes('resource')) {
        try {
          const status = response.status();
          uploadResponses.push({ url: url.substring(0, 120), status });
          console.log(`[Jimeng-RPA] 视频上传请求: ${status} ${url.substring(0, 120)}`);
        } catch (_) {}
      }
    };
    page.on('response', responseHandler);

    // 记录上传前参考区域的媒体数量
    const preUploadCount = await page.evaluate(() => {
      const selectors = [
        '[class*=reference-upload] img',
        '[class*=reference-upload] video',
        '[class*=upload-card] img',
        '[class*=upload-card] video',
        '[class*=ref-item] img',
        '[class*=ref-item] video',
        '[class*=reference] img[src]',
        '[class*=reference] video[src]',
      ];
      let total = 0;
      const found = new Set();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (!found.has(el)) { found.add(el); total++; }
        });
      }
      return total;
    });
    console.log(`[Jimeng-RPA] 视频上传前参考区域已有 ${preUploadCount} 个媒体`);

    const MAX_RETRIES = 3;
    const methods = ['datatransfer', 'uploadfile', 'filechooser'];
    let uploadSuccess = false;

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const method = methods[attempt % methods.length];
        if (attempt > 0) {
          console.log(`[Jimeng-RPA] 视频上传重试 ${attempt + 1}/${MAX_RETRIES}，方法: ${method}`);
          await new Promise(r => setTimeout(r, 1500));
        }

        console.log(`[Jimeng-RPA] 视频上传方法: ${method}`);

        if (method === 'datatransfer') {
          // === 方法 A: DataTransfer ===
          const result = await page.evaluate((files) => {
            try {
              const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
              if (allInputs.length === 0) return { ok: false, error: 'no file input found' };

              // 优先：reference-upload 内 accept 含 video 的 input
              let input = allInputs.find(inp => {
                const inRef = inp.closest('[class*=reference-upload]') !== null;
                return inRef && (inp.accept || '').includes('video');
              });
              // 其次：reference-upload 内最后一个
              if (!input) {
                const refInputs = allInputs.filter(inp => inp.closest('[class*=reference-upload]') !== null);
                if (refInputs.length > 0) input = refInputs[refInputs.length - 1];
              }
              // 回退：最后一个 file input
              if (!input) input = allInputs[allInputs.length - 1];

              const dt = new DataTransfer();
              let addedCount = 0;
              for (const f of files) {
                try {
                  const binaryStr = atob(f.base64);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                  const blob = new Blob([bytes], { type: f.mimeType });
                  const file = new File([blob], f.name, { type: f.mimeType, lastModified: Date.now() });
                  dt.items.add(file);
                  addedCount++;
                } catch (e) {
                  return { ok: false, error: `file ${f.name}: ${e.message}` };
                }
              }

              if (dt.files.length === 0 && addedCount > 0) {
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
                if (nativeSet) {
                  nativeSet.call(input, dt.files);
                } else {
                  input.files = dt.files;
                }
              } else {
                input.files = dt.files;
              }

              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));

              return { ok: true, fileCount: dt.files.length, addedCount };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, filesData.map(f => ({ base64: f.base64, mimeType: f.mimeType, name: f.name })));

          console.log(`[Jimeng-RPA] 视频 DataTransfer 结果:`, JSON.stringify(result));

        } else if (method === 'uploadfile') {
          // === 方法 B: uploadFile ===
          const tmpPaths = [];
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-video-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
            }
            const allRefInputs = await page.$$('[class*=reference-upload] input[type="file"]');
            let fileInput = null;
            for (const inp of allRefInputs) {
              const accept = await inp.evaluate(el => el.accept || '');
              if (accept.includes('video')) { fileInput = inp; break; }
            }
            if (!fileInput && allRefInputs.length > 0) fileInput = allRefInputs[allRefInputs.length - 1];
            if (!fileInput) {
              const anyInputs = await page.$$('input[type="file"]');
              if (anyInputs.length > 0) fileInput = anyInputs[anyInputs.length - 1];
            }

            if (fileInput) {
              await fileInput.uploadFile(...tmpPaths);
              await fileInput.evaluate(el => {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
              });
              console.log(`[Jimeng-RPA] 视频 uploadFile 完成: ${tmpPaths.length} 个文件`);
            } else {
              console.warn(`[Jimeng-RPA] 视频上传未找到 file input`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }

        } else {
          // === 方法 C: fileChooser ===
          const tmpPaths = [];
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-video-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
            }
            const uploadSelectors = [
              '[class*=reference-upload]', '[class*=reference-upload]', '[class*=upload-trigger]',
            ];
            let uploadArea = null;
            for (const sel of uploadSelectors) {
              uploadArea = await page.$(sel);
              if (uploadArea) break;
            }
            if (uploadArea) {
              const box = await uploadArea.boundingBox();
              if (box) {
                const [fileChooser] = await Promise.all([
                  page.waitForFileChooser({ timeout: 8000 }),
                  page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
                ]);
                await fileChooser.accept(tmpPaths);
                console.log(`[Jimeng-RPA] 视频 fileChooser.accept 完成: ${tmpPaths.length} 个文件`);
              }
            } else {
              console.warn(`[Jimeng-RPA] 视频上传未找到上传区域`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }
        }

        // 等待上传完成
        let detected = false;
        for (let waitRound = 0; waitRound < 8; waitRound++) {
          await new Promise(r => setTimeout(r, 2000));

          const tosUploads = uploadResponses.filter(r => r.url.includes('tos-') && r.status === 200);
          const uniqueTosUrls = new Set(tosUploads.map(r => r.url));

          const postCheck = await page.evaluate((preCount) => {
            const selectors = [
              '[class*=reference-upload] img',
              '[class*=reference-upload] video',
              '[class*=upload-card] img',
              '[class*=upload-card] video',
              '[class*=ref-item] img',
              '[class*=ref-item] video',
              '[class*=reference] img[src]',
              '[class*=reference] video[src]',
            ];
            let total = 0;
            const found = new Set();
            for (const sel of selectors) {
              document.querySelectorAll(sel).forEach(el => {
                if (!found.has(el)) { found.add(el); total++; }
              });
            }
            return { count: total, diff: total - preCount };
          }, preUploadCount);

          console.log(`[Jimeng-RPA] 视频上传后 ${(waitRound + 1) * 2}s: 媒体数 ${postCheck.count} (新增 ${postCheck.diff}), tos ${uniqueTosUrls.size}/${filesData.length}`);

          if (postCheck.diff > 0) {
            detected = true;
            console.log(`[Jimeng-RPA] 检测到新增 ${postCheck.diff} 个参考媒体`);
            break;
          }
          if (uniqueTosUrls.size >= filesData.length) {
            detected = true;
            console.log(`[Jimeng-RPA] tos 上传 ${uniqueTosUrls.size} 个视频文件确认成功`);
            break;
          }
        }

        if (detected) {
          uploadSuccess = true;
          console.log(`[Jimeng-RPA] 参考视频上传成功 (方法: ${method})`);
          break;
        }

        console.warn(`[Jimeng-RPA] 视频上传方法 ${method} 未成功，${attempt < MAX_RETRIES - 1 ? '尝试下一方法' : '所有方法都失败'}`);
      }

      if (!uploadSuccess) {
        console.error(`[Jimeng-RPA] 参考视频上传失败！3种方法都未成功`);
        throw new Error('参考视频上传失败');
      }
    } finally {
      page.off('response', responseHandler);
    }

    console.log(`[Jimeng-RPA] 参考视频上传完成: ${referenceVideos.length} 个`);
  }

  /**
   * 上传视频参考音频（与图片/视频相同的上传区域）
   */
  async _uploadVideoRefAudios(page, referenceAudios) {
    console.log(`[Jimeng-RPA] 开始上传 ${referenceAudios.length} 个参考音频`);

    // 解析所有参考音频为 { base64, mimeType, ext } 数组
    const filesData = [];
    for (let i = 0; i < referenceAudios.length; i++) {
      const ref = referenceAudios[i];
      let base64, mimeType;
      if (typeof ref === 'string') {
        const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        } else {
          base64 = ref;
          mimeType = 'audio/mpeg';
        }
      } else {
        base64 = ref.base64;
        mimeType = ref.mimeType || 'audio/mpeg';
      }
      const ext = mimeType.includes('wav') ? '.wav' : mimeType.includes('ogg') ? '.ogg' : mimeType.includes('aac') ? '.aac' : '.mp3';
      const buffer = Buffer.from(base64, 'base64');
      console.log(`[Jimeng-RPA] 参考音频 [${i}]: type=${mimeType}, size=${buffer.length} bytes`);
      filesData.push({ base64, mimeType, ext, name: `音訊${i + 1}${ext}`, size: buffer.length });
    }

    // 监听上传网络请求（用于 log 确认，不阻塞流程）
    const uploadResponses = [];
    const responseHandler = async (response) => {
      const url = response.url();
      if (url.includes('upload') || url.includes('material') || url.includes('resource')) {
        try {
          const status = response.status();
          uploadResponses.push({ url: url.substring(0, 120), status });
          console.log(`[Jimeng-RPA] 音频上传请求: ${status} ${url.substring(0, 120)}`);
        } catch (_) {}
      }
    };
    page.on('response', responseHandler);

    const MAX_RETRIES = 3;
    const methods = ['datatransfer', 'uploadfile', 'filechooser'];
    let uploadSuccess = false;

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const method = methods[attempt % methods.length];
        if (attempt > 0) {
          console.log(`[Jimeng-RPA] 音频上传重试 ${attempt + 1}/${MAX_RETRIES}，方法: ${method}`);
          await new Promise(r => setTimeout(r, 1500));
        }

        console.log(`[Jimeng-RPA] 音频上传方法: ${method}`);

        if (method === 'datatransfer') {
          const result = await page.evaluate((files) => {
            try {
              const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
              if (allInputs.length === 0) return { ok: false, error: 'no file input found' };

              let input = allInputs.find(inp => {
                const inRef = inp.closest('[class*=reference-upload]') !== null;
                return inRef && (inp.accept || '').includes('video');
              });
              if (!input) {
                const refInputs = allInputs.filter(inp => inp.closest('[class*=reference-upload]') !== null);
                if (refInputs.length > 0) input = refInputs[refInputs.length - 1];
              }
              if (!input) input = allInputs[allInputs.length - 1];

              const dt = new DataTransfer();
              let addedCount = 0;
              for (const f of files) {
                try {
                  const binaryStr = atob(f.base64);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                  const blob = new Blob([bytes], { type: f.mimeType });
                  const file = new File([blob], f.name, { type: f.mimeType, lastModified: Date.now() });
                  dt.items.add(file);
                  addedCount++;
                } catch (e) {
                  return { ok: false, error: `file ${f.name}: ${e.message}` };
                }
              }

              if (dt.files.length === 0 && addedCount > 0) {
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
                if (nativeSet) {
                  nativeSet.call(input, dt.files);
                } else {
                  input.files = dt.files;
                }
              } else {
                input.files = dt.files;
              }

              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));

              return { ok: true, fileCount: dt.files.length, addedCount };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, filesData.map(f => ({ base64: f.base64, mimeType: f.mimeType, name: f.name })));

          console.log(`[Jimeng-RPA] 音频 DataTransfer 结果:`, JSON.stringify(result));

          // 信任 DataTransfer 结果：addedCount 够就算成功，直接进下一步
          if (result && result.ok && result.addedCount >= filesData.length) {
            uploadSuccess = true;
            console.log(`[Jimeng-RPA] 参考音频上传成功 (DataTransfer addedCount=${result.addedCount})`);
            break;
          }

        } else if (method === 'uploadfile') {
          const tmpPaths = [];
          let fileInputFound = false;
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-audio-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
            }
            const allRefInputs = await page.$$('[class*=reference-upload] input[type="file"]');
            let fileInput = null;
            for (const inp of allRefInputs) {
              const accept = await inp.evaluate(el => el.accept || '');
              if (accept.includes('video')) { fileInput = inp; break; }
            }
            if (!fileInput && allRefInputs.length > 0) fileInput = allRefInputs[allRefInputs.length - 1];
            if (!fileInput) {
              const anyInputs = await page.$$('input[type="file"]');
              if (anyInputs.length > 0) fileInput = anyInputs[anyInputs.length - 1];
            }

            if (fileInput) {
              await fileInput.uploadFile(...tmpPaths);
              await fileInput.evaluate(el => {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
              });
              fileInputFound = true;
              console.log(`[Jimeng-RPA] 音频 uploadFile 完成: ${tmpPaths.length} 个文件`);
            } else {
              console.warn(`[Jimeng-RPA] 音频上传未找到 file input`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }

          if (fileInputFound) {
            uploadSuccess = true;
            console.log(`[Jimeng-RPA] 参考音频上传成功 (uploadFile)`);
            break;
          }

        } else {
          const tmpPaths = [];
          let chooserAccepted = false;
          try {
            for (let i = 0; i < filesData.length; i++) {
              const f = filesData[i];
              const tmpPath = path.join(os.tmpdir(), `jimeng-ref-audio-${Date.now()}-${i}${f.ext}`);
              fs.writeFileSync(tmpPath, Buffer.from(f.base64, 'base64'));
              tmpPaths.push(tmpPath);
            }
            const uploadSelectors = [
              '[class*=reference-upload]', '[class*=reference-upload]', '[class*=upload-trigger]',
            ];
            let uploadArea = null;
            for (const sel of uploadSelectors) {
              uploadArea = await page.$(sel);
              if (uploadArea) break;
            }
            if (uploadArea) {
              const box = await uploadArea.boundingBox();
              if (box) {
                const [fileChooser] = await Promise.all([
                  page.waitForFileChooser({ timeout: 8000 }),
                  page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
                ]);
                await fileChooser.accept(tmpPaths);
                chooserAccepted = true;
                console.log(`[Jimeng-RPA] 音频 fileChooser.accept 完成: ${tmpPaths.length} 个文件`);
              }
            } else {
              console.warn(`[Jimeng-RPA] 音频上传未找到上传区域`);
            }
          } finally {
            for (const p of tmpPaths) { try { fs.unlinkSync(p); } catch (_) {} }
          }

          if (chooserAccepted) {
            uploadSuccess = true;
            console.log(`[Jimeng-RPA] 参考音频上传成功 (fileChooser)`);
            break;
          }
        }

        console.warn(`[Jimeng-RPA] 音频上传方法 ${method} 未成功，${attempt < MAX_RETRIES - 1 ? '尝试下一方法' : '所有方法都失败'}`);
      }

      if (!uploadSuccess) {
        console.error(`[Jimeng-RPA] 参考音频上传失败！3种方法都未成功`);
        throw new Error('参考音频上传失败');
      }
    } finally {
      page.off('response', responseHandler);
    }

    // 等待即梦处理上传的音频文件
    console.log(`[Jimeng-RPA] 参考音频上传完成: ${referenceAudios.length} 个，等待即梦处理...`);
    await new Promise(r => setTimeout(r, 3000));

    // log 确认 TOS 上传情况（不阻塞）
    const tosUploads = uploadResponses.filter(r => r.url.includes('tos-') && r.status === 200);
    console.log(`[Jimeng-RPA] 音频 TOS 上传确认: ${tosUploads.length} 个请求成功`);
  }

  /**
   * 输入视频提示词
   */
  async _enterVideoPrompt(page, prompt, mode, refCount, session) {
    const inputType = await page.evaluate(() => {
      const editors = document.querySelectorAll('.ProseMirror[contenteditable=true], .tiptap[contenteditable=true], [contenteditable=true][class*=editor], [contenteditable=true][class*=prompt]');
      for (const ed of editors) {
        const rect = ed.getBoundingClientRect();
        if (rect.width > 200 && ed.offsetParent !== null) return 'prosemirror';
      }
      const textarea = document.querySelector('textarea[class*=prompt-textarea]:not([class*=collapsed])');
      if (textarea && textarea.offsetParent !== null) return 'textarea';
      const input = document.querySelector('input[class*=prompt-input]:not([class*=collapsed])');
      if (input && input.offsetParent !== null) return 'input';
      const ce = document.querySelectorAll('[contenteditable=true]');
      for (const el of ce) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 20 && el.offsetParent !== null) return 'prosemirror';
      }
      return null;
    });
    console.log(`[Jimeng-RPA] 输入框类型检测: ${inputType}`);

    if (!inputType) throw new Error('找不到视频 prompt 输入框');

    const isOmni = mode === 'omni-reference' || mode === 'omni';

    // 解析 prompt 中的 @图片N / @视频N 引用
    const segments = [];
    const mentionRegex = /@(图片|视频|音频)(\d+)/g;
    let lastIndex = 0;
    let match;
    while ((match = mentionRegex.exec(prompt)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: prompt.substring(lastIndex, match.index) });
      }
      const mentionType = match[1]; // '图片' 或 '视频'
      const mentionNum = parseInt(match[2]);
      segments.push({ type: 'mention', label: `${mentionType}${mentionNum}`, num: mentionNum, mentionType });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < prompt.length) {
      segments.push({ type: 'text', value: prompt.substring(lastIndex) });
    }
    const hasMentions = segments.some(s => s.type === 'mention');
    console.log(`[Jimeng-RPA] prompt 解析: ${segments.length} 段, ${hasMentions ? segments.filter(s => s.type === 'mention').length + ' 个 @mention' : '无 @mention'}`);

    const focusEditor = async () => {
      await page.evaluate(() => {
        const editors = document.querySelectorAll('.ProseMirror[contenteditable=true], .tiptap[contenteditable=true], [contenteditable=true][class*=editor], [contenteditable=true][class*=prompt], [contenteditable=true]');
        let best = null, bestWidth = 0;
        for (const ed of editors) {
          const rect = ed.getBoundingClientRect();
          if (rect.width > 200 && rect.width > bestWidth && ed.offsetParent !== null) { best = ed; bestWidth = rect.width; }
        }
        if (best) {
          best.focus();
          const sel = window.getSelection();
          sel.selectAllChildren(best);
          sel.collapseToEnd();
        }
      });
      await new Promise(r => setTimeout(r, 200));
    };

    // 构建 label 候选列表
    // 国内即梦: 图片N / 视频N / 音频N
    // Dreamina 国际版（繁中）: 影像N / 影片N / 音訊N
    const buildLabelCandidates = (mentionType, mentionNum) => {
      const TYPE_MAP = {
        '图片': ['图片', '圖片', '影像', 'Image', 'Picture'],
        '视频': ['视频', '影片', 'Video'],
        '音频': ['音频', '音訊', 'Audio'],
      };
      const types = TYPE_MAP[mentionType] || [mentionType];
      const list = [];
      for (const t of types) {
        list.push(`${t}${mentionNum}`);  // "影像1"
        list.push(`${t} ${mentionNum}`); // "Image 1"
      }
      // 国际版 Dreamina @ 弹窗用上传文件名作为标签，0-indexed
      const FILENAME_PREFIX = { '图片': 'ref-image', '视频': 'ref-video', '音频': 'ref-audio' };
      const prefix = FILENAME_PREFIX[mentionType];
      if (prefix) {
        list.push(`${prefix}-${mentionNum - 1}`);   // "ref-image-0"
      }
      return list;
    };

    const insertMention = async (mentionType, mentionNum) => {
      const candidates = buildLabelCandidates(mentionType, mentionNum);
      const primaryLabel = candidates[0];

      await focusEditor();

      await page.keyboard.type('@', { delay: 50 });
      await new Promise(r => setTimeout(r, 1500));

      // 检测弹窗是否存在
      const popupInfo = await page.evaluate(() => {
        const allPopups = document.querySelectorAll('[class*=popover], [class*=popup], [class*=mention], [class*=dropdown], [class*=suggest], [data-tippy-root]');
        const visible = [];
        for (const p of allPopups) {
          if (p.offsetParent !== null) {
            visible.push({ class: (typeof p.className === 'string' ? p.className : p.className?.baseVal || '').substring(0, 80), text: p.textContent.substring(0, 100).trim() });
          }
        }
        return visible;
      });
      if (popupInfo.length > 0) {
        console.log(`[Jimeng-RPA] @ popup 检测到 ${popupInfo.length} 个:`, popupInfo.map(p => p.text.substring(0, 30)).join(' | '));
      }

      // DEBUG: 打印弹窗内所有可见元素的详细信息（标签、class、textContent）
      const debugElements = await page.evaluate(() => {
        const popups = document.querySelectorAll('[class*=popover], [class*=popup], [class*=mention], [class*=dropdown], [class*=suggest], [data-tippy-root]');
        const results = [];
        for (const popup of popups) {
          if (popup.offsetParent === null) continue;
          const children = popup.querySelectorAll('*');
          for (const child of children) {
            if (child.offsetParent === null) continue;
            const text = child.textContent.trim();
            if (!text || text.length > 100) continue;
            results.push({
              tag: child.tagName.toLowerCase(),
              cls: (typeof child.className === 'string' ? child.className : '').substring(0, 120),
              text: text.substring(0, 60),
              role: child.getAttribute('role') || '',
              clickable: child.tagName === 'BUTTON' || child.tagName === 'A' || child.tagName === 'LI' || child.style.cursor === 'pointer' || child.onclick !== null
            });
          }
        }
        return results;
      });
      if (debugElements.length > 0) {
        console.log(`[Jimeng-RPA] @${primaryLabel} 弹窗内元素详情 (${debugElements.length} 个):`);
        debugElements.forEach((el, i) => console.log(`  [${i}] <${el.tag}> role="${el.role}" cls="${el.cls}" text="${el.text}" clickable=${el.clickable}`));
      } else {
        console.log(`[Jimeng-RPA] @${primaryLabel} 弹窗内未检测到可见元素`);
      }

      // 多 label 候选 + 弹窗精准 + 兜底
      const clicked = await page.evaluate((lbls) => {
        const tryClick = (matchFn) => {
          // 第一优先：lv-select-popup 内 li[role=option]
          const popups = document.querySelectorAll('[class*=lv-select-popup], [class*=select-popup]');
          for (const popup of popups) {
            if (popup.offsetParent === null) continue;
            const options = popup.querySelectorAll('li[role=option]');
            for (const opt of options) {
              if (opt.offsetParent === null) continue;
              const text = opt.textContent.trim();
              if (matchFn(text)) { opt.click(); return { found: true, text, method: 'popup' }; }
            }
          }
          // 兜底：全页面常见交互元素
          const allElements = document.querySelectorAll('li, [role=option], [role=menuitem], [class*=item], [class*=option]');
          for (const el of allElements) {
            if (el.offsetParent === null) continue;
            if (el.closest('.ProseMirror') || el.closest('[contenteditable]')) continue;
            const text = el.textContent.trim();
            if (matchFn(text)) { el.click(); return { found: true, text, method: 'fallback' }; }
          }
          return null;
        };

        // 1. 任意候选 label 精确匹配
        for (const lbl of lbls) {
          const r = tryClick(text => text === lbl);
          if (r) return { ...r, matched: lbl };
        }
        // 2. 任意候选 label 模糊匹配
        for (const lbl of lbls) {
          const r = tryClick(text => text.includes(lbl) && text.length < 30);
          if (r) return { ...r, matched: lbl };
        }
        return { found: false };
      }, candidates);

      if (clicked.found) {
        console.log(`[Jimeng-RPA] @${primaryLabel} mention 选择成功 (${clicked.method}, matched=${clicked.matched})`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        // click 未命中 → Backspace 删掉 @ (弹窗自然关闭) → 重新输入 @ 再试一次
        console.warn(`[Jimeng-RPA] @${primaryLabel} 第一次 click 未命中，重试...`);
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 300));
        await focusEditor();
        await page.keyboard.type('@', { delay: 50 });
        await new Promise(r => setTimeout(r, 1500));

        const retryClicked = await page.evaluate((lbls) => {
          const popups = document.querySelectorAll('[class*=lv-select-popup], [class*=select-popup]');
          for (const popup of popups) {
            if (popup.offsetParent === null) continue;
            const options = popup.querySelectorAll('li[role=option]');
            for (const opt of options) {
              if (opt.offsetParent === null) continue;
              const text = opt.textContent.trim();
              for (const lbl of lbls) {
                if (text === lbl) { opt.click(); return { found: true, text, method: 'popup-exact', matched: lbl }; }
              }
            }
          }
          const allElements = document.querySelectorAll('li, [role=option], [role=menuitem], [class*=item], [class*=option]');
          for (const el of allElements) {
            if (el.offsetParent === null) continue;
            if (el.closest('.ProseMirror') || el.closest('[contenteditable]')) continue;
            const text = el.textContent.trim();
            for (const lbl of lbls) {
              if (text === lbl) { el.click(); return { found: true, text, method: 'fallback-exact', matched: lbl }; }
            }
          }
          return { found: false };
        }, candidates);

        if (retryClicked.found) {
          console.log(`[Jimeng-RPA] @${primaryLabel} mention 重试选择成功 (${retryClicked.method}, matched=${retryClicked.matched})`);
          await new Promise(r => setTimeout(r, 500));
        } else {
          // 绝不按 Enter（会触发即梦表单提交）
          // Backspace 删掉 @，跳过这个 mention
          await page.keyboard.press('Backspace');
          await new Promise(r => setTimeout(r, 200));
          console.warn(`[Jimeng-RPA] @${primaryLabel} mention 选择失败，已跳过（不按 Enter） 候选: ${candidates.join(', ')}`);
        }
      }
    };

    if (inputType === 'prosemirror') {
      await page.evaluate(() => {
        const editors = document.querySelectorAll('.ProseMirror[contenteditable=true], .tiptap[contenteditable=true], [contenteditable=true][class*=editor], [contenteditable=true][class*=prompt], [contenteditable=true]');
        let best = null, bestWidth = 0;
        for (const ed of editors) {
          const rect = ed.getBoundingClientRect();
          if (rect.width > 200 && rect.width > bestWidth && ed.offsetParent !== null) { best = ed; bestWidth = rect.width; }
        }
        if (!best) return;
        best.focus();
        document.execCommand('selectAll');
        document.execCommand('delete');
      });
      await new Promise(r => setTimeout(r, 500));
      console.log(`[Jimeng-RPA] 文本框已清空 (${inputType})`);

      if (isOmni && hasMentions) {
        for (const seg of segments) {
          if (seg.type === 'mention') {
            await insertMention(seg.mentionType, seg.num);
          } else if (seg.value) {
            await focusEditor();
            await page.evaluate((text) => {
              document.execCommand('insertText', false, text);
            }, seg.value);
            await new Promise(r => setTimeout(r, 200));
          }
        }
        console.log(`[Jimeng-RPA] prompt 输入完成 (逐段 mention 模式)`);
      } else {
        await page.evaluate((text) => {
          document.execCommand('insertText', false, text);
        }, prompt);
      }
    } else {
      await page.evaluate((text) => {
        let el = document.querySelector('textarea[class*=prompt-textarea]:not([class*=collapsed])');
        let proto = window.HTMLTextAreaElement.prototype;
        if (!el || el.offsetParent === null) {
          el = document.querySelector('input[class*=prompt-input]:not([class*=collapsed])');
          proto = window.HTMLInputElement.prototype;
        }
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, prompt);
    }

    await new Promise(r => setTimeout(r, 500));
    console.log(`[Jimeng-RPA] 已输入提示词 (${inputType}): prompt ${prompt.length}字`);
  }

  /**
   * 点击生成按钮并捕获 submit_id
   */
  async _clickVideoGenerateWithCapture(page) {
    const btnClicked = await page.evaluate(() => {
      const btn = document.querySelector('button[class*=submit-button]:not(.lv-btn-disabled)');
      if (btn && !btn.disabled) { btn.click(); return 'submit-button'; }
      const icons = document.querySelectorAll('[class*=toolbar-bottom] .icon-btn, .submit-icon-btn');
      for (const icon of icons) {
        const rect = icon.getBoundingClientRect();
        if (rect.x > 1000 && rect.width > 20) { icon.click(); return 'icon-btn'; }
      }
      const allBtns = document.querySelectorAll('button');
      for (const b of allBtns) {
        if (b.textContent.trim().includes('生成') && !b.disabled) { b.click(); return 'text-btn'; }
      }
      return null;
    });
    console.log(`[Jimeng-RPA] 点击生成按钮: ${btnClicked || '(未找到，尝试坐标点击)'}`);

    if (!btnClicked) {
      await page.mouse.click(1342, 841);
      console.log('[Jimeng-RPA] 使用坐标点击生成');
    }

    await new Promise(r => setTimeout(r, 3000));
    return null;
  }

  /**
   * 把记录列表滚到底部，让最新记录出现在 DOM 中。
   * 新记录出现在列表最下面，滚到底部后标记最后一条，
   * 生成后新记录会出现在它下方，即可检测到。
   */
  async _scrollRecordListToBottom(page) {
    try {
      await page.evaluate(() => {
        const first = document.querySelector('[class*=record-content-], [class*=video-record-]:not([class*=video-record-content])');
        if (!first) return;
        let el = first.parentElement;
        while (el && el !== document.body && el !== document.documentElement) {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
            el.scrollTop = el.scrollHeight;
            break;
          }
          el = el.parentElement;
        }
      });
      await new Promise(r => setTimeout(r, 400));
    } catch (e) { console.warn(`[Jimeng-RPA] _scrollRecordListToBottom error:`, e.message); }
  }

  /**
   * 等待新记录出现并立刻打标记
   * 策略：滚到底部，最后一条没有 data-lo-existing 的就是新记录
   * @param {Page} page - Puppeteer 页面
   * @param {string} markerId - 唯一标记 ID
   * @param {number} timeout - 超时毫秒数
   * @returns {boolean} 是否成功标记
   */
  async _waitAndMarkNewRecord(page, markerId, timeout = 15000) {
    const BROAD_SELECTOR = '[class*=record-content-], [class*=video-record-]:not([class*=video-record-content])';
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      await this._scrollRecordListToBottom(page);
      const marked = await page.evaluate((args) => {
        const els = document.querySelectorAll(args.selector);
        if (els.length === 0) return false;
        const last = els[els.length - 1];
        if (last.hasAttribute('data-lo-existing')) return false;
        last.setAttribute('data-lo-task', args.markerId);
        return true;
      }, { selector: BROAD_SELECTOR, markerId });

      if (marked) {
        await page.evaluate(() => {
          document.querySelectorAll('[data-lo-existing]').forEach(el => el.removeAttribute('data-lo-existing'));
        });
        console.log(`[Jimeng-RPA] 新记录已标记: data-lo-task="${markerId}"`);
        return true;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    await page.evaluate(() => {
      document.querySelectorAll('[data-lo-existing]').forEach(el => el.removeAttribute('data-lo-existing'));
    }).catch(() => {});
    console.warn(`[Jimeng-RPA] 等待新记录超时 (${timeout / 1000}s), markerId=${markerId}`);
    return false;
  }

  /**
   * DOM 轮询等待视频生成结果
   */
  /**
   * DOM 轮询等待图片生成结果（不需要页面在前台）
   * 与视频轮询逻辑一致：通过 page.evaluate 检查 DOM 中的图片元素
   */
  async _pollForImageResult(page, initialRecordCount, markerId, task) {
    const pollInterval = 5000;
    const startTime = Date.now();
    const TIMEOUT = 5 * 60 * 1000;
    console.log(`[Jimeng-RPA] 图片轮询开始: markerId=${markerId || '(无)'}, initialCount=${initialRecordCount}`);

    while (true) {
      await new Promise(r => setTimeout(r, pollInterval));

      if (task && task.cancelled) throw new Error('任务已取消');
      if (Date.now() - startTime > TIMEOUT) throw new Error('即梦图片生成超时（5分钟未收到结果）');

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      let result;
      try {
        result = await page.evaluate((args) => {
          const { markerId, initialCount } = args;
          const RECORD_SELECTOR = '[class*=record-content]';

          // 定位 targetRecord
          let targetRecord = null;
          if (markerId) {
            targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
          }
          if (!targetRecord) {
            const records = document.querySelectorAll(RECORD_SELECTOR);
            const newRecordCount = records.length - initialCount;
            if (newRecordCount > 0) targetRecord = records[initialCount];
          }

          if (!targetRecord) {
            // 检查 toast 错误
            const toasts = document.querySelectorAll('.lv-message, .lv-notification, [class*=toast]');
            for (const t of toasts) {
              const txt = t.textContent?.trim() || '';
              const lower = txt.toLowerCase();
              if (txt.includes('网络') || txt.includes('失败') || txt.includes('违规') || txt.includes('敏感')
                || txt.includes('失敗') || txt.includes('錯誤') || txt.includes('違規') || txt.includes('網路') || txt.includes('網絡') || txt.includes('不當')
                || lower.includes('failed') || lower.includes('error') || lower.includes('violat') || lower.includes('sensitive') || lower.includes('network') || lower.includes('inappropriate') || lower.includes('community guidelines')) {
                return { status: 'failed', error: txt.substring(0, 150) };
              }
            }
            return { status: 'waiting' };
          }

          // 错误检测
          const errorEl = targetRecord.querySelector('[class*=error-tips], [class*=error-msg]');
          if (errorEl) return { status: 'failed', error: errorEl.textContent?.trim() || '生成失败' };

          const recText = targetRecord.textContent || '';
          const recLower = recText.toLowerCase();
          if (recText.includes('网络异常') || recText.includes('生成失败') || recText.includes('违规')
            || recText.includes('網路異常') || recText.includes('失敗') || recText.includes('違規') || recText.includes('不當')
            || recLower.includes('failed') || recLower.includes('inappropriate') || recLower.includes('violat') || recLower.includes('community guidelines')) {
            return { status: 'failed', error: recText.substring(0, 150) };
          }

          // 搜索图片：找已完成的图片（非 loading 占位图）
          const searchAreas = [targetRecord];
          const parent = targetRecord.parentElement;
          if (parent) searchAreas.push(parent);

          for (const area of searchAreas) {
            const imgs = area.querySelectorAll('img');
            const urls = [];
            for (const img of imgs) {
              const src = img.src || '';
              // 跳过占位图、icon、头像等
              if (!src.startsWith('http')) continue;
              if (src.includes('static/') || src.includes('icon') || src.includes('avatar')) continue;
              if (img.width < 50 || img.height < 50) continue;
              // 即梦生成的图片 URL 通常包含 tos 或 cdn
              if (src.includes('tos-') || src.includes('cdn') || src.includes('image') || src.includes('vlabstatic')) {
                urls.push(src);
              }
            }
            if (urls.length > 0) return { status: 'completed', urls };
          }

          // 还在生成中
          const progressMatch = recText.match(/(\d+)%/);
          return {
            status: 'generating',
            progress: progressMatch ? progressMatch[1] + '%' : '...',
            recTextHead: recText.substring(0, 100),
          };
        }, { markerId, initialCount: initialRecordCount });
      } catch (evalErr) {
        if (evalErr.message?.includes('detached') || evalErr.message?.includes('Session closed') || evalErr.message?.includes('Target closed')) {
          throw new Error('即梦页面连接断开，请重新生成');
        }
        throw evalErr;
      }

      if (result.status !== 'waiting') {
        console.log(`[Jimeng-RPA] [img-poll ${elapsed}s] status=${result.status}${result.urls ? ` urls=${result.urls.length}` : ''}${result.error ? ` error=${result.error.substring(0, 60)}` : ''}`);
      }

      if (result.status === 'completed') {
        // DOM 检测到图片后，逐张点击 → 弹窗 → 下载按钮 → 拦截原图 URL
        try {
          const origUrls = await this._getOriginalImageUrls(page, initialRecordCount, markerId);
          if (origUrls && origUrls.length > 0) {
            console.log(`[Jimeng-RPA] 获取到 ${origUrls.length} 张原图 URL`);
            return origUrls;
          }
        } catch (e) {
          console.warn(`[Jimeng-RPA] 原图 URL 获取失败，使用 DOM 图片: ${e.message}`);
        }
        console.warn(`[Jimeng-RPA] 未获取到原图，使用 DOM 缩略图`);
        return result.urls;
      } else if (result.status === 'failed') {
        throw new Error(result.error);
      }
    }
  }

  /**
   * DOM 检测到图片完成后，逐张点击图片 → 弹窗 → 点下载 → 拦截原图 URL
   * 跟 _getHDVideoUrl 一样的策略，但图片有多张需要分别操作
   */
  async _getOriginalImageUrls(page, initialRecordCount, markerId) {
    const LOG = '[Jimeng-RPA] HD-IMG:';
    const urls = [];

    // 1. 找到目标记录中的所有图片数量
    const imgCount = await page.evaluate((args) => {
      const { markerId, initCount } = args;
      let targetRecord = null;
      if (markerId) targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
      if (!targetRecord) {
        const records = document.querySelectorAll('[class*=record-content]');
        if (records.length > initCount) targetRecord = records[initCount];
      }
      if (!targetRecord) return 0;
      const container = targetRecord.closest('[class*=item-]') || targetRecord.parentElement?.parentElement || targetRecord.parentElement;
      if (!container) return 0;
      const imgs = container.querySelectorAll('img');
      let count = 0;
      for (const img of imgs) {
        if (img.width >= 50 && img.height >= 50 && img.src.startsWith('http')) count++;
      }
      return count;
    }, { markerId, initCount: initialRecordCount });

    console.log(`${LOG} 检测到 ${imgCount} 张图片`);
    if (imgCount === 0) return null;

    // 2. 逐张点击图片 → 下载拦截
    for (let idx = 0; idx < imgCount; idx++) {
      try {
        // 先滚到视口中央，避免虚拟列表把卡片挤出画面后点不到
        await page.evaluate((args) => {
          const { markerId, initCount } = args;
          let targetRecord = null;
          if (markerId) targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
          if (!targetRecord) {
            const records = document.querySelectorAll('[class*=record-content]');
            if (records.length > initCount) targetRecord = records[initCount];
          }
          if (targetRecord) {
            try { targetRecord.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {}
          }
        }, { markerId, initCount: initialRecordCount });
        await new Promise(r => setTimeout(r, 400));

        // 点击第 idx 张图片打开弹窗
        const clicked = await page.evaluate((args) => {
          const { markerId, initCount, imgIdx } = args;
          let targetRecord = null;
          if (markerId) targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
          if (!targetRecord) {
            const records = document.querySelectorAll('[class*=record-content]');
            if (records.length > initCount) targetRecord = records[initCount];
          }
          if (!targetRecord) return { ok: false, error: 'record not found' };
          const container = targetRecord.closest('[class*=item-]') || targetRecord.parentElement?.parentElement || targetRecord.parentElement;
          if (!container) return { ok: false, error: 'container not found' };
          const imgs = [];
          for (const img of container.querySelectorAll('img')) {
            if (img.width >= 50 && img.height >= 50 && img.src.startsWith('http')) imgs.push(img);
          }
          if (imgIdx >= imgs.length) return { ok: false, error: `img ${imgIdx} not found (${imgs.length} total)` };
          imgs[imgIdx].click();
          return { ok: true };
        }, { markerId, initCount: initialRecordCount, imgIdx: idx });

        if (!clicked.ok) {
          console.warn(`${LOG} 图片 ${idx}: ${clicked.error}`);
          continue;
        }

        // 等弹窗 + 下载按钮出现
        let btnFound = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          btnFound = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role=button], a');
            for (const btn of btns) {
              const text = btn.textContent?.trim() || '';
              if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return true;
              }
            }
            return false;
          });
          if (btnFound) break;
        }

        if (!btnFound) {
          console.warn(`${LOG} 图片 ${idx}: 下载按钮未出现`);
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 300));
          continue;
        }

        // 拦截网络请求拿原图 URL
        let downloadUrl = null;

        // 先检查 href
        downloadUrl = await page.evaluate(() => {
          const btns = document.querySelectorAll('button, [role=button], a');
          for (const btn of btns) {
            const text = btn.textContent?.trim() || '';
            if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
              if (btn.tagName === 'A' && btn.href && btn.href.startsWith('http')) return btn.href;
              const link = btn.closest('a') || btn.querySelector('a');
              if (link?.href && link.href.startsWith('http')) return link.href;
            }
          }
          return null;
        });

        if (!downloadUrl) {
          // 监听网络请求 + 点下载
          let networkUrl = null;
          const netHandler = (response) => {
            try {
              const url = response.url();
              const ct = response.headers()['content-type'] || '';
              const cd = response.headers()['content-disposition'] || '';
              if (ct.includes('image') || cd.includes('attachment') ||
                  (url.includes('tos-') && (url.includes('.png') || url.includes('.jpg') || url.includes('.jpeg') || url.includes('.webp')))) {
                if (!networkUrl && url.length > 100) { // 原图 URL 通常很长
                  networkUrl = url;
                }
              }
            } catch (_) {}
          };
          page.on('response', netHandler);

          // 点下载
          await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role=button], a');
            for (const btn of btns) {
              const text = btn.textContent?.trim() || '';
              if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) { btn.click(); return; }
              }
            }
          });

          // 等最多 5 秒
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (networkUrl) break;
          }

          page.off('response', netHandler);
          downloadUrl = networkUrl;
        }

        // 关闭弹窗
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));

        if (downloadUrl) {
          console.log(`${LOG} 图片 ${idx}: ${downloadUrl.substring(0, 80)}...`);
          urls.push(downloadUrl);
        } else {
          console.warn(`${LOG} 图片 ${idx}: 未拦截到下载 URL`);
        }
      } catch (e) {
        console.error(`${LOG} 图片 ${idx} 失败: ${e.message}`);
        try { await page.keyboard.press('Escape'); } catch (_) {}
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return urls.length > 0 ? urls : null;
  }

  async _pollForVideoResult(page, submitId, prompt, externalInitialCount, task, session, markerId) {
    const pollInterval = 12000;
    const startTime = Date.now();
    let generationStarted = false;
    const initialCount = externalInitialCount ?? 0;
    console.log(`[Jimeng-RPA] 视频轮询开始: markerId=${markerId || '(无)'}, initialCount=${initialCount}`);

    while (true) {
      await new Promise(r => setTimeout(r, pollInterval));

      // 检查任务是否被取消
      if (task && task.cancelled) {
        throw new Error('任务已取消');
      }

      // Worker Pool 模式下每 page 独占一个任务，不需要等待其他任务

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      let result;
      try {
      result = await page.evaluate((args) => {
        const { markerId, initialCount } = args;
        const RECORD_SELECTOR = '[class*=record-content]';

        // ── 定位 targetRecord：优先用标记，fallback 用位置 ──
        let targetRecord = null;
        if (markerId) {
          targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
        }
        if (!targetRecord) {
          const records = document.querySelectorAll(RECORD_SELECTOR);
          const newRecordCount = records.length - initialCount;
          if (newRecordCount > 0) {
            targetRecord = records[initialCount];
          }
        }

        if (!targetRecord) {
          // 记录还没出现，只检查 toast 级别的错误提示
          const toasts = document.querySelectorAll('.lv-message, .lv-notification, [class*=toast], [class*=Toast], [class*=message-notice]');
          for (const t of toasts) {
            const txt = t.textContent?.trim() || '';
            const lower = txt.toLowerCase();
            if (txt.includes('网络') || txt.includes('失败') || txt.includes('失敗') || txt.includes('網路') || txt.includes('網絡') || txt.includes('錯誤') || txt.includes('不當')
              || lower.includes('failed') || lower.includes('error') || lower.includes('network') || lower.includes('inappropriate') || lower.includes('violat') || lower.includes('community guidelines')) return { status: 'failed', error: txt.substring(0, 150) };
          }
          const records = document.querySelectorAll(RECORD_SELECTOR);
          return { status: 'waiting', recordCount: records.length };
        }

        const recText = targetRecord.textContent || '';
        const recLower = recText.toLowerCase();

        // ── 错误检测：CSS class 错误元素 ──
        const errorEl = targetRecord.querySelector('[class*=error-tips], [class*=error-msg]');
        if (errorEl) {
          return { status: 'failed', error: errorEl.textContent?.trim() || '生成失败' };
        }
        // 也检查父元素一层（错误提示有时在父级）
        const parent = targetRecord.parentElement;
        if (parent) {
          const parentErrorEl = parent.querySelector('[class*=error-tips], [class*=error-msg]');
          if (parentErrorEl && !targetRecord.contains(parentErrorEl)) {
            return { status: 'failed', error: parentErrorEl.textContent?.trim() || '生成失败' };
          }
        }

        // ── 错误检测：文字关键词（简体+繁体+英文） ──
        if (recText.includes('网络异常') || recText.includes('生成失败') || recText.includes('违规')
          || recText.includes('網路異常') || recText.includes('失敗') || recText.includes('違規') || recText.includes('不當')
          || recLower.includes('inappropriate') || recLower.includes('violat') || recLower.includes('failed') || recLower.includes('error') || recLower.includes('community guidelines')) {
          const errorSnippet = recText.substring(0, 200).replace(/\s+/g, ' ').trim();
          return { status: 'failed', error: errorSnippet };
        }

        // ── 视频元素搜索 ──
        const searchAreas = [targetRecord];
        if (parent) searchAreas.push(parent);

        for (const area of searchAreas) {
          const videos = area.querySelectorAll('video');
          if (videos.length > 0) {
            const urls = [];
            for (const v of videos) {
              const src = v.src || v.querySelector('source')?.src;
              if (src && src.startsWith('http') && !src.includes('loading') && !src.includes('static/media')) {
                urls.push(src);
              }
            }
            if (urls.length > 0) return { status: 'completed', urls };
          }
        }

        // ── 进度提取：从 targetRecord 自身文本 ──
        const progressMatch = recText.match(/(\d+)%/);
        const progress = progressMatch ? progressMatch[1] + '%' : null;
        const queueInfo = recText.match(/(造梦中|造夢中|排队中|排隊中|生成中|產生中|Generating|Queued|In queue|Processing)/i)?.[0] || '';
        const etaMatch = recText.match(/(预计.*?(\d+)|預計.*?(\d+)|ETA.*?(\d+)|about.*?(\d+)\s*s)/i);
        const eta = etaMatch ? etaMatch[0] : null;

        return {
          status: 'generating',
          progress: progress || '...',
          queue: queueInfo,
          eta,
          active: !!(progress || queueInfo),
          recTextHead: recText.substring(0, 100),
        };
      }, { markerId, initialCount });
      } catch (evalErr) {
        if (evalErr.message?.includes('detached') || evalErr.message?.includes('Session closed') || evalErr.message?.includes('Target closed')) {
          throw new Error('即梦页面连接断开（可能因排队时间过长导致页面刷新），请重新生成');
        }
        throw evalErr;
      }

      // 调试日志：记录每次轮询的原始判定
      if (result.status !== 'waiting') {
        console.log(`[Jimeng-RPA] [poll ${elapsed}s] status=${result.status}${result.progress ? ` progress=${result.progress}` : ''}${result.error ? ` error=${result.error.substring(0, 60)}` : ''}${result.recTextHead ? ` recText="${result.recTextHead}"` : ''}`);
      }

      if (result.status === 'completed') {
        if (!generationStarted && elapsed < 40) {
          console.log(`[Jimeng-RPA] [poll ${elapsed}s] completed but generationStarted=false, skip`);
          continue;
        }
        // 尝试获取原始品质下载 URL
        try {
          const hdUrl = await this._getHDVideoUrl(page, initialCount, markerId);
          if (hdUrl) {
            console.log(`[Jimeng-RPA] 获取到 HD 下载 URL: ${hdUrl.substring(0, 80)}...`);
            return [hdUrl];
          }
        } catch (e) {
          console.warn(`[Jimeng-RPA] HD URL 获取失败，使用预览 URL: ${e.message}`);
        }
        return result.urls;
      } else if (result.status === 'failed') {
        throw new Error(result.error);
      } else if (result.status === 'generating') {
        if (task) {
          task.progress = result.progress || 'generating';
          // 同步进度到 worker slot
          if (task.workerIndex !== undefined && session) {
            const slot = session.workerPages[task.workerIndex];
            if (slot) slot.currentProgress = task.progress;
          }
        }
        generationStarted = true;
        const info = [
          `${elapsed}s`,
          result.active ? 'active' : 'pending',
          result.progress,
          result.queue,
          result.eta,
        ].filter(Boolean).join(' ');
        console.log(`[Jimeng-RPA] [poll ${elapsed}s] ${info}`);
      } else if (result.status === 'waiting') {
        console.log(`[Jimeng-RPA] [poll ${elapsed}s] 等待生成启动... records=${result.recordCount}`);
      }
    }
  }

  // ────────────────────────────────────────────────────
  // HD 视频下载 URL 获取
  // ────────────────────────────────────────────────────

  /**
   * 点击即梦的视频 → 打开详情弹窗 → 点"↓ 下载"按钮 → 获取 HD 视频
   * 多策略: 1) 直接读 href  2) CDP downloadWillBegin  3) 网络请求拦截  4) 实际下载文件
   * @returns {string|null} HD 下载 URL 或本地缓存 URL，失败返回 null
   */
  async _getHDVideoUrl(page, initialCount, markerId) {
    const LOG = '[Jimeng-RPA] HD:';
    let cdp = null;
    let downloadDir = null;
    let networkHandler = null;

    try {
      // 1. 先把卡片滚到视口中央，确保下载按钮可点（即梦用了虚拟列表，卡片滚出画面就点不到）
      await page.evaluate((args) => {
        const { markerId, initCount } = args;
        let targetRecord = null;
        if (markerId) {
          targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
        }
        if (!targetRecord) {
          const records = document.querySelectorAll('[class*=record-content]');
          if (records.length > initCount) targetRecord = records[initCount];
        }
        if (targetRecord) {
          try { targetRecord.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {}
        }
      }, { markerId, initCount: initialCount });
      await new Promise(r => setTimeout(r, 400));

      // 2. 点击视频打开详情弹窗
      const videoClicked = await page.evaluate((args) => {
        const { markerId, initCount } = args;
        let targetRecord = null;
        if (markerId) {
          targetRecord = document.querySelector('[data-lo-task="' + markerId + '"]');
        }
        if (!targetRecord) {
          const records = document.querySelectorAll('[class*=record-content]');
          if (records.length <= initCount) return { ok: false, error: 'record not found' };
          targetRecord = records[initCount];
        }
        const container = targetRecord.closest('[class*=item-]') || targetRecord.parentElement?.parentElement || targetRecord.parentElement;
        if (!container) return { ok: false, error: 'container not found' };
        const video = container.querySelector('video');
        if (!video) return { ok: false, error: 'video element not found' };
        video.click();
        return { ok: true };
      }, { markerId, initCount: initialCount });

      if (!videoClicked.ok) {
        console.warn(`${LOG} ${videoClicked.error}`);
        return null;
      }

      // 2. 等待弹窗出现 + 下载按钮可见
      let btnFound = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        btnFound = await page.evaluate(() => {
          const btns = document.querySelectorAll('button, [role=button], a');
          for (const btn of btns) {
            const text = btn.textContent?.trim() || '';
            if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) return true;
            }
          }
          return false;
        });
        if (btnFound) break;
      }

      if (!btnFound) {
        console.warn(`${LOG} 弹窗未出现或找不到下载按钮`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        return null;
      }

      console.log(`${LOG} 弹窗已打开，找到下载按钮`);

      // 3. 策略1: 直接读 href（如果下载按钮是 <a> 标签）
      const directUrl = await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role=button], a');
        for (const btn of btns) {
          const text = btn.textContent?.trim() || '';
          if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
            if (btn.tagName === 'A' && btn.href && btn.href.startsWith('http')) return btn.href;
            const link = btn.closest('a') || btn.querySelector('a');
            if (link?.href && link.href.startsWith('http')) return link.href;
          }
        }
        return null;
      });

      if (directUrl) {
        console.log(`${LOG} 从 href 直接获取: ${directUrl.substring(0, 80)}...`);
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        return directUrl;
      }

      // 4. 策略2+3+4: CDP 下载拦截 + 网络请求 + 实际下载文件
      downloadDir = path.join(os.tmpdir(), `jimeng-hd-${Date.now()}`);
      fs.mkdirSync(downloadDir, { recursive: true });

      cdp = await page.createCDPSession();
      let cdpUrl = null;
      let networkUrl = null;

      // CDP: 监听 downloadWillBegin
      cdp.on('Page.downloadWillBegin', (event) => {
        cdpUrl = event.url;
        console.log(`${LOG} CDP downloadWillBegin: ${event.url.substring(0, 80)}...`);
      });

      // 设置下载行为：允许下载到临时目录
      await cdp.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // 网络请求拦截: 找视频 URL
      networkHandler = (response) => {
        try {
          const url = response.url();
          const ct = response.headers()['content-type'] || '';
          const cd = response.headers()['content-disposition'] || '';
          if (ct.includes('video') || cd.includes('attachment') ||
              (url.includes('.mp4') && !url.includes('poster') && !url.includes('thumb'))) {
            if (!networkUrl) {
              networkUrl = url;
              console.log(`${LOG} 网络拦截: ${url.substring(0, 80)}...`);
            }
          }
        } catch (_) {}
      };
      page.on('response', networkHandler);

      // 5. 点击下载按钮
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role=button], a');
        for (const btn of btns) {
          const text = btn.textContent?.trim() || '';
          if (text === '下载' || text === '↓ 下载' || text === '↓下载') {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      });

      console.log(`${LOG} 已点击下载按钮，等待结果...`);

      // 6. 等待结果（最多 30 秒）
      let downloadedFile = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));

        // 优先: CDP 或网络拦截到了 URL
        if (cdpUrl || networkUrl) break;

        // 检查下载目录是否有完成的文件
        try {
          const files = fs.readdirSync(downloadDir)
            .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && f !== '.DS_Store');
          if (files.length > 0) {
            downloadedFile = path.join(downloadDir, files[0]);
            console.log(`${LOG} 文件已下载: ${downloadedFile}`);
            break;
          }
        } catch (_) {}
      }

      // 7. 清理: 移除网络监听 + 恢复下载行为
      page.off('response', networkHandler);
      networkHandler = null;
      try { await cdp.send('Page.setDownloadBehavior', { behavior: 'default' }); } catch (_) {}
      try { await cdp.detach(); } catch (_) {}
      cdp = null;

      // 8. 关闭弹窗
      await new Promise(r => setTimeout(r, 300));
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));

      // 9. 返回结果
      // 优先用 URL（不需要本地存储）
      const resultUrl = cdpUrl || networkUrl;
      if (resultUrl) {
        try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (_) {}
        console.log(`${LOG} 成功获取 URL: ${resultUrl.substring(0, 80)}...`);
        return resultUrl;
      }

      // 如果文件已下载到本地，缓存到 media-cache
      if (downloadedFile && fs.existsSync(downloadedFile)) {
        const ext = path.extname(downloadedFile) || '.mp4';
        const cacheFileName = `hd-video-${Date.now()}${ext}`;
        const cachePath = path.join(MEDIA_CACHE_DIR, cacheFileName);
        fs.copyFileSync(downloadedFile, cachePath);
        try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (_) {}
        const localUrl = `/api/media/jimeng/local/${encodeURIComponent(cacheFileName)}`;
        console.log(`${LOG} 文件已缓存: ${localUrl}`);
        return localUrl;
      }

      // 全部失败
      try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (_) {}
      console.warn(`${LOG} 所有策略均失败`);
      return null;
    } catch (e) {
      // 清理
      if (networkHandler) try { page.off('response', networkHandler); } catch (_) {}
      if (cdp) {
        try { await cdp.send('Page.setDownloadBehavior', { behavior: 'default' }); } catch (_) {}
        try { await cdp.detach(); } catch (_) {}
      }
      if (downloadDir) try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (_) {}
      try { await page.keyboard.press('Escape'); } catch (_) {}
      console.warn(`${LOG} 错误: ${e.message}`);
      return null;
    }
  }

  /**
   * 按需下载原始品质视频（复用 _getHDVideoUrl 的弹窗逻辑）
   * @param {string} taskId - data-lo-task 标记 ID
   * @returns {string} 原始品质视频下载 URL
   */
  async downloadHDVideo(page, taskId) {
    console.log(`[Jimeng-RPA] downloadHDVideo: taskId=${taskId}`);
    const hdUrl = await this._getHDVideoUrl(page, 0, taskId);
    if (!hdUrl) {
      throw new Error('downloadHDVideo: 获取 HD 视频失败');
    }
    return hdUrl;
  }

  // ────────────────────────────────────────────────────
  // 辅助方法 — DOM 操作
  // ────────────────────────────────────────────────────

  async _typeInElement(page, selector, text) {
    const el = await page.waitForSelector(selector, { timeout: 10000 });
    await el.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, { delay: 30 });
  }

  async _uploadFile(page, fileInputSelector, base64Data, mimeType = 'image/png') {
    const ext = mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.bin';
    const tmpPath = path.join(os.tmpdir(), `jimeng-upload-${Date.now()}${ext}`);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tmpPath, buffer);
    console.log(`[Jimeng-RPA] 临时文件: ${tmpPath}, 大小: ${buffer.length} bytes`);

    try {
      const fileInputs = await page.$$(fileInputSelector);
      const fileInput = fileInputs[fileInputs.length - 1] || await page.waitForSelector(fileInputSelector, { timeout: 10000 });
      console.log(`[Jimeng-RPA] 找到 ${fileInputs.length} 个 file input，使用第 ${fileInputs.length} 个`);
      await fileInput.uploadFile(tmpPath);
      console.log(`[Jimeng-RPA] uploadFile 完成，等待 3s 渲染...`);
      await new Promise(r => setTimeout(r, 3000));
      const imgCount = await page.evaluate(() => {
        const refs = document.querySelectorAll('[class*=reference-group]:not([class*=collapsed]) img');
        return refs.length;
      });
      console.log(`[Jimeng-RPA] 当前页面参考图数量: ${imgCount}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  async _clickButtonByText(page, text, timeout = 10000) {
    const btn = await page.waitForFunction(
      (btnText) => {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          if (b.textContent?.trim().includes(btnText)) return b;
        }
        return null;
      },
      { timeout },
      text
    );
    if (btn) {
      await btn.click();
    } else {
      throw new Error(`找不到包含 "${text}" 的按钮`);
    }
  }

  // ────────────────────────────────────────────────────
  // CDP Screencast — 远程浏览器画面推送
  // ────────────────────────────────────────────────────

  /**
   * 开始向 WebSocket 推送浏览器画面
   */
  async startScreencast(session) {
    if (session.screencastActive) return;
    if (!session.page) return;

    try {
      const cdp = await session.page.createCDPSession();
      session.cdpSession = cdp;

      cdp.on('Page.screencastFrame', (frame) => {
        cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
        if (session.wsClient?.readyState === WebSocket.OPEN) {
          session.wsClient.send(JSON.stringify({ type: 'frame', data: frame.data }));
        }
      });

      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 50,
        maxWidth: 1280,
        maxHeight: 900,
        everyNthFrame: 1,
      });

      session.screencastActive = true;
      console.log(`[Jimeng-RPA] 用户 ${session.userId} screencast 已启动`);
    } catch (e) {
      console.error(`[Jimeng-RPA] 用户 ${session.userId} 启动 screencast 失败:`, e.message);
    }
  }

  /**
   * 停止 screencast
   */
  async stopScreencast(session) {
    if (!session.screencastActive || !session.cdpSession) return;
    try {
      await session.cdpSession.send('Page.stopScreencast');
      await session.cdpSession.detach();
    } catch (_) {}
    session.cdpSession = null;
    session.screencastActive = false;
    console.log(`[Jimeng-RPA] 用户 ${session.userId} screencast 已停止`);
  }

  /**
   * 切换 Screencast 到指定 tab
   * @param {number} tabIndex - -1=主页, 0+=worker 页
   */
  async switchScreencastTab(session, tabIndex) {
    // 停止当前 screencast
    await this.stopScreencast(session);

    // 确定目标 page
    let targetPage;
    if (tabIndex < 0) {
      targetPage = session.page;
    } else {
      const slot = session.workerPages[tabIndex];
      if (!slot?.page || !slot.ready) {
        console.warn(`[Jimeng-RPA] Worker page ${tabIndex} not available, falling back to primary`);
        tabIndex = -1;
        targetPage = session.page;
      } else {
        targetPage = slot.page;
      }
    }

    session.viewingTabIndex = tabIndex;

    // 在目标 page 上启动 screencast
    if (targetPage) {
      try {
        // 把目标页面设为活动页面，确保合成器产帧
        await targetPage.bringToFront();
        const cdp = await targetPage.createCDPSession();
        session.cdpSession = cdp;

        cdp.on('Page.screencastFrame', (frame) => {
          cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
          if (session.wsClient?.readyState === WebSocket.OPEN) {
            session.wsClient.send(JSON.stringify({ type: 'frame', data: frame.data }));
          }
        });

        await cdp.send('Page.startScreencast', {
          format: 'jpeg', quality: 50, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1,
        });

        session.screencastActive = true;
      } catch (e) {
        console.error(`[Jimeng-RPA] switchScreencastTab failed:`, e.message);
      }
    }

    // 通知前端
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({
        type: 'tab_switched',
        tabIndex,
        workerStatus: this._getWorkerStatus(session),
      }));
    }

    return true;
  }

  // ────────────────────────────────────────────────────
  // Worker Pool 状态
  // ────────────────────────────────────────────────────

  /**
   * 获取 worker pool 状态
   */
  _getWorkerStatus(session) {
    return {
      maxPages: session.maxPages,
      workers: session.workerPages.map((slot, i) => ({
        index: i,
        busy: slot.busy,
        ready: slot.ready,
        currentTaskId: slot.currentTaskId,
        currentTaskType: slot.currentTaskType,
        progress: slot.currentProgress,
      })),
      queueLength: session.taskQueue.length,
      viewingTabIndex: session.viewingTabIndex,
    };
  }

  /**
   * 通过 WebSocket 推送 worker 状态给前端
   */
  _sendWorkerStatusUpdate(session) {
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({
        type: 'worker_status',
        ...this._getWorkerStatus(session),
      }));
    }
  }

  /**
   * 关闭指定 worker tab（用户手动干预）
   * - 取消当前任务（如果在跑）
   * - 关闭 puppeteer page → page.on('close') 会把 slot 标为 not ready
   * - 下一轮 _processQueue 会自动创建新的 worker page 替换这个槽位
   */
  async closeWorkerPage(userId, index) {
    const session = this.userSessions.get(userId);
    if (!session) return { ok: false, error: 'no session' };
    const slot = session.workerPages[index];
    if (!slot) return { ok: false, error: 'no slot' };

    // 取消正在跑的任务
    if (slot.currentTaskId) {
      const task = session.tasks.get(slot.currentTaskId) || this.allTasks.get(slot.currentTaskId);
      if (task) {
        task.cancelled = true;
        task.status = 'failed';
        task.error = '用户手动关闭 worker tab';
      }
    }

    try { await slot.page.close(); } catch (_) {}
    slot.ready = false;
    slot.busy = false;
    slot.currentTaskId = null;
    slot.currentTaskType = null;
    slot.currentProgress = null;
    console.log(`[Jimeng-RPA] 用户 ${userId} 手动关闭 worker #${index}`);
    this._sendWorkerStatusUpdate(session);
    return { ok: true };
  }

  async createManualWorkerPage(userId) {
    const session = this.userSessions.get(userId);
    if (!session) throw new Error('会话不存在');
    if (session.workerPages.length >= session.maxPages) {
      throw new Error(`已达上限 ${session.maxPages}`);
    }
    const slot = await this._createWorkerPage(session);
    const urls = session.urls || getUrlsForUser(userId);
    try {
      await slot.page.goto(urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {}
    slot.ready = true;
    this._sendWorkerStatusUpdate(session);
    return { ok: true, index: slot.index };
  }

  /**
   * 设置最大并行页面数
   */
  setMaxPages(userId, maxPages) {
    const session = this.userSessions.get(userId);
    if (!session) throw new Error('会话不存在');

    const clamped = Math.max(1, Math.min(8, maxPages));
    session.maxPages = clamped;
    console.log(`[Jimeng-RPA] User ${userId} maxPages set to ${clamped}`);
    return { maxPages: clamped };
  }

  // ────────────────────────────────────────────────────
  // CDP Input — 中转用户鼠标/键盘操作
  // ────────────────────────────────────────────────────

  /**
   * 处理前端发来的输入事件
   */
  async handleInput(session, msg) {
    // RPA 执行任务时锁定输入，避免干扰自动化
    if (!session.cdpSession || session.viewedPageSetupInProgress) return;

    const cdp = session.cdpSession;
    session.touch();

    try {
      switch (msg.type) {
        case 'mousemove':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: msg.x, y: msg.y, button: 'none',
          });
          break;
        case 'mousedown':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: msg.x, y: msg.y,
            button: msg.button || 'left', clickCount: 1,
          });
          break;
        case 'mouseup':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: msg.x, y: msg.y,
            button: msg.button || 'left', clickCount: 1,
          });
          break;
        case 'click':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: msg.x, y: msg.y,
            button: 'left', clickCount: 1,
          });
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: msg.x, y: msg.y,
            button: 'left', clickCount: 1,
          });
          break;
        case 'wheel':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: msg.x, y: msg.y,
            deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0,
          });
          break;
        case 'keydown':
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: msg.key, code: msg.code,
            text: msg.text || '',
            windowsVirtualKeyCode: msg.keyCode || 0,
            nativeVirtualKeyCode: msg.keyCode || 0,
          });
          break;
        case 'keyup':
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: msg.key, code: msg.code,
            windowsVirtualKeyCode: msg.keyCode || 0,
            nativeVirtualKeyCode: msg.keyCode || 0,
          });
          break;
        case 'char':
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'char', text: msg.text,
          });
          break;
        case 'paste':
          // 把用户系统剪贴板的文本直接灌进当前焦点元素（绕过键盘事件，中文也可以）
          if (msg.text) {
            await cdp.send('Input.insertText', { text: msg.text });
          }
          break;
      }
    } catch (e) {
      // 忽略输入错误（页面可能正在导航）
    }
  }

  // ────────────────────────────────────────────────────
  // 空闲清理
  // ────────────────────────────────────────────────────

  /**
   * 空闲计时器（已禁用）
   * 用户要求：软件不关就不要断即梦/Dreamina 会话。
   * 退出软件时 close() 会统一清理。
   */
  _startIdleTimer(session) {
    if (session.idleTimer) { clearInterval(session.idleTimer); session.idleTimer = null; }
  }
}

module.exports = JimengRPA;
