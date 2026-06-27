/**
 * Electron 主进程
 *
 * 职责:
 * 1. fork server.js 在本地运行 Express 后端
 * 2. 创建 BrowserWindow 加载前端
 * 3. 管理应用生命周期
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, net: electronNet } = require('electron');
// electron-updater 延迟加载（模块加载时会调用 app.getVersion()，必须在 app ready 后 require）
let autoUpdater = null;
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

// ============================================================================
// 防止 EPIPE 错误弹窗（dev 模式管道断裂）
// ============================================================================
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return; // 忽略管道错误
  // 其他未捕获异常仍然抛出
  console.error?.('Uncaught:', err);
});

// ============================================================================
// 日志（写入 userData 目录，方便排查问题）
// ============================================================================

let logFile = null;
function initLog() {
  try {
    const logPath = path.join(app.getPath('userData'), 'lo-studio.log');
    logFile = fs.createWriteStream(logPath, { flags: 'w' });
  } catch (e) { /* ignore */ }
}
function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try { console.log(msg); } catch (_) { /* EPIPE safe */ }
  if (logFile) try { logFile.write(msg + '\n'); } catch (_) { /* ignore */ }
}

// ============================================================================
// 配置
// ============================================================================

const DEFAULT_PORT = 3456;
const MIN_WIDTH = 1600;
const MIN_HEIGHT = 1000;

let mainWindow = null;
let confirmedQuit = false;
let serverProcess = null;
let serverPort = DEFAULT_PORT;
let claudeBridgeProcess = null;
const CLAUDE_BRIDGE_PORT = 5055;

// ============================================================================
// 单实例锁
// ============================================================================

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ============================================================================
// 端口检测
// ============================================================================

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  return startPort; // fallback
}

// ============================================================================
// 持久化 JWT Secret（本地版每台机器固定一个，不会每次启动都变）
// ============================================================================

function getLocalJwtSecret() {
  const secretFile = path.join(app.getPath('userData'), 'jwt-secret');
  try {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  } catch (_) {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, secret, 'utf-8');
    return secret;
  }
}

// ============================================================================
// 服务器管理
// ============================================================================

function getServerPath() {
  if (app.isPackaged) {
    // asar 模式：server.js 在 asarUnpack 中，位于 app.asar.unpacked/
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js');
  }
  return path.join(__dirname, 'server.js');
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const userDataPath = app.getPath('userData');
    const serverPath = getServerPath();

    log('Starting server:', serverPath, 'port:', port, 'userData:', userDataPath);

    // NODE_PATH: server.js 在 app.asar.unpacked/ 但依赖在 app.asar/node_modules/
    const asarModules = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'node_modules')
      : '';

    // STATIC_DIR: dist/ 在 app.asar 内，server.js 需要知道完整路径
    const staticDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'dist')
      : '';

    log('execPath:', process.execPath);
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(port),
        USER_DATA_PATH: userDataPath,
        NODE_PATH: asarModules,
        JWT_SECRET: getLocalJwtSecret(),
        LOCAL_MODE: '1',
        ...(staticDir ? { STATIC_DIR: staticDir } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      log('[server]', msg.trim());
      if (msg.includes('listening') || msg.includes(String(port))) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      log('[server:err]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      log('[server:error]', err.message);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      log('[server:exit] code:', code);
    });

    // 超时兜底：5 秒后无论如何都 resolve（服务器可能不打印 listening）
    setTimeout(resolve, 5000);
  });
}

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ============================================================================
// Claude Bridge 管理
// ============================================================================

function getClaudeBridgePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'claude-bridge.js');
  }
  return path.join(__dirname, 'claude-bridge.js');
}

