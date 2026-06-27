# LOStudio 深度逆向分析文档

> 逆向目标：C:\Users\LENOVO\AppData\Local\Programs\LOStudio
> 版本：v4.7.4
> 分析日期：2026-05-17
> 分析团队：IT主管(王总)、张伟、李娜、王磊

---

## 目录

1. [总体架构](#1-总体架构)
2. [技术栈](#2-技术栈)
3. [文件结构](#3-文件结构)
4. [核心模块分析](#4-核心模块分析)
5. [API端点全映射](#5-api端点全映射)
6. [AI模型集成](#6-ai模型集成)
7. [RPA浏览器自动化](#7-rpa浏览器自动化)
8. [认证与VIP系统](#8-认证与vip系统)
9. [前端架构](#9-前端架构)
10. [数据流分析](#10-数据流分析)
11. [安全设计](#11-安全设计)
12. [开发复刻建议](#12-开发复刻建议)

---

## 1. 总体架构

### 三进程协同模型



### 端口规划
| 服务 | 端口 | 说明 |
|------|------|------|
| Express API | 3456 (被占用时+1~+20) | 核心业务API |
| Claude Bridge | 5055 (固定) | OpenAI->Claude转换 |

### 部署模式
- **Electron打包版**: asar + asarUnpack 分离
- **Web独立模式**:  可独立运行，前端Vite dev server :5173

---

## 2. 技术栈

### 后端
| 技术 | 用途 |
|------|------|
| Express 5 | HTTP API服务 |
| better-sqlite3 | 本地数据库 (lo-studio.db, WAL模式) |
| bcryptjs + jsonwebtoken | 密码加密 + JWT认证 (90天过期) |
| puppeteer + puppeteer-core | 浏览器自动化(RPA) |
| ffmpeg-static | 视频/音频处理 |
| ws | WebSocket通信 |
| jszip | ZIP文件处理 |

### 前端
| 技术 | 用途 |
|------|------|
| React 19.2.3 | UI框架 |
| Vite 7.3.1 | 构建工具 |
| TailwindCSS | 样式框架 |
| @xyflow/react 12.0.0 | 节点流程图/无线画布 |
| lucide-react 0.563.0 | 图标库 |
| ONNX Runtime WASM+WebGPU | 本地AI推理(23MB模型) |
| @google/genai 1.38.0 | Google Gemini API |
| @imgly/background-removal | 本地背景去除 |

---

## 3. 文件结构



---

## 4. 核心模块分析

### 4.1 Electron主进程 (electron-main.js)

**职责:**
1. Fork子进程 (server.js + claude-bridge.js)
2. 创建BrowserWindow加载前端
3. 管理应用生命周期
4. IPC通信桥接
5. 自动更新
6. Grok RPA视频生成

**关键机制:**
- **单实例锁**: 防止多开，二次启动时聚焦已有窗口
- **端口自动检测**: 3456被占用时自动+1探测
- **持久化**: 每台机器固定JWT Secret + Machine ID
- **自动更新**: electron-updater，启动5秒后强制检查，之后每30分钟
- **安全**: contextIsolation=true, nodeIntegration=false

**Grok RPA视频生成:**
- 隐藏BrowserWindow操控 grok.com/imagine
- Cookie注入 (sso, sso-rw, x-userid)
- fetch拦截捕获SSE流式响应 (NDJSON格式)
- 支持图片上传(CDP调试协议)、分辨率/时长/比例设置
- 任务队列机制，串行处理，最长等待5分钟
- @图片N 引用解析 (分段输入+下拉选择)

### 4.2 Express API核心 (server.js) - 3272行

**核心功能分类:**
1. 通用HTTP请求代理: makeHttpRequest / makeFormDataRequest
2. 流式SSE代理: 直接pipe响应回客户端
3. 即梦浏览器代理: Puppeteer注入页面，绕过风控
4. AWS4签名: 即梦ImageX CDN签名 + CRC32
5. 媒体处理: 图片下载/上传/持久化缓存
6. 视频处理: 抖音解析下载 + ffmpeg压缩/裁剪/webm转mp4
7. 即梦RPA路由: 完整API控制即梦图像/视频生成
8. Midjourney代理: Bearer Token透传
9. Higgsfield集成: 浏览器代理 + 上传 + Clerk登录
10. Clerk登录: 完整OAuth流程 + 2FA支持
11. WebSocket: 即梦远程浏览器Screencast投屏

### 4.3 Claude桥接 (claude-bridge.js)

**架构:**


**关键细节:**
- 自动获取orgId
- Cloudflare Cookie自动刷新 (25分钟TTL)
- 图片支持: wiggle/upload-file 接口
- 默认模型: claude-sonnet-4-6 (响应标记为claude-opus-4-7)
- 异步删除对话记录

### 4.4 即梦RPA (jimeng-rpa.js) - 5311行

**架构:** Puppeteer多用户隔离 + Worker Pool



**支持平台:**
- 国内版: jimeng.jianying.com/ai-tool/home
- 国际版: dreamina.capcut.com/ai-tool/home

**WebSocket投屏:**
- CDP Screencast: JPEG质量50, 1280x900, 每帧必传
- 输入控制: mousePressed/mouseReleased/mouseMoved/keyDown/keyUp
- 标签页切换: 主页 <-> Worker X

---

## 5. API端点全映射

### 认证与用户管理
| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /api/auth/register | POST | 无 | 用户注册 |
| /api/auth/login | POST | 无 | 用户登录 |
| /api/auth/me | GET | JWT | 验证当前用户 |
| /api/auth/change-password | POST | JWT | 修改密码 |
| /api/sync/push | POST | JWT | 数据同步(本地->云端) |
| /api/sync/pull | GET | JWT | 数据同步(云端->本地) |
| /api/verify-key | POST | 无 | 验证VIP密钥+绑定机器 |
| /api/heartbeat | POST | 无 | VIP心跳保活 |
| /api/check-admin-key | POST | 无 | 检查管理员密钥 |
| /api/admin/keys/* | * | adminAuth | 密钥管理 |
| /api/auth/admin/users/* | * | x-admin-secret | 用户管理 |

### 即梦RPA控制
| 端点 | 方法 | 说明 |
|------|------|------|
| /api/jimeng/rpa/open-browser | POST | 打开浏览器 |
| /api/jimeng/rpa/close-browser | POST | 关闭浏览器 |
| /api/jimeng/rpa/browser-status | GET | 浏览器状态 |
| /api/jimeng/rpa/login-status | GET | 登录状态 |
| /api/jimeng/rpa/login-qr | POST | QR码登录 |
| /api/jimeng/rpa/login-poll | GET | 登录轮询 |
| /api/jimeng/rpa/generate-image | POST | 图片生成(入队) |
| /api/jimeng/rpa/generate-video | POST | 视频生成(入队) |
| /api/jimeng/rpa/task/:taskId | GET | 查询任务状态 |
| /api/jimeng/rpa/cancel-task/:nodeId | POST | 取消任务 |
| /api/jimeng/rpa/set-max-pages | POST | 设置最大并行页面数 |
| /api/jimeng/rpa/worker-status | GET | Worker池状态 |
| /api/jimeng/rpa/download-hd | POST | HD视频下载 |
| /api/jimeng/rpa/screenshot | GET | 截图调试 |
| /api/jimeng/rpa/navigate | POST | 导航+截图 |
| /api/jimeng/rpa/click | POST | 点击+截图 |
| /api/jimeng/rpa/eval | POST | 执行JS+截图 |
| /api/jimeng/rpa/dom-summary | GET | DOM摘要 |
| /api/jimeng/rpa/pages | GET | 页面列表 |
| /api/jimeng/rpa/upload | POST | 上传图片 |
| /api/jimeng/rpa/proof-upload | POST | 证明上传 |
| /api/jimeng/rpa/debug-tasks | GET | 调试任务 |

### Higgsfield AI
| 端点 | 方法 | 说明 |
|------|------|------|
| /api/higgsfield/proxy | POST | API代理 |
| /api/higgsfield/upload | POST | 图片上传(3步) |
| /api/higgsfield/clerk-login | POST | 服务端登录 |
| /api/higgsfield/browser-login | POST | 可见浏览器登录 |
| /api/higgsfield/clerk-verify | POST | 二步验证 |
| /api/higgsfield/clerk-session-import | POST | Session导入 |
| /api/higgsfield/clerk-session-export | GET | Session导出 |
| /api/higgsfield/clerk-token | GET | 获取token |
| /api/higgsfield/clerk-status | GET | 登录状态 |
| /api/higgsfield/clerk-logout | POST | 登出 |
| /api/higgsfield/token-bridge | GET | Token桥接 |
| /api/higgsfield/token-latest | GET | 最新token |
| /api/higgsfield/login-page | GET | 登录页面 |

### 媒体处理
| 端点 | 方法 | 说明 |
|------|------|------|
| /api/upload-to-uguu | POST | 上传uguu图床 |
| /api/proxy | POST | 通用HTTP代理 |
| /api/upload | POST | FormData上传 |
| /api/fetch-image | POST | 下载图片转dataURI |
| /api/fetch-buffer | POST | 下载转base64 |
| /api/download-proxy | POST | 下载代理 |
| /api/douyin/download | POST | 抖音解析下载 |
| /api/video/compress | POST | 视频压缩 |
| /api/video/trim | POST | 视频裁剪 |
| /api/video/webm-to-mp4 | POST | webm转mp4 |
| /api/audio/trim | POST | 音频裁剪 |
| /api/media/jimeng/cdn/:encoded | GET | 即梦CDN |
| /api/media/jimeng/local/:filename | GET | 本地缓存 |
| /api/media/persist | POST | 持久化媒体 |

### 其他
| 端点 | 方法 | 说明 |
|------|------|------|
| /api/midjourney/proxy | POST | MJ代理 |
| /api/machine-id | GET | 机器ID |
| /api/output/save | POST | 保存输出 |
| /api/version | GET | 版本号 |
| /api/debug-log | POST | 调试日志 |
| /api/grok/cookie | GET | Grok Cookie |
| /api/credits/balance | GET | 积分余额 |
| /api/credits/deduct | POST | 积分扣除 |
| /api/credits/refund | POST | 积分退款 |
| /api/purchase/submit | POST | 购买提交 |

### WebSocket
| 端点 | 说明 |
|------|------|
| /ws/jimeng | 即梦Screencast (JWT认证) |

### Claude Bridge (:5055)
| 端点 | 方法 | 说明 |
|------|------|------|
| / | GET | 刷新CF Cookie |
| /chat/completions | POST | OpenAI兼容接口 |

---

## 6. AI模型集成

### 6.1 Claude (网页API逆向)
- 接入方式: claude.ai网页API逆向
- 认证: sessionKey Cookie + Cloudflare绕过
- 模型: claude-sonnet-4-6 (响应标记为claude-opus-4-7)
- 成本: 免费(依赖用户订阅)

### 6.2 Google Gemini
- 接入: @google/genai SDK (v1.38.0)
- 用途: 视频反推分析
- 模型: gemini-3-pro-image-preview, gemini-3.1-flash-image-preview

### 6.3 即梦 (RPA)
- 接入: Puppeteer自动化
- 模型: 图片4.1等
- 支持: 图片生成 + 视频生成

### 6.4 Higgsfield AI
- 接入: 官方API + 浏览器代理
- 认证: Clerk OAuth (email/password + 2FA)

### 6.5 Midjourney
- 接入: 官方API代理 (api.ukiyostudio.co/mj/)
- 认证: Custom API Key

### 6.6 RunningHub
- 接入: www.runninghub.cn/openapi/
- 用途: 视频生成 (Seedance/Veo)
- 前端节点: rhImage, rhResult, rhConfig, rhWorkflow

### 6.7 Topaz
- 接入: api.topazlabs.com
- 用途: 视频/图片增强
- 前端节点: topazEnhanceNode

### 6.8 Grok (RPA)
- 接入: 隐藏BrowserWindow操控 grok.com/imagine
- 拦截: NDJSON SSE流式响应

### 6.9 本地AI (ONNX Runtime)
- 引擎: ONNX Runtime WASM (23MB) + WebGPU
- 用途: 背景去除 (@imgly/background-removal)
- 模型: isnet, 从 staticimgly.com 下载

---

## 7. RPA浏览器自动化

### 7.1 即梦RPA架构


**反自动化:**
- disable-blink-features=AutomationControlled
- navigator.webdriver = false
- ignoreDefaultArgs: [--enable-automation]

### 7.2 Higgsfield浏览器集成
- 服务端Puppeteer登录 (email/password -> Clerk FAPI)
- 可见浏览器登录 (用户手动 -> 自动检测)
- Session导入/导出 (Clerk Session同步)
- Per-user隔离, Token自动刷新, 2FA支持

### 7.3 Grok视频生成RPA
1. 隐藏BrowserWindow加载 grok.com/imagine
2. Cookie注入 (sso, sso-rw, x-userid)
3. Cloudflare等待
4. 图片上传 (CDP setFileInputFiles)
5. 模式切换 (影片/Video) + 参数设置
6. Prompt输入 (支持@图片N引用)
7. Enter提交
8. fetch拦截SSE流(NDJSON)捕获视频URL
9. 最长等待5分钟

---

## 8. 认证与VIP系统

### 8.1 用户体系
- 本地数据库: better-sqlite3, WAL模式, lo-studio.db
- 密码加密: bcryptjs
- Token: JWT, 90天过期
- 本地模式: LOCAL_MODE=1 跳过所有认证

### 8.2 VIP密钥系统
- 格式: ALUO-XXXX-XXXX-XXXX
- 机器绑定: Machine ID (crypto.randomUUID, 持久存userData)
- 心跳检测: 10分钟超时判定在线
- 管理员: 生成/停用密钥, 查看用户, 在线监控

### 8.3 数据同步
- push: 本地->云端 (key-value存储)
- pull: 云端->本地
- 表结构: user_data (userId, key, value, updatedAt)

### 8.4 IP地理定位
- http://ip-api.com/json/{ip}
- 免费, 45次/分限制

---

## 9. 前端架构

### 9.1 技术栈
- React 19.2.3 (esm.sh CDN importmap)
- Vite 7.3.1
- TailwindCSS (CDN) + 自定义CSS
- @xyflow/react 12.0.0 (ReactFlow)
- lucide-react 0.563.0
- ONNX Runtime (WASM SIMD 23MB + WebGPU)

### 9.2 设计主题
- 风格: Cyberpunk (赛博朋克)
- 底色: #090919 (深蓝黑)
- 主色: cyan / fuchsia / violet
- 效果: 玻璃态毛玻璃、发光扫光、呼吸灯、卡片弹跳

### 9.3 14种核心节点 (ReactFlow)
| 节点类型 | 功能 | 关键特征 |
|----------|------|----------|
| startNode | 流程起始 | 触发工作流 |
| processNode | 通用处理 | 中间处理步骤 |
| endNode | 流程结束 | 输出结果 |
| imageGenNode | 图像生成 | 即梦Seedream 4.0/4.6, 分镜模式 |
| videoGenNode | 视频生成 | 图片/视频参考, trim裁剪 |
| textGenNode | 文本生成 | 短剧剧本, 角色设计prompt |
| uploadNode | 上传 | 图片/视频/音频, 自动检测 |
| groupNode | 节点分组 | 分组广播, 批量操作 |
| avatarNode | 虚拟人 | 数字人 |
| sceneNode | 场景 | 场景位置, 分镜索引 |
| topazEnhanceNode | Topaz增强 | AI超分 |
| grid9Node | 九宫格 | 图片网格 |
| grid4Node | 四宫格 | 图片网格 |
| groupBroadcastNode | 组别广播 | 向组内节点广播 |
| storyboardControlNode | 故事板控制 | 分镜管理 |
| videoBatchControlNode | 视频批量 | 批量生成 |
| audioSourceNode | 音频源 | 音频参考/裁剪 |
| rhImage/rhResult/rhConfig/rhWorkflow | RunningHub | RunningHub平台集成 |

### 9.4 UI组件
- AssetLibraryModal (资产库弹窗)
- CustomLibraryButton (自定义库按钮)
- LibraryThumbnail (库缩略图)

### 9.5 自定义特性
- 9种自定义光标 (.cur文件)
- 自定义滚动条 (紫色渐变)
- 连线样式 (选中时变白变粗发光)
- 标语: "无限画布,让想象不受限制"

---

## 10. 数据流分析

### 10.1 图像生成流程


### 10.2 文本生成流程


### 10.3 视频反推流程


### 10.4 WebSocket远程浏览器


---

## 11. 安全设计

### 11.1 Electron安全
- contextIsolation: true
- nodeIntegration: false
- preload.js 作为IPC桥接层
- 外部链接用系统浏览器打开

### 11.2 认证安全
- JWT过期90天
- LOCAL_MODE=1跳过认证
- 管理员密钥独立验证 (x-admin-secret)
- VIP密钥绑定Machine ID

### 11.3 数据安全
- SQLite WAL模式
- media-cache自动清理(7天过期)
- Cookie持久化

### 11.4 反爬/反自动化
- disable-blink-features=AutomationControlled
- navigator.webdriver = false
- 忽略 --enable-automation
- 真实浏览器上下文

---

## 12. 开发复刻建议

### 12.1 架构建议
1. **保持三进程模型**: 主进程 + Express API + AI Bridge
2. **前端ReactFlow**: 无线画布是核心交互方式
3. **RPA方案**: 对于无API的平台(即梦/Grok)，Puppeteer是唯一方案
4. **WebSocket投屏**: CDP Screencast方案成熟可用

### 12.2 需要复刻的核心模块
1. **Express API服务** (server.js) - 3272行，核心路由中心
2. **即梦RPA** (jimeng-rpa.js) - 5311行，最大最复杂
3. **Claude桥接** (claude-bridge.js) - 517行，OpenAI兼容接口
4. **认证系统** (auth.js) - 484行，JWT+SQLite
5. **Electron主进程** - 窗口管理+进程fork+自动更新
6. **前端ReactFlow** - 14+种节点 + 连线逻辑 + Cyberpunk主题

### 12.3 技术难点
1. 即梦RPA的DOM选择器 - 需要持续维护(网站更新会失效)
2. Cloudflare绕过 - Claude/Higgsfield都需要
3. Clerk OAuth流程 - Higgsfield认证
4. SSE流式解析 - Claude/Grok都需要
5. WebSocket投屏性能 - JPEG帧率控制
6. ffmpeg视频处理 - 压缩/裁剪/格式转换

### 12.4 可优化点
1. 使用官方API替代RPA (如果有的话)
2. 改用Playwright替代Puppeteer (更好的反检测)
3. 增加Redis缓存层
4. 支持更多AI模型 (通过统一接口)
5. 前端改用TypeScript
6. 数据库改用PostgreSQL (多用户场景)

### 12.5 外部依赖汇总
| 平台 | 接入方式 | 成本 | 风险 |
|------|---------|------|------|
| Claude | 网页API逆向 | 用户订阅 | 中(风控) |
| Gemini | 官方SDK | API调用费 | 低 |
| 即梦 | Puppeteer RPA | 免费 | 高(DOM变化) |
| Higgsfield | 官方API+浏览器代理 | 用户订阅 | 中 |
| Midjourney | 官方API代理 | API调用费 | 低 |
| Grok | 隐藏窗口RPA | 用户订阅 | 高 |
| RunningHub | 官方API | 按量付费 | 低 |
| Topaz | 官方API | API调用费 | 低 |

### 12.6 积分系统
前端有积分管理系统:
- /api/credits/balance - 查询余额
- /api/credits/deduct - 扣除积分
- /api/credits/refund - 积分退款
- /api/purchase/submit - 购买提交

### 12.7 未知第三方
- /ukiyoapi/* - 未知第三方API (3次出现)
- 可能与Midjourney代理相关 (api.ukiyostudio.co)

---

*文档生成完毕。*
