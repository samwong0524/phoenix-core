/**
 * Claude Bridge - 逆向 claude.ai 网页版 API
 *
 * 直接复制自 OpenClaw claude-bridge，只改了端口和 config 路径。
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

// CORS（开发模式 localhost 跨端口）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '500mb' }));

const PORT = parseInt(process.env.CLAUDE_BRIDGE_PORT || '5055');
const USER_DATA_PATH = process.env.USER_DATA_PATH || '';
const CONFIG_PATH = USER_DATA_PATH
  ? path.join(USER_DATA_PATH, 'claude-bridge-config.json')
  : path.join(__dirname, 'claude-bridge-config.json');

// ====== 配置 ======
let config = {
  sessionKey: '',
  orgId: '',
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...config, ...data };
      console.log('[claude-bridge] Config loaded');
    }
  } catch (e) {
    console.warn('[claude-bridge] Failed to load config:', e.message);
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.warn('[claude-bridge] Failed to save config:', e.message);
  }
}

loadConfig();

// ====== Claude API 逆向 ======

const CLAUDE_BASE = 'https://claude.ai';
const API_BASE = `${CLAUDE_BASE}/api`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Cloudflare cookie 缓存
let cfCookies = '';
let cfCookiesTime = 0;
const CF_COOKIE_TTL = 25 * 60 * 1000; // 25 分钟刷新一次

async function refreshCfCookies() {
  try {
    const resp = await fetch(CLAUDE_BASE + '/', {
      headers: { 'cookie': `sessionKey=${config.sessionKey}`, 'user-agent': UA },
      redirect: 'manual',
    });
    const setCookies = resp.headers.getSetCookie?.() || [];
    let cookies = `sessionKey=${config.sessionKey}`;
    for (const c of setCookies) {
      cookies += '; ' + c.split(';')[0];
    }
    cfCookies = cookies;
    cfCookiesTime = Date.now();
    console.log('[claude-bridge] CF cookies refreshed');
  } catch (e) {
    console.warn('[claude-bridge] CF cookie refresh failed:', e.message);
    cfCookies = `sessionKey=${config.sessionKey}`;
  }
}

function getHeaders() {
  return {
    'accept': 'text/event-stream, application/json',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'cookie': cfCookies || `sessionKey=${config.sessionKey}`,
    'origin': CLAUDE_BASE,
    'referer': `${CLAUDE_BASE}/`,
    'user-agent': UA,
    'anthropic-client-sha': 'unknown',
    'anthropic-client-version': 'unknown',
  };
}

async function getOrganizations() {
  const resp = await fetch(`${API_BASE}/organizations`, {
    headers: getHeaders(),
  });
  if (!resp.ok) throw new Error(`Get orgs failed: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

async function createConversation(orgId, model) {
  const resp = await fetch(`${API_BASE}/organizations/${orgId}/chat_conversations`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: '',
      uuid: crypto.randomUUID(),
      model: model,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Create conversation failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

// ====== 图片处理 ======

// 从 OpenAI 格式 messages 中提取文本
function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  }
  return String(content);
}

// 从 base64 数据检测真实图片格式
function detectImageType(base64Data) {
  const header = Buffer.from(base64Data.slice(0, 16), 'base64');
  if (header[0] === 0xFF && header[1] === 0xD8) return 'image/jpeg';
  if (header[0] === 0x89 && header[1] === 0x50) return 'image/png';
  if (header[0] === 0x47 && header[1] === 0x49) return 'image/gif';
  if (header[0] === 0x52 && header[1] === 0x49) return 'image/webp';
  return null;
}

// 从 OpenAI 格式 messages 中提取图片 base64
function extractImagesFromMessages(messages) {
  const images = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type !== 'image_url') continue;
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (!url || !url.startsWith('data:')) continue;
      const match = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        let mediaType = match[1];
        const data = match[2];
        // 自动检测真实格式，避免 media type 不匹配
        const detected = detectImageType(data);
        if (detected && detected !== mediaType) {
          console.log(`[claude-bridge] Image type corrected: ${mediaType} → ${detected}`);
          mediaType = detected;
        }
        images.push({ mediaType, data });
      }
    }
  }
  return images;
}

// 上传图片到 claude.ai (wiggle/upload-file 端点)
async function uploadImageToClaude(orgId, conversationId, base64Data, mediaType) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = (mediaType || 'image/png').split('/')[1] || 'png';
    const fileName = `image_${Date.now()}.${ext}`;
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mediaType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const headers = getHeaders();
    headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    headers['accept'] = '*/*';

    // 关键路径: conversations (不是 chat_conversations) + wiggle/upload-file
    const url = `${API_BASE}/organizations/${orgId}/conversations/${conversationId}/wiggle/upload-file`;
    const resp = await fetch(url, { method: 'POST', headers, body });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[claude-bridge] Image upload failed:', resp.status, text.slice(0, 200));
      return null;
    }

    const result = await resp.json();
    console.log('[claude-bridge] Image uploaded:', result.file_name || result.uuid || 'ok');
    return result;
  } catch (e) {
    console.warn('[claude-bridge] Image upload error:', e.message);
    return null;
  }
}

