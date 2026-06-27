# LOStudio 完全本地化计划

## 目标
打开 LOStudio 即可使用，无需登录、VIP、升级、联网验证。

## 当前状态（2026-05-23）
- Fork 项目 `F:\swarm-ide\backend\LOStudio-Fork\` 有完整 node_modules，可作为独立 Web 服务器运行
- 已安装 LOStudio v4.7.5 Electron 应用（`C:\Users\LENOVO\AppData\Local\Programs\LOStudio\`）
- 已禁用 auto-updater（app-update.yml URL 改为无效）
- 前端编译后为 `index-z0ISuRAp.js`（2.98MB，字符串混淆）
- 前端检查 `localStorage.getItem('aluo_auth_token')` 判断登录状态
- 前端 `Ue() === "local"` 时走 credits 模式，跳过 token 验证

## 架构问题
LOStudio Electron 的启动流程：
1. `electron-main.js` 启动
2. 以 `NODE_PATH=app.asar/node_modules` + `LOCAL_MODE=1` 环境 spawn `server.js`
3. `server.js` 失败（asar 内依赖无法被外部 Node.js 访问）→ 退出
4. 主窗口加载 `http://localhost:3456` → 失败 → 应用退出

**根因**：server.js 的依赖在 `app.asar/node_modules/` 里，但 Electron 以 `ELECTRON_RUN_AS_NODE=1` 启动的子进程虽然有 `NODE_PATH` 指向 asar 内的 node_modules，但部分 C++ 模块（better-sqlite3、puppeteer）需要 unpacked 才能正常工作。

## 实施步骤

### Sprint 1: Fork 端完整 Mock（已完成 80%）

**目标**：让 `LOStudio-Fork` 服务器 + 前端能独立工作

- [x] Mock `/api/auth/me`、`/api/auth/login`、`/api/auth/register`
- [x] Mock `/api/sync/pull`、`/api/sync/push`
- [x] 修复 `index.html` 注入 `aluo_auth_token` + `aluo_api_mode=local`
- [x] 补全 `/api/credits/balance`、`/api/credits/deduct`、`/api/purchase/submit` 等端点
- [ ] **浏览器测试**：用 Playwright/手动打开 `http://localhost:3456` 验证能否进入主界面
- [ ] 补全其他缺失端点（`/api/upload`、`/api/media/*`、代理路由等）

### Sprint 2: Electron 应用修复

**目标**：让 `LOStudio.exe` 能正常启动

方案 A（推荐）：修改 `electron-main.js` 的 spawn 参数
- 把 `NODE_PATH` 改为 `app.asar.unpacked/node_modules`（需要把所有依赖 unpack）
- 或修改 server.js 的 require 路径，LOCAL_MODE 下不加载 auth.js/jimeng-rpa.js

方案 B：用 Fork 替换 asar 中的 server.js
- 将 `LOStudio-Fork/server.js` + `node_modules/` 复制到 `app.asar.unpacked/`
- 修改 `electron-main.js` 的 spawn 路径指向 unpacked 目录

方案 C（最简）：electron-main.js 直接跳过 spawn server.js
- 在 LOCAL_MODE 下不 spawn server.js
- 改为在 Electron 内部起一个 express 服务（需要把依赖打包进 electron-main.js）

### Sprint 3: 前端登录/VIP 页面移除（可选）

**目标**：彻底移除登录/VIP UI

如果 Sprint 1 的自动登录 token 注入能跳过登录页，则此步可跳过。
如果不能，需要反编译前端 JS，移除登录页面组件。

## 当前优先级
先完成 Sprint 1 的浏览器测试，确认前端能否正常渲染主界面。
