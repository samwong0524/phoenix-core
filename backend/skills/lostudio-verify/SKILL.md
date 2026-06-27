---
name: lostudio-verify
description: Verify LOStudio Open Fork deployment — check code, launch app, confirm server, test API routes.
auto-load: false
roles: [researcher, creator, specialist, worker, coordinator]
requires: []
---

# LOStudio Open Fork 验证

## 目标

验证 LOStudio 的 Open Fork 改造是否部署成功（server.js 路由注入 + 前端补丁）。

## 前置知识

LOStudio 安装路径：`C:\Users\LENOVO\AppData\Local\Programs\LOStudio\`
修改后的文件位置：`resources/app.asar.unpacked/server.js` + `resources/app.asar.unpacked/dist/assets/index-z0ISuRAp.js`

## 验证步骤

使用 bash 工具按顺序执行。每一步的输出用于判断是否通过。

### Step 1: 关闭旧进程

```bash
taskkill /F /IM "LOStudio.exe"
```

如果输出 "没有找到进程" 说明本来就没在运行，继续下一步。

### Step 2: 等待 3 秒让进程完全退出

```bash
sleep 3
```

### Step 3: 验证 server.js 路由注入

```bash
grep -c "api/oneapi" "C:/Users/LENOVO/AppData/Local/Programs/LOStudio/resources/app.asar.unpacked/server.js"
```

- **期望**: ≥ 3（/api/oneapi 路由 + 兜底路由 + 前端劫持路由）
- **失败**: 0 → 路由未注入，需要重新部署

### Step 4: 验证前端补丁

```bash
grep -c "localhost:3456" "C:/Users/LENOVO/AppData/Local/Programs/LOStudio/resources/app.asar.unpacked/dist/assets/index-z0ISuRAp.js"
```

- **期望**: ≥ 10（前端 API 请求指向 localhost:3456）
- **失败**: 0 → 前端补丁未生效

### Step 5: 验证路由顺序（API 路由必须在静态资源之前）

```bash
grep -n "api/oneapi\|express.static" "C:/Users/LENOVO/AppData/Local/Programs/LOStudio/resources/app.asar.unpacked/server.js" | head -5
```

- **期望**: `api/oneapi` 的行号 < `express.static` 的行号
- **失败**: 静态资源在前 → Express 会先拦截请求

### Step 6: 启动 LOStudio

```bash
start "" "C:/Users/LENOVO/AppData/Local/Programs/LOStudio/LOStudio.exe"
```

这会启动 LOStudio GUI，bash 会立即返回。

### Step 7: 等待服务器就绪（轮询最多 30 秒）

```bash
for i in 1 2 3 4 5 6; do
  if curl -s http://localhost:3456/ > /dev/null 2>&1; then
    echo "LOStudio server ready on port 3456 (attempt $i)"
    break
  fi
  echo "Waiting for server... (attempt $i)"
  sleep 5
done
```

- **成功**: 输出 "LOStudio server ready"
- **失败**: 6 次都未响应 → LOStudio 可能启动失败

### Step 8: 验证 /api/oneapi 路由存在

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456/api/oneapi -X POST -H "Content-Type: application/json" -d '{}'
```

- **期望**: 401（未认证）或 400（参数错误）→ 说明路由存在
- **失败**: 404 → 路由未生效

### Step 9: 检查进程状态

```bash
tasklist | grep LOStudio
```

- **期望**: 看到 LOStudio.exe 进程

## 最终判断

如果 Step 3-9 都通过 → **LOStudio Open Fork 部署成功**
如果任何一步失败 → 报告具体失败步骤和输出，要求人工介入