async function sendMessage(orgId, conversationId, message, model, images = []) {
  const attachments = [];
  const files = [];

  // 上传图片
  if (images.length > 0) {
    for (const img of images) {
      const result = await uploadImageToClaude(orgId, conversationId, img.data, img.mediaType);
      if (result && (result.file_uuid || result.uuid)) {
        const fileId = result.file_uuid || result.uuid;
        files.push(fileId);
        attachments.push({
          file_name: result.file_name || result.sanitized_name,
          file_type: img.mediaType,
          file_size: result.size_bytes || Math.ceil(img.data.length * 3 / 4),
          file_uuid: fileId,
          file_kind: result.file_kind || 'image',
          extracted_content: '',
        });
        console.log(`[claude-bridge] Attached: ${fileId}`);
      }
    }
    if (files.length === 0) {
      console.warn('[claude-bridge] All image uploads failed');
      message += '\n\n[系统: 用户发送了图片但上传失败]';
    }
  }

  const body = {
    prompt: message,
    timezone: 'Asia/Taipei',
    model: model,
    attachments: attachments,
    files: files,
  };

  const resp = await fetch(`${API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}/completion`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Send message failed: ${resp.status} ${text}`);
  }

  return resp;
}

async function parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.completion) {
          fullText += parsed.completion;
        } else if (parsed.type === 'completion' && parsed.completion) {
          fullText += parsed.completion;
        } else if (parsed.delta?.text) {
          fullText += parsed.delta.text;
        } else if (parsed.content_block_delta?.delta?.text) {
          fullText += parsed.content_block_delta.delta.text;
        }
      } catch (e) {}
    }
  }

  return fullText;
}

async function deleteConversation(orgId, conversationId) {
  try {
    await fetch(`${API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
  } catch (e) {}
}

// ====== OpenAI 兼容 API ======

// 默认 Sonnet 4.6，前端传什么模型就用什么
const DEFAULT_MODEL = 'claude-sonnet-4-6';

app.post('/v1/chat/completions', async (req, res) => {
  const startTime = Date.now();

  try {
    if (!config.sessionKey) {
      return res.status(401).json({
        error: { message: 'sessionKey not configured' }
      });
    }

    const { messages, stream, model: reqModel } = req.body;
    const useModel = reqModel || DEFAULT_MODEL;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: { message: 'No messages provided' } });
    }

    // 提取图片
    const images = extractImagesFromMessages(messages);

    // 合并所有消息为单个 prompt（处理多模态 content）
    let prompt = messages.map(m => {
      const text = extractTextContent(m.content);
      if (m.role === 'system') return `[System] ${text}`;
      if (m.role === 'user') return text;
      if (m.role === 'assistant') return `[Assistant] ${text}`;
      return text;
    }).join('\n\n');

    console.log(`[claude-bridge] Request (${prompt.length} chars, ${images.length} images) → ${useModel}`);

    // 刷新 Cloudflare cookie（过期或首次）
    if (!cfCookies || Date.now() - cfCookiesTime > CF_COOKIE_TTL) {
      await refreshCfCookies();
    }

    // 获取 orgId
    if (!config.orgId) {
      const orgs = await getOrganizations();
      if (orgs && orgs.length > 0) {
        config.orgId = orgs[0].uuid;
        saveConfig();
        console.log(`[claude-bridge] orgId: ${config.orgId}`);
      } else {
        throw new Error('No organizations found. Check sessionKey.');
      }
    }

    // 创建对话 + 发消息（失败时自动刷新 CF cookie 重试一次）
    let conversation, response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        conversation = await createConversation(config.orgId, useModel);
        response = await sendMessage(config.orgId, conversation.uuid, prompt, useModel, images);
        break; // 成功就跳出
      } catch (e) {
        if (attempt === 0 && (e.message.includes('429') || e.message.includes('<!DOCTYPE') || e.message.includes('fetch failed'))) {
          console.log('[claude-bridge] Request failed, refreshing CF cookies and retrying...');
          await refreshCfCookies();
          continue;
        }
        throw e;
      }
    }
    const conversationId = conversation.uuid;

    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const sendSSE = (content) => {
        const chunk = {
          id: `chatcmpl-${conversationId}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'claude-opus-4-7',
          choices: [{
            index: 0,
            delta: { content },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              let text = '';
              if (parsed.completion) text = parsed.completion;
              else if (parsed.delta?.text) text = parsed.delta.text;
              else if (parsed.content_block_delta?.delta?.text) text = parsed.content_block_delta.delta.text;

              if (text) sendSSE(text);
            } catch (e) {}
          }
        }
      } catch (e) {
        console.error('[claude-bridge] Stream error:', e.message);
      }

      const endChunk = {
        id: `chatcmpl-${conversationId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-opus-4-7',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

    } else {
      // 非流式
      const fullText = await parseSSEStream(response);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[claude-bridge] Reply (${fullText.length} chars, ${elapsed}s)`);

      res.json({
        id: `chatcmpl-${conversationId}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'claude-opus-4-7',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: fullText || '[Empty response]' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil((fullText || '').length / 4),
          total_tokens: Math.ceil(prompt.length / 4) + Math.ceil((fullText || '').length / 4),
        },
      });
    }

    // 异步清理对话
    deleteConversation(config.orgId, conversationId).catch(() => {});

  } catch (e) {
    console.error(`[claude-bridge] Error: ${e.message}`);

    if (e.message.includes('403') || e.message.includes('401')) {
      config.orgId = '';
      saveConfig();
    }

    res.status(500).json({
      error: { message: e.message, type: 'bridge_error' },
    });
  }
});

// ====== 配置接口 ======

app.get('/config', (req, res) => {
  res.json({
    sessionKey: config.sessionKey ? '***' + config.sessionKey.slice(-8) : '',
    orgId: config.orgId || '',
    hasKey: !!config.sessionKey,
  });
});

app.post('/config', (req, res) => {
  const { sessionKey, orgId } = req.body;
  if (sessionKey !== undefined) config.sessionKey = sessionKey;
  if (orgId !== undefined) config.orgId = orgId;
  if (sessionKey !== undefined) config.orgId = '';
  saveConfig();
  console.log('[claude-bridge] Config updated');
  res.json({ status: 'ok' });
});

app.get('/health', (req, res) => {
  res.json({
    status: config.sessionKey ? 'ok' : 'needs_config',
    hasKey: !!config.sessionKey,
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[claude-bridge] listening on port ${PORT}`);
  // 启动时预刷新 CF cookie
  if (config.sessionKey) refreshCfCookies();
});
