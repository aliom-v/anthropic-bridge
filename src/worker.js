/**
 * Anthropic Bridge - Cloudflare Worker
 *
 * 对外提供 Anthropic /v1/messages 接口
 * 对内转发到 iFlow (OpenAI-compatible) API
 *
 * 支持：工具调用、流式响应、多模态
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
  // 优先从 KV 获取 API Key
  const apiKey = await env.CFG.get('iflow_api_key');
  if (apiKey) {
    return apiKey;
  }

  // Token 模式
  const token = await env.CFG.get('iflow_access_token');
  const exp = Number(await env.CFG.get('iflow_expires_at') || '0');

  if (!token || exp - nowSec() < 60) {
    const refreshed = await refreshAccessToken(env);
    return refreshed;
  }

  return token;
}

async function refreshAccessToken(env) {
  const refreshToken = await env.CFG.get('iflow_refresh_token');
  const refreshUrl = await env.CFG.get('iflow_refresh_url');

  if (!refreshToken) {
    const apiKey = await env.CFG.get('iflow_api_key');
    if (apiKey) return apiKey;
    throw new Error('Missing iflow_refresh_token or iflow_api_key in KV');
  }

  if (!refreshUrl) {
    throw new Error('Missing iflow_refresh_url in KV');
  }

  const resp = await fetch(refreshUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const exp = nowSec() + (data.expires_in || 3600);
  await env.CFG.put('iflow_access_token', data.access_token);
  await env.CFG.put('iflow_expires_at', String(exp));

  if (data.refresh_token) {
    await env.CFG.put('iflow_refresh_token', data.refresh_token);
  }

  return data.access_token;
}

// ============== 模型映射 ==============

async function mapModel(model, env) {
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
  // 直接透传模型名
  return model;
}

// ============== 工具转换：Anthropic → OpenAI ==============

function anthropicToolsToOpenAI(tools) {
  if (!tools || !Array.isArray(tools)) return undefined;

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

function anthropicToolChoiceToOpenAI(toolChoice) {
  if (!toolChoice) return undefined;

  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'none') return 'none';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return undefined;
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
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: convertContent(msg.content),
      });
    } else if (msg.role === 'assistant') {
      // 处理 assistant 消息（可能包含工具调用）
      const assistantMsg = convertAssistantMessage(msg);
      messages.push(assistantMsg);

      // 如果有 tool_use，需要添加对应的 tool 结果
    } else if (msg.role === 'tool') {
      // Anthropic 的 tool_result 转换为 OpenAI 的 tool message
      messages.push({
        role: 'tool',
        tool_call_id: msg.tool_use_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
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

  // 工具相关
  const tools = anthropicToolsToOpenAI(body.tools);
  if (tools && tools.length > 0) {
    openaiBody.tools = tools;
    const toolChoice = anthropicToolChoiceToOpenAI(body.tool_choice);
    if (toolChoice) {
      openaiBody.tool_choice = toolChoice;
    }
  }

  return openaiBody;
}

function convertAssistantMessage(msg) {
  const content = msg.content;

  // 简单文本
  if (typeof content === 'string') {
    return { role: 'assistant', content };
  }

  if (!Array.isArray(content)) {
    return { role: 'assistant', content: '' };
  }

  // 检查是否有工具调用
  const toolUses = content.filter(item => item.type === 'tool_use');
  const textParts = content.filter(item => item.type === 'text');

  const textContent = textParts.map(item => item.text).join('');

  if (toolUses.length > 0) {
    // 有工具调用
    return {
      role: 'assistant',
      content: textContent || null,
      tool_calls: toolUses.map(tu => ({
        id: tu.id,
        type: 'function',
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input || {}),
        },
      })),
    };
  }

  return { role: 'assistant', content: textContent };
}

function convertContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const hasOnlyText = content.every(item => item.type === 'text');
  if (hasOnlyText) {
    return content.map(item => item.text).join('');
  }

  // 多模态内容
  return content.map(item => {
    if (item.type === 'text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
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
    if (item.type === 'tool_result') {
      // 工具结果在上层处理
      return null;
    }
    return item;
  }).filter(Boolean);
}

// ============== 响应转换：OpenAI → Anthropic ==============

function openAIToAnthropicJson(openaiJson, model) {
  const choice = openaiJson?.choices?.[0];
  const message = choice?.message;
  const usage = openaiJson?.usage || {};

  // 构建 content 数组
  const contentBlocks = [];

  // 处理文本内容（支持 reasoning_content 用于 thinking 模型）
  const textContent = message?.content || message?.reasoning_content || '';
  if (textContent) {
    contentBlocks.push({ type: 'text', text: textContent });
  }

  // 处理工具调用
  if (message?.tool_calls && Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (tc.type === 'function') {
        let inputArgs = {};
        try {
          inputArgs = JSON.parse(tc.function.arguments || '{}');
        } catch (e) {
          inputArgs = {};
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id || generateId('toolu'),
          name: tc.function.name,
          input: inputArgs,
        });
      }
    }
  }

  // 如果没有任何内容，添加空文本块
  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '' });
  }

  return {
    id: generateId('msg'),
    type: 'message',
    role: 'assistant',
    model: model,
    content: contentBlocks,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
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
  let contentBlockIndex = 0;
  let currentBlockStarted = false;
  let inputTokens = 0;
  let outputTokens = 0;
  const messageId = generateId('msg');

  // 工具调用状态
  let toolCalls = {};
  let currentToolCallId = null;

  return new TransformStream({
    start(controller) {
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

        if (evt.usage) {
          inputTokens = evt.usage.prompt_tokens || inputTokens;
          outputTokens = evt.usage.completion_tokens || outputTokens;
        }

        const delta = evt?.choices?.[0]?.delta;
        if (!delta) continue;

        // 处理文本内容
        const textContent = delta.content || delta.reasoning_content;
        if (textContent) {
          if (!currentBlockStarted) {
            currentBlockStarted = true;
            controller.enqueue(encoder.encode(sseLine({
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            })));
          }

          controller.enqueue(encoder.encode(sseLine({
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: textContent },
          })));
        }

        // 处理工具调用
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;
            const tcId = tc.id || currentToolCallId;

            if (tc.id) {
              // 新的工具调用开始
              if (currentBlockStarted) {
                controller.enqueue(encoder.encode(sseLine({
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                })));
                contentBlockIndex++;
                currentBlockStarted = false;
              }

              currentToolCallId = tc.id;
              toolCalls[tcId] = {
                name: tc.function?.name || '',
                arguments: '',
              };

              controller.enqueue(encoder.encode(sseLine({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tcId,
                  name: tc.function?.name || '',
                  input: {},
                },
              })));
              currentBlockStarted = true;
            }

            // 累积参数
            if (tc.function?.arguments && currentToolCallId) {
              toolCalls[currentToolCallId].arguments += tc.function.arguments;

              controller.enqueue(encoder.encode(sseLine({
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: tc.function.arguments,
                },
              })));
            }
          }
        }

        // 检查是否结束
        const finishReason = evt?.choices?.[0]?.finish_reason;
        if (finishReason) {
          if (currentBlockStarted) {
            controller.enqueue(encoder.encode(sseLine({
              type: 'content_block_stop',
              index: contentBlockIndex,
            })));
          }

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

  const originalModel = body.model || 'Qwen3-Max';

  let token;
  try {
    token = await getAccessToken(env);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openaiPayload = await anthropicToOpenAI(body, env);

  const baseUrl = await env.CFG.get('iflow_openai_base') || env.IFLOW_OPENAI_BASE;
  const path = await env.CFG.get('iflow_openai_path') || env.IFLOW_OPENAI_PATH;

  if (!baseUrl || !path) {
    return new Response(JSON.stringify({
      error: 'Upstream API not configured',
      hint: 'Use /debug endpoint to check configuration status',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const upstreamUrl = `${baseUrl}${path}`;

  console.log('Request to upstream:', upstreamUrl, JSON.stringify(openaiPayload));

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(openaiPayload),
  });

  // 流式响应
  if (body.stream) {
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      return new Response(JSON.stringify({
        error: 'Upstream error',
        status: upstream.status,
        details: errText,
      }), {
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

  // 非流式响应
  const upstreamText = await upstream.text();
  let json = null;

  try {
    json = JSON.parse(upstreamText);
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Failed to parse upstream response',
      upstream_body: upstreamText.substring(0, 1000),
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({
      error: json?.error || json?.msg || 'Upstream error',
      upstream_status: upstream.status,
      upstream_response: json,
    }), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!json?.choices?.[0]?.message) {
    return new Response(JSON.stringify({
      error: 'Invalid upstream response format',
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
  // 返回 iFlow 支持的模型列表
  const models = {
    object: 'list',
    data: [
      { id: 'Qwen3-Max', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Qwen3-Max-Preview', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Kimi-K2', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Kimi-K2-Instruct-0905', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'GLM-4.6', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Qwen3-VL-Plus', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Qwen3-235B-A22B-Thinking', object: 'model', created: 1700000000, owned_by: 'iflow' },
      { id: 'Qwen3-235B-A22B-Instruct', object: 'model', created: 1700000000, owned_by: 'iflow' },
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
    return false;
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
    const config = {
      iflow_openai_base: await env.CFG.get('iflow_openai_base'),
      iflow_openai_path: await env.CFG.get('iflow_openai_path'),
      iflow_api_key: (await env.CFG.get('iflow_api_key')) ? '***' : null,
      model_mapping: await env.CFG.get('model_mapping'),
    };

    return new Response(JSON.stringify(config, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
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

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/v1/messages') {
      return handleMessages(request, env);
    }

    if (url.pathname === '/v1/models') {
      return handleModels(request, env);
    }

    if (url.pathname === '/admin/config') {
      return handleAdminConfig(request, env);
    }

    if (url.pathname === '/debug') {
      const hasApiKey = !!(await env.CFG.get('iflow_api_key'));
      const baseUrl = await env.CFG.get('iflow_openai_base') || env.IFLOW_OPENAI_BASE;
      const path = await env.CFG.get('iflow_openai_path') || env.IFLOW_OPENAI_PATH;

      return new Response(JSON.stringify({
        status: 'ok',
        config: {
          has_api_key: hasApiKey,
          base_url: baseUrl || '(not set)',
          path: path || '(not set)',
          upstream_url: baseUrl && path ? `${baseUrl}${path}` : '(incomplete)',
        },
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'anthropic-bridge',
        version: '2.0',
        features: ['tools', 'streaming', 'multimodal'],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