function startClaudeBridge() {
  const bridgePath = getClaudeBridgePath();
  const userDataPath = app.getPath('userData');

  log('Starting Claude Bridge:', bridgePath, 'port:', CLAUDE_BRIDGE_PORT);

  const asarModules = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'node_modules')
    : '';

  claudeBridgeProcess = spawn(process.execPath, [bridgePath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_BRIDGE_PORT: String(CLAUDE_BRIDGE_PORT),
      USER_DATA_PATH: userDataPath,
      NODE_PATH: asarModules,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  claudeBridgeProcess.stdout.on('data', (data) => {
    log('[bridge]', data.toString().trim());
  });

  claudeBridgeProcess.stderr.on('data', (data) => {
    log('[bridge:err]', data.toString().trim());
  });

  claudeBridgeProcess.on('error', (err) => {
    log('[bridge:error]', err.message);
  });

  claudeBridgeProcess.on('exit', (code) => {
    log('[bridge:exit] code:', code);
  });
}

function killClaudeBridge() {
  if (claudeBridgeProcess) {
    claudeBridgeProcess.kill();
    claudeBridgeProcess = null;
  }
}


// ============================================================================
// 窗口创建
// ============================================================================

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'LOStudio',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'icon.png')
      : path.join(__dirname, 'public', 'icon.png'),
    backgroundColor: '#020005',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 开发模式 → Vite HMR；生产模式 → 本地 Express
  const isDev = !app.isPackaged;
  const url = isDev
    ? 'http://localhost:5173'
    : `http://localhost:${serverPort}`;

  // 开发模式自动打开 DevTools
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.loadURL(url);

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http') && !linkUrl.includes('localhost')) {
      shell.openExternal(linkUrl);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 加载失败时显示错误信息
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log('[window] did-fail-load:', code, desc);
    mainWindow.loadURL(`data:text/html,<h2 style="color:#fff;font-family:sans-serif;padding:40px">Server failed to start (${code})<br><small>${desc}</small></h2>`);
  });

  mainWindow.on('close', (e) => {
    if (confirmedQuit) return;
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-close-confirm');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── 自动更新（仅打包版，开发模式跳过）──
  if (app.isPackaged) {
    try {
    autoUpdater = require('electron-updater').autoUpdater;
    log('[updater] electron-updater 加载成功');
    autoUpdater.autoDownload = false;         // 手动控制下载时机
    autoUpdater.autoInstallOnAppQuit = true;

    let updateVersion = '';
    let isStartupCheck = true;               // 启动时强制更新，运行中让用户选择

    autoUpdater.on('update-available', (info) => {
      updateVersion = info.version;
      if (isStartupCheck) {
        // 启动时 → 强制下载，不给选择
        log('[updater] 启动检测到新版本:', updateVersion, '→ 强制下载');
        autoUpdater.downloadUpdate();
        if (mainWindow) {
          mainWindow.webContents.send('update-downloading', { version: updateVersion, progress: 0 });
        }
      } else {
        // 运行中 → 让用户选择
        log('[updater] 运行中发现新版本:', updateVersion, '→ 等待用户确认');
        if (mainWindow) {
          mainWindow.webContents.send('update-available-prompt', { version: updateVersion });
        }
      }
    });

    autoUpdater.on('download-progress', (p) => {
      const pct = Math.round(p.percent);
      log(`[updater] 下载进度: ${pct}%`);
      if (mainWindow) {
        mainWindow.webContents.send('update-downloading', { version: updateVersion, progress: pct });
      }
    });

    autoUpdater.on('update-downloaded', () => {
      log('[updater] 新版本已下载完成');
      if (mainWindow) {
        mainWindow.webContents.send('update-ready', { version: updateVersion });
      }
    });

    autoUpdater.on('error', (err) => {
      log('[updater] 更新失败:', err.message);
      if (mainWindow) {
        mainWindow.webContents.send('update-error', err.message);
      }
    });

    // 渲染进程请求重启安装
    ipcMain.on('restart-for-update', () => {
      log('[updater] 用户请求重启安装');
      confirmedQuit = true;
      autoUpdater.quitAndInstall();
    });

    // 渲染进程请求开始下载（用户选了"立即更新"）
    ipcMain.on('start-update-download', () => {
      log('[updater] 用户选择立即更新，开始下载');
      autoUpdater.downloadUpdate();
      if (mainWindow) {
        mainWindow.webContents.send('update-downloading', { version: updateVersion, progress: 0 });
      }
    });

    // 启动 5 秒后检查（强制） + 每 30 分钟定时检查（用户选择）
    const checkForUpdates = () => autoUpdater.checkForUpdates().catch(e => log('[updater]', e.message));
    setTimeout(() => {
      checkForUpdates();
      // 首次检查完成后切换为非启动模式（延迟 30s 确保首次检查完成）
      setTimeout(() => { isStartupCheck = false; }, 30000);
    }, 5000);
    setInterval(checkForUpdates, 30 * 60 * 1000);
    } catch (updaterErr) {
      log('[updater] 加载失败:', updaterErr.message);
    }
  }
}

// ============================================================================
// 机器 ID (首次启动生成 UUID，持久存储)
// ============================================================================

let machineId = '';
let machineName = '';

function initMachineId() {
  const userDataPath = app.getPath('userData');
  const idFile = path.join(userDataPath, 'machine-id');
  try {
    machineId = fs.readFileSync(idFile, 'utf-8').trim();
  } catch (_) {
    machineId = crypto.randomUUID();
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(idFile, machineId, 'utf-8');
  }
  machineName = os.hostname();
  log('Machine ID:', machineId, 'Name:', machineName);
}

// IPC: 渲染进程获取机器信息
ipcMain.on('close-confirm-response', (_e, confirmed) => {
  if (!confirmed) return;
  confirmedQuit = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('get-machine-id', () => machineId);
ipcMain.handle('get-machine-name', () => machineName);

// IPC: 选择输出文件夹
ipcMain.handle('select-output-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: '选择输出文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// IPC: 获取默认下载路径
ipcMain.handle('get-downloads-path', () => {
  return app.getPath('downloads');
});

// IPC: 保存文件到磁盘（批量下载用，静默写入，不弹对话框）
ipcMain.handle('save-file-to-disk', async (_event, { dirPath, fileName, base64Data }) => {
  try {
    if (!dirPath || !fileName || !base64Data) return { ok: false, error: '参数不完整' };
    // 清理文件名非法字符
    const safeName = String(fileName).replace(/[\\/:*?"<>|]/g, '_');
    // 确保目录存在
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    const fullPath = path.join(dirPath, safeName);
    // 解析 data URI 或纯 base64
    const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(fullPath, buffer);
    return { ok: true, path: fullPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// IPC: 用系统文件管理器打开文件夹
ipcMain.handle('open-folder-path', async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: '路径为空' };
    if (!fs.existsSync(dirPath)) return { ok: false, error: '路径不存在' };
    const result = await shell.openPath(dirPath);
    if (result) return { ok: false, error: result };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Grok RPA: 隐藏 BrowserWindow 操控 Grok 页面生成视频 ───
let grokWindow = null;
let grokReady = false;
let grokInitPromise = null;

// ─── Grok 任务队列（类似即梦排队机制）───
const grokTasks = new Map();       // taskId → task object
const grokTaskQueue = [];          // 待处理的 taskId 队列
let grokProcessing = false;        // 是否正在处理任务

function grokEnqueueTask(cookie, body) {
  const taskId = `grok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id: taskId,
    status: 'queued',      // queued | running | completed | failed
    progress: 0,
    result: null,           // { videoUrl }
    error: null,
    cookie,
    body,
    createdAt: Date.now(),
  };
  grokTasks.set(taskId, task);
  grokTaskQueue.push(taskId);
  log('[Grok Queue] 入队:', taskId, '队列长度:', grokTaskQueue.length);
  // 异步触发处理（不阻塞返回）
  setImmediate(() => grokProcessQueue());
  return taskId;
}

function grokGetTaskStatus(taskId) {
  const task = grokTasks.get(taskId);
  if (!task) return null;
  const queuePos = grokTaskQueue.indexOf(taskId);
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    result: task.result,
    error: task.error,
    queuePosition: queuePos >= 0 ? queuePos : undefined,
  };
}

async function grokProcessQueue() {
  if (grokProcessing) return;
  if (grokTaskQueue.length === 0) return;
  grokProcessing = true;

  while (grokTaskQueue.length > 0) {
    const taskId = grokTaskQueue.shift();
    const task = grokTasks.get(taskId);
    if (!task || task.status === 'failed') continue;

    task.status = 'running';
    log('[Grok Queue] 开始处理:', taskId);

    try {
      const result = await grokExecuteTask(task);
      task.status = 'completed';
      task.result = result;
      task.progress = 100;
      log('[Grok Queue] 完成:', taskId);
    } catch (e) {
      task.status = 'failed';
      task.error = e.message;
      log('[Grok Queue] 失败:', taskId, e.message);
    }

    // 短暂间隔再处理下一个
    if (grokTaskQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  grokProcessing = false;
}

// 清理超过 30 分钟的旧任务
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, task] of grokTasks) {
    if (task.createdAt < cutoff && (task.status === 'completed' || task.status === 'failed')) {
      grokTasks.delete(id);
    }
  }
}, 5 * 60 * 1000);

async function ensureGrokWindow(ssoCookie) {
  if (grokWindow && !grokWindow.isDestroyed() && grokReady) return grokWindow;
  if (grokInitPromise) {
    await grokInitPromise;
    if (grokWindow && !grokWindow.isDestroyed() && grokReady) return grokWindow;
    throw new Error('[Grok] 初始化失败');
  }

  grokInitPromise = (async () => {
    try {
      log('[Grok] 启动浏览器窗口...');
      const { session } = require('electron');
      const grokSession = session.fromPartition('persist:grok');

      // 注入关键 cookie
      const essentialCookies = ['sso', 'sso-rw', 'x-userid'];
      if (ssoCookie) {
        const pairs = ssoCookie.split(';').map(c => c.trim()).filter(Boolean);
        for (const pair of pairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx < 0) continue;
          const name = pair.substring(0, eqIdx).trim();
          const value = pair.substring(eqIdx + 1).trim();
          if (!essentialCookies.includes(name)) continue;
          try {
            await grokSession.cookies.set({ url: 'https://grok.com', name, value, domain: '.grok.com', path: '/', secure: true });
            log('[Grok] Cookie 注入:', name);
          } catch (e) { log('[Grok] Cookie 失败:', name, e.message); }
        }
      }

      grokWindow = new BrowserWindow({
        width: 900, height: 700, show: false,
        webPreferences: { session: grokSession, nodeIntegration: false, contextIsolation: true },
      });
      grokWindow.webContents.setAudioMuted(true);

      log('[Grok] 导航到 grok.com/imagine...');
      await grokWindow.loadURL('https://grok.com/imagine');
      // 等 Cloudflare
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const title = grokWindow.getTitle();
        log('[Grok] 标题:', title);
        if (title && !title.includes('請稍候') && !title.includes('请稍候') && !title.toLowerCase().includes('just a moment') && !title.toLowerCase().includes('cloudflare')) break;
      }
      log('[Grok] 页面就绪');
      grokReady = true;

      grokWindow.on('closed', () => { grokWindow = null; grokReady = false; grokInitPromise = null; });
    } catch (e) {
      log('[Grok] 初始化失败:', e.message);
      if (grokWindow && !grokWindow.isDestroyed()) grokWindow.close();
      grokWindow = null; grokReady = false;
      throw e;
    } finally {
      grokInitPromise = null;
    }
  })();

  await grokInitPromise;
  return grokWindow;
}

// 实际执行 Grok RPA 任务（队列逐个调用）
async function grokExecuteTask(task) {
  const cookie = task.cookie;
  const body = task.body;
  const prompt = body?.message || 'test';
  const images = body?.images || [];
  const resolution = body?.resolution || '480p';   // '480p' | '720p'
  const duration = body?.duration || '6s';          // '6s' | '10s'
  const aspectRatio = body?.aspectRatio || '16:9';  // '16:9' | '9:16'

  const win = await ensureGrokWindow(cookie);
  const wc = win.webContents;

  log('[Grok RPA] 执行任务:', task.id, 'prompt:', prompt, 'images:', images.length, 'resolution:', resolution, 'duration:', duration, 'ratio:', aspectRatio);

  // 先导航到 /imagine 确保在正确页面（每次新对话）
  await win.loadURL('https://grok.com/imagine');
  await new Promise(r => setTimeout(r, 2000));

  // 注入 fetch 拦截器，捕获视频生成的流式响应
  await wc.executeJavaScript(`
    (function() {
      window._grokVideoResult = null;
      window._grokVideoProgress = 0;
      window._grokVideoError = null;
      window._grokVideoDone = false;

      const origFetch = window._origFetch || window.fetch;
      window._origFetch = origFetch;
      window.fetch = function(url, opts) {
        const promise = origFetch.apply(this, arguments);
        // 拦截 conversations/new 的响应
        if (typeof url === 'string' && url.includes('conversations/new') && opts?.method === 'POST') {
          promise.then(async resp => {
            try {
              const clone = resp.clone();
              const reader = clone.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                // 解析 NDJSON
                const lines = buffer.split('\\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const chunk = JSON.parse(line);
                    const svgr = chunk?.result?.response?.streamingVideoGenerationResponse;
                    if (svgr) {
                      window._grokVideoProgress = svgr.progress || 0;
                      if (svgr.progress === 100 && svgr.videoUrl) {
                        window._grokVideoResult = svgr.videoUrl;
                        window._grokVideoDone = true;
                      }
                      if (svgr.moderated && svgr.progress === 100 && !svgr.videoUrl) {
                        window._grokVideoError = '内容被审核拦截';
                        window._grokVideoDone = true;
                      }
                    }
                    const errMsg = chunk?.result?.response?.modelResponse?.streamErrors;
                    if (errMsg && errMsg.length > 0) {
                      window._grokVideoError = JSON.stringify(errMsg);
                      window._grokVideoDone = true;
                    }
                  } catch {}
                }
              }
              if (!window._grokVideoDone) {
                // 处理 buffer 残留
                if (buffer.trim()) {
                  try {
                    const chunk = JSON.parse(buffer);
                    const svgr = chunk?.result?.response?.streamingVideoGenerationResponse;
                    if (svgr?.progress === 100 && svgr?.videoUrl) {
                      window._grokVideoResult = svgr.videoUrl;
                      window._grokVideoDone = true;
                    }
                  } catch {}
                }
                if (!window._grokVideoDone) {
                  window._grokVideoError = '未找到视频 URL';
                  window._grokVideoDone = true;
                }
              }
            } catch (e) {
              window._grokVideoError = e.message;
              window._grokVideoDone = true;
            }
          }).catch(e => {
            window._grokVideoError = e.message;
            window._grokVideoDone = true;
          });
        }
        return promise;
      };
    })()
  `);

  // 上传参考图（如果有）— 必须在切视频模式之前，让 Grok 有时间处理
  if (images.length > 0) {
    log('[Grok RPA] 上传参考图:', images.length, '张');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // 准备 base64 数据（不含 data: 前缀的纯 base64 + mime）
    const imageDataList = [];
    for (let i = 0; i < images.length; i++) {
      const dataUri = images[i];
      const match = dataUri.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!match) {
        log('[Grok RPA] 跳过无效图片 #' + i);
        continue;
      }
      const mimeType = 'image/' + (match[1] === 'jpg' ? 'jpeg' : match[1]);
      imageDataList.push({ base64: match[2], mimeType, name: `ref_${i}.${match[1]}` });
    }

    if (imageDataList.length > 0) {
      // 一张一张上传，确保顺序正确
      try {
        for (let fi = 0; fi < imageDataList.length; fi++) {
          const img = imageDataList[fi];
          const tmpPath = path.join(os.tmpdir(), `grok_ref_${Date.now()}_${img.name}`);
          fs.writeFileSync(tmpPath, Buffer.from(img.base64, 'base64'));
          log('[Grok RPA] 上传第', fi + 1, '张:', tmpPath);

          // 每次重新查找 file input（上传后 DOM 可能变化）
          wc.debugger.attach('1.3');
          const doc = await wc.debugger.sendCommand('DOM.getDocument');
          const inputNode = await wc.debugger.sendCommand('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: 'input[type="file"]',
          });
          if (inputNode.nodeId) {
            await wc.debugger.sendCommand('DOM.setFileInputFiles', {
              nodeId: inputNode.nodeId,
              files: [tmpPath.replace(/\\/g, '/')],
            });
            log('[Grok RPA] 第', fi + 1, '张上传完成');
          }
          wc.debugger.detach();

          // 等 Grok 处理这张图片
          await new Promise(r => setTimeout(r, 2000));

          // 清理临时文件
          try { fs.unlinkSync(tmpPath); } catch {}
        }
        // 额外等待确保全部处理完
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        log('[Grok RPA] 图片上传失败:', e.message);
        try { wc.debugger.detach(); } catch {}
      }
    }
  }

  // 用 Electron 原生键盘输入（更像真实用户）
  // 先点击输入框获得焦点
  await wc.executeJavaScript(`
    (function() {
      const input = document.querySelector('textarea, div[contenteditable="true"]');
      if (input) { input.focus(); input.click(); }
      return !!input;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  // 点击 "影片" 模式切换按钮（放在图片上传之后）
  await wc.executeJavaScript(`
    (function() {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === '影片' || text === 'Video' || text === '视频') {
          btn.click();
          break;
        }
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  // 点击分辨率按钮 (480p / 720p)
  log('[Grok RPA] 设置分辨率:', resolution);
  await wc.executeJavaScript(`
    (function() {
      const target = '${resolution}';
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent.trim() === target) { btn.click(); return true; }
      }
      return false;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  // 点击秒数按钮 (6s / 10s)
  log('[Grok RPA] 设置秒数:', duration);
  await wc.executeJavaScript(`
    (function() {
      const target = '${duration}';
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent.trim() === target) { btn.click(); return true; }
      }
      return false;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  // 选择尺寸 (最后设置，确保 DOM 稳定; Grok 会记住上次选择所以每次都要设)
  log('[Grok RPA] 设置尺寸:', aspectRatio);
  const ratioOpenResult = await wc.executeJavaScript(`
    (function() {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const t = btn.textContent.trim();
        if (/^\\d+:\\d+$/.test(t)) {
          const rect = btn.getBoundingClientRect();
          return { ok: true, text: t, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return { ok: false };
    })()
  `);
  log('[Grok RPA] 当前尺寸:', ratioOpenResult.ok ? ratioOpenResult.text : '未找到');
  if (ratioOpenResult.ok) {
    if (ratioOpenResult.text === aspectRatio) {
      log('[Grok RPA] 尺寸已是', aspectRatio, '跳过');
    } else {
      wc.sendInputEvent({ type: 'mouseDown', x: Math.round(ratioOpenResult.x), y: Math.round(ratioOpenResult.y), button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: Math.round(ratioOpenResult.x), y: Math.round(ratioOpenResult.y), button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 1500));
      const ratioSelectResult = await wc.executeJavaScript(`
        (function() {
          const target = '${aspectRatio}';
          const all = document.querySelectorAll('*');
          for (const el of all) {
            const t = el.textContent.trim();
            if (t === target && el.children.length <= 2 && el.offsetParent !== null) {
              el.click();
              return { ok: true, text: t };
            }
          }
          return { ok: false };
        })()
      `);
      log('[Grok RPA] 尺寸已切换为', aspectRatio);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 解析 prompt 中的 @图片N 或 @N 引用（@图片1=Image 1, @1=Image 1, ...）
  const atPattern = /@(?:图片)?(\d+)/g;
  const hasAtRef = atPattern.test(prompt);
  atPattern.lastIndex = 0; // 重置

  if (hasAtRef && images.length > 0) {
    // 分段输入：文字 + @ 选择
    log('[Grok RPA] 检测到 @ 引用，分段输入...');
    let lastIndex = 0;
    let match;
    while ((match = atPattern.exec(prompt)) !== null) {
      const textBefore = prompt.substring(lastIndex, match.index);
      const imageIndex = parseInt(match[1]); // 1-based
      lastIndex = match.index + match[0].length;

      // 输入 @ 前面的文字
      if (textBefore) {
        await wc.insertText(textBefore);
        await new Promise(r => setTimeout(r, 300));
      }

      // 输入 @ 触发下拉
      await wc.insertText('@');
      await new Promise(r => setTimeout(r, 1000)); // 等下拉出现

      // 用 click 选择第 N 个图片（不用 Enter！）
      const clicked = await wc.executeJavaScript(`
        (function() {
          const targetText = 'Image ${imageIndex}';
          // 精确匹配：找文本内容恰好是 "Image N" 的最小元素（避免选到父容器）
          const allEls = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listbox"] > *, [data-radix-collection-item], li, button');
          for (const el of allEls) {
            const t = el.textContent.trim();
            if (t === targetText) {
              el.click();
              return { ok: true, text: t, exact: true };
            }
          }
          // 按索引点第 N 个选项（0-based）
          const options = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listbox"] > *');
          const idx = ${imageIndex} - 1;
          if (idx >= 0 && idx < options.length) {
            options[idx].click();
            return { ok: true, text: options[idx].textContent.trim(), byIndex: true };
          }
          return { ok: false, error: '未找到 ' + targetText + ', options: ' + options.length };
        })()
      `);
      log('[Grok RPA] @ 选择结果:', JSON.stringify(clicked));
      await new Promise(r => setTimeout(r, 500));
    }

    // 输入 @ 后面剩余的文字
    const remaining = prompt.substring(lastIndex);
    if (remaining) {
      await wc.insertText(remaining);
      await new Promise(r => setTimeout(r, 300));
    }
  } else {
    // 没有 @ 引用，直接输入
    await wc.insertText(prompt);
    await new Promise(r => setTimeout(r, 500));
  }

  // 按 Enter 提交
  await wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  await wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });

  log('[Grok RPA] 已提交，等待视频生成...');

  // 轮询等待视频生成完成（最长 5 分钟）
  const maxWait = 300000;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await wc.executeJavaScript(`
      ({ done: window._grokVideoDone, progress: window._grokVideoProgress, result: window._grokVideoResult, error: window._grokVideoError })
    `);
    // 更新任务进度（前端可以轮询看到）
    task.progress = status.progress || 0;
    log('[Grok RPA] 进度:', status.progress, '%', status.done ? '(完成)' : '');

    if (status.done) {
      if (status.error) {
        throw new Error(status.error);
      }
      if (status.result) {
        return { videoUrl: status.result };
      }
      throw new Error('视频生成完成但未找到 URL');
    }
  }

  throw new Error('视频生成超时 (5分钟)');
}

// IPC: 入队 Grok 任务 → 立即返回 taskId
ipcMain.handle('grok-fetch', async (_event, { url, method, headers, body, timeout }) => {
  try {
    const cookie = headers?.Cookie || '';
    const taskId = grokEnqueueTask(cookie, body);
    return { ok: true, status: 200, taskId };
  } catch (e) {
    log('[Grok] 入队失败:', e.message);
    return { ok: false, status: 0, error: e.message };
  }
});

// IPC: 查询 Grok 任务状态
ipcMain.handle('grok-task-status', async (_event, taskId) => {
  const status = grokGetTaskStatus(taskId);
  if (!status) return { ok: false, error: '任务不存在' };
  return { ok: true, ...status };
});

// IPC: 通过 Grok session 下载视频，返回 base64
ipcMain.handle('grok-download', async (_event, videoUrl) => {
  try {
    const { session } = require('electron');
    const grokSession = session.fromPartition('persist:grok');
    log('[Grok] 下载视频:', videoUrl);
    const resp = await grokSession.fetch(videoUrl);
    if (!resp.ok) {
      // fallback: 用 executeJavaScript 从 Grok 页面下载
      if (grokWindow && !grokWindow.isDestroyed()) {
        log('[Grok] session.fetch 失败，尝试从页面下载...');
        const base64 = await grokWindow.webContents.executeJavaScript(`
          fetch(${JSON.stringify(videoUrl)}, { credentials: 'same-origin' })
            .then(r => r.blob())
            .then(blob => new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }))
        `);
        log('[Grok] 页面下载成功, 大小:', base64?.length || 0);
        return { ok: true, base64 };
      }
      return { ok: false, error: `下载失败: ${resp.status}` };
    }
    const buffer = await resp.arrayBuffer();
    const base64 = 'data:video/mp4;base64,' + Buffer.from(buffer).toString('base64');
    log('[Grok] 下载成功, 大小:', base64.length);
    return { ok: true, base64 };
  } catch (e) {
    log('[Grok] 下载失败:', e.message);
    return { ok: false, error: e.message };
  }
});

// ============================================================================
// 应用生命周期
// ============================================================================

// 启用 FaceDetector API（人脸网格画线功能需要）
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

app.whenReady().then(async () => {
  initLog();
  initMachineId();
  const isDev = !app.isPackaged;
  log('App ready. isDev:', isDev, 'resourcesPath:', process.resourcesPath);

  // 开发和生产模式都启动本地 Express 服务
  serverPort = await findFreePort(DEFAULT_PORT);
  await startServer(serverPort);

  // 启动 Claude Bridge + Gemini Bridge（洛模式用）
  startClaudeBridge();


  createWindow();
});

app.on('window-all-closed', () => {
  killServer();
  killClaudeBridge();

  app.quit();
});

app.on('before-quit', () => {
  killServer();
  killClaudeBridge();

});
