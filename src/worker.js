/**
 * Anthropic Bridge - Cloudflare Worker
 *
 * 对外提供 Anthropic /v1/messages 接口
 * 对内转发到 iFlow (OpenAI-compatible) API
 */

// ============== 工具函数 ==============

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function generateId(prefix = 'msg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// CORS 响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
};

// ============== Token 管理 ==============

async function getAccessToken(env) {
  // 优先从 KV 获取 token
  const token = await env.CFG.get('iflow_access_token');
  const exp = Number(await env.CFG.get('iflow_expires_at') || '0');

  // 如果有 API Key 模式（不过期），直接使用
  const apiKey = await env.CFG.get('iflow_api_key');
  if (apiKey) {
    return apiKey;
  }

  // Token 模式：检查是否需要刷新（提前 60 秒）
  if (!token || exp - nowSec() < 60) {
    const refreshed = await refreshAccessToken(env);
    return refreshed;
  }

  return token;
}

/**
 * 刷新 Access Token
 * 根据 iFlow 的实际刷新接口修改此函数
 */
async function refreshAccessToken(env) {
  const refreshToken = await env.CFG.get('iflow_refresh_token');
  const refreshUrl = await env.CFG.get('iflow_refresh_url');

  if (!refreshToken) {
    // 如果没有 refresh_token，尝试使用 API Key
    const apiKey = await env.CFG.get('iflow_api_key');
    if (apiKey) return apiKey;
    throw new Error('Missing iflow_refresh_token or iflow_api_key in KV');
  }

  if (!refreshUrl) {
    throw new Error('Missing iflow_refresh_url in KV');
  }

  // 调用 iFlow 刷新接口（根据实际接口格式修改）
  const resp = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to refresh token: ${resp.status} - ${errText}`);
  }

  const data = await resp.json();

  // 假设返回格式: { access_token, expires_in, refresh_token? }
  const exp = nowSec() + (data.expires_in || 3600);
  await env.CFG.put('iflow_access_token', data.access_token);
  await env.CFG.put('iflow_expires_at', String(exp));

  // 如果返回了新的 refresh_token，也更新
  if (data.refresh_token) {
    await env.CFG.put('iflow_refresh_token', data.refresh_token);
  }

  return data.access_token;
}

// ============== 模型映射 ==============

async function mapModel(model, env) {
  // 从 KV 获取模型映射表
  const mappingStr = await env.CFG.get('model_mapping');
  if (mappingStr) {
    try {
      const mapping = JSON.parse(mappingStr);
      if (mapping[model]) {
        return mapping[model];
      }
    } catch (e) {
      console.error('Failed to parse model_mapping:', e);
    }
  }

  // 默认映射规则
  const defaultMapping = {
    'claude-3-5-sonnet-latest': env.DEFAULT_MODEL || 'gpt-4',
    'claude-3-5-sonnet-20241022': env.DEFAULT_MODEL || 'gpt-4',
    'claude-3-opus-latest': env.DEFAULT_MODEL || 'gpt-4',
    'claude-3-opus-20240229': env.DEFAULT_MODEL || 'gpt-4',
    'claude-3-sonnet-20240229': env.DEFAULT_MODEL || 'gpt-4',
    'claude-3-haiku-20240307': env.DEFAULT_MODEL || 'gpt-3.5-turbo',
  };

  return defaultMapping[model] || env.DEFAULT_MODEL || model;
}

// ============== 请求转换：Anthropic → OpenAI ==============

async function anthropicToOpenAI(body, env) {
  const model = await mapModel(body.model, env);
  const messages = [];

  // 处理 system prompt
  if (body.system) {
    if (typeof body.system === 'string') {
      messages.push({ role: 'system', content: body.system });
    } else if (Array.isArray(body.system)) {
      // Anthropic 支持 system 为数组格式
      const systemText = body.system
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
    }
  }

  // 转换 messages
  for (const msg of body.messages || []) {
    const content = convertContent(msg.content);
    messages.push({
      role: msg.role,
      content: content,
    });
  }

  const openaiBody = {
    model,
    messages,
    stream: !!body.stream,
  };

  // 可选参数
  if (body.max_tokens) openaiBody.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) openaiBody.temperature = body.temperature;
  if (body.top_p !== undefined) openaiBody.top_p = body.top_p;
  if (body.stop) openaiBody.stop = body.stop;

  return openaiBody;
}

/**
 * 转换 content 格式
 * Anthropic: [{ type: "text", text: "..." }] 或 string
 * OpenAI: string 或 [{ type: "text", text: "..." }, { type: "image_url", ... }]
 */
function convertContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  // 检查是否只有文本
  const hasOnlyText = content.every(item => item.type === 'text');

  if (hasOnlyText) {
    // 简化为纯文本
    return content.map(item => item.text).join('');
  }

  // 有多模态内容，转换为 OpenAI 格式
  return content.map(item => {
    if (item.type === 'text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
      // Anthropic 图片格式转 OpenAI
      if (item.source?.type === 'base64') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${item.source.media_type};base64,${item.source.data}`,
          },
        };
      }
      if (item.source?.type === 'url') {
        return {
          type: 'image_url',
          image_url: { url: item.source.url },
        };
      }
    }
    // 其他类型原样返回
    return item;
  });
}

// ============== 响应转换：OpenAI → Anthropic ==============

function openAIToAnthropicJson(openaiJson, model, inputTokens = 0) {
  const choice = openaiJson?.choices?.[0];
  const message = choice?.message;
  const content = message?.content ?? '';

  // 计算 token 使用量
  const usage = openaiJson?.usage || {};

  return {
    id: generateId('msg'),
    type: 'message',
    role: 'assistant',
    model: model,
    content: [{ type: 'text', text: content }],
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || inputTokens,
      output_tokens: usage.completion_tokens || 0,
    },
  };
}

function mapStopReason(finishReason) {
  const mapping = {
    'stop': 'end_turn',
    'length': 'max_tokens',
    'content_filter': 'end_turn',
    'tool_calls': 'tool_use',
    'function_call': 'tool_use',
  };
  return mapping[finishReason] || 'end_turn';
}

// ============== SSE 流式响应转换 ==============

function sseLine(obj) {
  return `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
}

function createStreamTransformer(model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentBlockStarted = false;
  let inputTokens = 0;
  let outputTokens = 0;
  const messageId = generateId('msg');

  return new TransformStream({
    start(controller) {
      // 发送 message_start 事件
      controller.enqueue(encoder.encode(sseLine({
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })));
    },

    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') {
          continue;
        }

        let evt;
        try {
          evt = JSON.parse(dataStr);
        } catch {
          continue;
        }

        // 提取 usage 信息
        if (evt.usage) {
          inputTokens = evt.usage.prompt_tokens || inputTokens;
          outputTokens = evt.usage.completion_tokens || outputTokens;
        }

        const delta = evt?.choices?.[0]?.delta;
        if (!delta) continue;

        // 发送 content_block_start（仅第一次）
        if (delta.content && !contentBlockStarted) {
          contentBlockStarted = true;
          controller.enqueue(encoder.encode(sseLine({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })));
        }

        // 发送文本增量
        if (delta.content) {
          outputTokens++;
          controller.enqueue(encoder.encode(sseLine({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: delta.content },
          })));
        }

        // 检查是否结束
        const finishReason = evt?.choices?.[0]?.finish_reason;
        if (finishReason) {
          // 发送 content_block_stop
          if (contentBlockStarted) {
            controller.enqueue(encoder.encode(sseLine({
              type: 'content_block_stop',
              index: 0,
            })));
          }

          // 发送 message_delta
          controller.enqueue(encoder.encode(sseLine({
            type: 'message_delta',
            delta: {
              stop_reason: mapStopReason(finishReason),
              stop_sequence: null,
            },
            usage: { output_tokens: outputTokens },
          })));
        }
      }
    },

    flush(controller) {
      // 发送 message_stop
      controller.enqueue(encoder.encode(sseLine({
        type: 'message_stop',
      })));
    },
  });
}

// ============== 路由处理 ==============

async function handleMessages(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const originalModel = body.model || 'claude-3-5-sonnet-latest';

  // 获取 access token
  let token;
  try {
    token = await getAccessToken(env);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 转换请求
  const openaiPayload = await anthropicToOpenAI(body, env);

  // 获取上游地址
  const baseUrl = await env.CFG.get('iflow_openai_base') || env.IFLOW_OPENAI_BASE;
  const path = await env.CFG.get('iflow_openai_path') || env.IFLOW_OPENAI_PATH;

  // 早期配置检查
  if (!baseUrl || !path) {
    return new Response(JSON.stringify({
      error: 'Upstream API not configured',
      details: {
        base_url: baseUrl ? '(set)' : '(missing - set iflow_openai_base in KV or IFLOW_OPENAI_BASE env var)',
        path: path ? '(set)' : '(missing - set iflow_openai_path in KV or IFLOW_OPENAI_PATH env var)',
      },
      hint: 'Use /debug endpoint to check configuration status',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const upstreamUrl = `${baseUrl}${path}`;

  // 发送请求到 iFlow
  console.log('Sending request to upstream:', upstreamUrl);
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(openaiPayload),
  });

  // 处理流式响应
  if (body.stream) {
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transformedStream = upstream.body.pipeThrough(
      createStreamTransformer(originalModel)
    );

    return new Response(transformedStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  }

  // 处理非流式响应
  const upstreamText = await upstream.text();
  let json = null;

  try {
    json = JSON.parse(upstreamText);
  } catch (e) {
    console.error('Failed to parse upstream response:', upstreamText);
    return new Response(JSON.stringify({
      error: 'Failed to parse upstream response',
      upstream_status: upstream.status,
      upstream_body: upstreamText.substring(0, 500),
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({
      error: json?.error || 'Upstream error',
      upstream_status: upstream.status,
      upstream_response: json,
    }), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 验证上游响应格式
  if (!json?.choices?.[0]?.message) {
    console.error('Invalid upstream response format:', JSON.stringify(json));
    return new Response(JSON.stringify({
      error: 'Invalid upstream response format - missing choices[0].message',
      upstream_response: json,
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anthropicResponse = openAIToAnthropicJson(json, originalModel);

  return new Response(JSON.stringify(anthropicResponse), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleModels(request, env) {
  // 返回模型列表（给部分 GUI 客户端探测用）
  const models = {
    object: 'list',
    data: [
      { id: 'claude-3-5-sonnet-latest', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-opus-latest', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-opus-20240229', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-sonnet-20240229', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-haiku-20240307', object: 'model', created: 1700000000, owned_by: 'anthropic' },
    ],
  };

  return new Response(JSON.stringify(models), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============== 管理接口 ==============

function checkAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  const adminKey = env.ADMIN_KEY;

  if (!adminKey || adminKey === 'your-admin-key-here') {
    return false; // 未配置管理密钥
  }

  return authHeader === `Bearer ${adminKey}`;
}

async function handleAdminConfig(request, env) {
  if (!checkAdminAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'GET') {
    // 读取配置（脱敏显示）
    const config = {
      iflow_openai_base: await env.CFG.get('iflow_openai_base'),
      iflow_openai_path: await env.CFG.get('iflow_openai_path'),
      iflow_access_token: (await env.CFG.get('iflow_access_token')) ? '***configured***' : null,
      iflow_refresh_token: (await env.CFG.get('iflow_refresh_token')) ? '***configured***' : null,
      iflow_api_key: (await env.CFG.get('iflow_api_key')) ? '***configured***' : null,
      iflow_expires_at: await env.CFG.get('iflow_expires_at'),
      iflow_refresh_url: await env.CFG.get('iflow_refresh_url'),
      model_mapping: await env.CFG.get('model_mapping'),
      default_model: env.DEFAULT_MODEL,
    };

    return new Response(JSON.stringify(config, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    // 写入配置
    const body = await request.json();

    const allowedKeys = [
      'iflow_openai_base',
      'iflow_openai_path',
      'iflow_access_token',
      'iflow_refresh_token',
      'iflow_api_key',
      'iflow_expires_at',
      'iflow_refresh_url',
      'model_mapping',
    ];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        const value = typeof body[key] === 'object'
          ? JSON.stringify(body[key])
          : String(body[key]);
        await env.CFG.put(key, value);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}

// ============== 主入口 ==============

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 路由
    if (url.pathname === '/v1/messages') {
      return handleMessages(request, env);
    }

    if (url.pathname === '/v1/models') {
      return handleModels(request, env);
    }

    if (url.pathname === '/admin/config') {
      return handleAdminConfig(request, env);
    }

    // 调试端点（显示配置状态，不显示敏感值）
    if (url.pathname === '/debug') {
      const hasApiKey = !!(await env.CFG.get('iflow_api_key'));
      const hasAccessToken = !!(await env.CFG.get('iflow_access_token'));
      const hasRefreshToken = !!(await env.CFG.get('iflow_refresh_token'));
      const baseUrl = await env.CFG.get('iflow_openai_base') || env.IFLOW_OPENAI_BASE;
      const path = await env.CFG.get('iflow_openai_path') || env.IFLOW_OPENAI_PATH;

      return new Response(JSON.stringify({
        config_status: {
          has_api_key: hasApiKey,
          has_access_token: hasAccessToken,
          has_refresh_token: hasRefreshToken,
          base_url_configured: !!baseUrl,
          base_url: baseUrl || '(not set)',
          path_configured: !!path,
          path: path || '(not set)',
          full_upstream_url: baseUrl && path ? `${baseUrl}${path}` : '(incomplete)',
        },
        env_vars: {
          IFLOW_OPENAI_BASE: env.IFLOW_OPENAI_BASE || '(not set)',
          IFLOW_OPENAI_PATH: env.IFLOW_OPENAI_PATH || '(not set)',
          DEFAULT_MODEL: env.DEFAULT_MODEL || '(not set)',
          ADMIN_KEY: env.ADMIN_KEY ? '(configured)' : '(not set)',
        },
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'anthropic-bridge',
        endpoints: ['/v1/messages', '/v1/models', '/admin/config', '/debug'],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
