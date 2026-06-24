'use strict';

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

const DEFAULT_MODEL = {
  openai: 'gpt-5-mini-2025-08-07',
  xai: 'grok-4.3',
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'deepseek/deepseek-v4-flash',
  ollama: 'llama3.2',
  custom: 'gpt-4o-mini',
};

const AGENT_PROMPT =
  'You are Slick AI. Use Slack tools to gather context, then answer the user task. Prefer searching and reading threads/channels before concluding.';

const AGENT_REPLY_RE = /```(?:json)?\s*([\s\S]*?)```/i;

const SESSION_TOOLS = [
  { name: 'slack_search_messages', description: 'Search messages across the workspace.' },
  { name: 'slack_read_channel', description: 'Read recent messages from a channel.' },
  { name: 'slack_read_thread', description: 'Read messages from a thread.' },
];

let mcpSession = null;
let mcpRpcId = 0;

function trim(s, max = 12000) {
  const text = String(s || '');
  return text.length <= max ? text : text.slice(0, max) + '\n…[truncated]';
}

function emit(progress, event) {
  if (typeof progress === 'function') progress(event);
}

function baseUrl(settings) {
  const custom = String(settings.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (custom) return custom;
  return DEFAULT_BASE[settings.provider] || DEFAULT_BASE.openai;
}

function model(settings) {
  const m = String(settings.model || '').trim();
  return m || DEFAULT_MODEL[settings.provider] || DEFAULT_MODEL.openai;
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isSessionToken(token) {
  const t = String(token || '').trim();
  return t.startsWith('xoxc-') || t.startsWith('xoxd-');
}

function isMcpToken(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  if (isSessionToken(t)) return false;
  if (t.startsWith('xoxb-')) return false;
  return true;
}

function resolveMcpToken(settings) {
  const configured = String(settings.mcpToken || '').trim();
  return isMcpToken(configured) ? configured : '';
}

function resolveSessionToken(payload) {
  const token = String(payload.slackToken || '').trim();
  return token || '';
}

function apiError(data, status) {
  const nested = data && data.error;
  const message =
    (nested && (nested.message || nested.error || nested.code)) ||
    (typeof nested === 'string' ? nested : '') ||
    (data && data.message) ||
    `HTTP ${status}`;
  return String(message);
}

async function mcpRequest(net, token, method, params) {
  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (mcpSession) headers['Mcp-Session-Id'] = mcpSession;

  const res = await doFetch(SLACK_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpRpcId, method, params: params || {} }),
  });

  const session = res.headers.get('mcp-session-id');
  if (session) mcpSession = session;

  const data = await readBody(res);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `MCP HTTP ${res.status}`);
  if (data && data.error) throw new Error(data.error.message || 'MCP error');
  return data && data.result !== undefined ? data.result : data;
}

async function mcpInit(net, token) {
  await mcpRequest(net, token, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'slick-ai', version: '1.0.0' },
  });
  try {
    await mcpRequest(net, token, 'notifications/initialized', {});
  } catch {}
}

function mcpText(result) {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof result.text === 'string') return result.text;
  return JSON.stringify(result);
}

async function mcpTool(net, token, name, args) {
  if (!mcpSession) await mcpInit(net, token);
  const result = await mcpRequest(net, token, 'tools/call', { name, arguments: args || {} });
  return mcpText(result);
}

async function mcpListTools(net, token) {
  if (!mcpSession) await mcpInit(net, token);
  const result = await mcpRequest(net, token, 'tools/list', {});
  return Array.isArray(result && result.tools) ? result.tools : [];
}

async function slackApi(net, token, method, params) {
  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  const body = new URLSearchParams({ token, ...params });
  const res = await doFetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await readBody(res);
  if (!data || data.ok !== true) throw new Error((data && data.error) || `Slack API ${method} failed`);
  return data;
}

function formatSlackMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return '';
  return messages
    .filter((m) => m && typeof m === 'object' && !m.subtype)
    .map((m) => {
      const who = m.username || m.user || 'unknown';
      const text = String(m.text || '').trim();
      return text ? `${who}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function sessionSearch(net, token, query, count) {
  const data = await slackApi(net, token, 'search.messages', {
    query: String(query || ''),
    count: String(count || 8),
    sort: 'timestamp',
    sort_dir: 'desc',
  });
  const matches = (data.messages && data.messages.matches) || [];
  return matches
    .map((m) => {
      const text = String(m.text || '').trim();
      if (!text) return '';
      const who = m.username || m.user || 'unknown';
      const channel = m.channel && m.channel.name ? `#${m.channel.name}` : '';
      return `${who}${channel ? ` in ${channel}` : ''}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function sessionReadChannel(net, token, channelId, limit) {
  const data = await slackApi(net, token, 'conversations.history', {
    channel: String(channelId || ''),
    limit: String(limit || 40),
  });
  return formatSlackMessages(data.messages);
}

async function sessionReadThread(net, token, channelId, threadTs, limit) {
  const data = await slackApi(net, token, 'conversations.replies', {
    channel: String(channelId || ''),
    ts: String(threadTs || ''),
    limit: String(limit || 40),
  });
  return formatSlackMessages(data.messages);
}

async function sessionTool(net, token, name, args) {
  const params = args && typeof args === 'object' ? args : {};
  if (name === 'slack_search_messages') {
    return sessionSearch(net, token, params.query, params.count);
  }
  if (name === 'slack_read_channel') {
    return sessionReadChannel(net, token, params.channel_id, params.limit);
  }
  if (name === 'slack_read_thread') {
    return sessionReadThread(net, token, params.channel_id, params.thread_ts, params.limit);
  }
  throw new Error(`Unknown tool ${name}`);
}

async function resolveAgentBackend(net, settings, req, progress) {
  const mcpToken = resolveMcpToken(settings);
  const sessionTok = resolveSessionToken(req);

  if (settings.useMcp && mcpToken) {
    try {
      emit(progress, { type: 'status', message: 'Connecting to Slack MCP…' });
      const tools = await mcpListTools(net, mcpToken);
      if (tools.length) {
        return {
          mode: 'mcp',
          tools,
          callTool: (name, args) => mcpTool(net, mcpToken, name, args),
        };
      }
    } catch (e) {
      if (!sessionTok) throw e;
      emit(progress, {
        type: 'status',
        message: 'MCP token rejected, falling back to Slack session API…',
      });
    }
  }

  if (!sessionTok) {
    throw new Error(
      'No usable Slack auth. Add an MCP OAuth user token in Slick AI settings, or stay signed into Slack for session API fallback.',
    );
  }

  emit(progress, { type: 'status', message: 'Using Slack session API…' });
  return {
    mode: 'session',
    tools: SESSION_TOOLS,
    callTool: (name, args) => sessionTool(net, sessionTok, name, args),
  };
}

function parseAgentStep(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(AGENT_REPLY_RE);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return { action: 'answer', text: raw };
}

async function readOpenAIStream(res, onDelta) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const data = await readBody(res);
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (text) onDelta(String(text));
    return String(text || '').trim();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
        if (delta) {
          out += delta;
          onDelta(delta);
        }
      } catch {}
    }
  }

  return out.trim();
}

async function readAnthropicStream(res, onDelta) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const data = await readBody(res);
    const part =
      data &&
      Array.isArray(data.content) &&
      data.content.find((entry) => entry && entry.type === 'text' && typeof entry.text === 'string');
    if (part) onDelta(String(part.text));
    return String((part && part.text) || '').trim();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        if (json.type === 'content_block_delta' && json.delta && json.delta.type === 'text_delta') {
          const delta = json.delta.text;
          if (delta) {
            out += delta;
            onDelta(delta);
          }
        }
      } catch {}
    }
  }

  return out.trim();
}

async function streamChatOpenAI(net, settings, messages, onDelta) {
  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  const key = String(settings.apiKey || '').trim();
  if (!key) throw new Error('API key is required');

  const res = await doFetch(`${baseUrl(settings)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: model(settings), messages, temperature: 0.4, stream: true }),
  });

  if (!res.ok) throw new Error(apiError(await readBody(res), res.status));
  const text = await readOpenAIStream(res, onDelta);
  if (!text) throw new Error('No completion returned');
  return text;
}

async function streamChatAnthropic(net, settings, messages, onDelta) {
  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  const key = String(settings.apiKey || '').trim();
  if (!key) throw new Error('API key is required');

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const convo = messages.filter((m) => m.role !== 'system');

  const res = await doFetch(`${baseUrl(settings)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model(settings),
      max_tokens: 2048,
      stream: true,
      system: system || undefined,
      messages: convo.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    }),
  });

  if (!res.ok) throw new Error(apiError(await readBody(res), res.status));
  const text = await readAnthropicStream(res, onDelta);
  if (!text) throw new Error('No completion returned');
  return text;
}

async function streamChat(net, settings, messages, onDelta) {
  if (settings.provider === 'anthropic') return streamChatAnthropic(net, settings, messages, onDelta);
  if (settings.provider === 'ollama') {
    const copy = { ...settings };
    if (!String(copy.apiKey || '').trim()) copy.apiKey = 'ollama';
    return streamChatOpenAI(net, copy, messages, onDelta);
  }
  return streamChatOpenAI(net, settings, messages, onDelta);
}

async function runAgent(net, settings, req, progress) {
  const backend = await resolveAgentBackend(net, settings, req, progress);
  const { tools, callTool, mode } = backend;

  const maxSteps = Math.max(1, Math.min(8, Number(settings.agentMaxSteps) || 5));
  const toolNames = new Set(tools.map((tool) => tool.name));
  const catalog = tools
    .map((tool) => `- ${tool.name}: ${tool.description || 'No description'}`)
    .join('\n')
    .slice(0, 12000);

  const task = String(req.question || req.text || '').trim();
  if (!task) throw new Error('Agent mode needs a task or question');

  const messages = [
    {
      role: 'system',
      content: [
        String(settings.systemPrompt || '').trim(),
        AGENT_PROMPT,
        `Available Slack tools (${mode} backend):`,
        catalog,
        'Respond with ONLY a JSON object in a fenced ```json block.',
        'To call a tool: {"action":"tool","name":"<tool_name>","arguments":{...}}',
        'To finish: {"action":"answer","text":"<final markdown answer>"}',
        'Use tool calls when you need workspace search, channel history, or thread history.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `Task: ${task}`,
        req.context && `Visible Slack messages:\n${trim(req.context, 8000)}`,
        req.channel && `Current channel id: ${req.channel}`,
        req.threadTs && `Current thread ts: ${req.threadTs}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  const trace = [];
  for (let step = 0; step < maxSteps; step++) {
    emit(progress, { type: 'status', message: `Planning step ${step + 1}…` });
    emit(progress, { type: 'stream_reset' });

    let reply = '';
    await streamChat(net, settings, messages, (delta) => {
      reply += delta;
      emit(progress, { type: 'delta', text: delta, phase: 'plan' });
    });

    const parsed = parseAgentStep(reply);
    if (!parsed || parsed.action === 'answer') {
      const answer = String((parsed && parsed.text) || reply || '').trim();
      emit(progress, { type: 'stream_reset' });
      emit(progress, { type: 'status', message: 'Writing answer…' });
      let streamed = '';
      await streamChat(
        net,
        settings,
        [
          {
            role: 'system',
            content: 'Rewrite the following agent answer for the user. Keep facts, use clean markdown, be concise.',
          },
          { role: 'user', content: answer },
        ],
        (delta) => {
          streamed += delta;
          emit(progress, { type: 'delta', text: delta, phase: 'answer' });
        },
      );
      return {
        text: streamed || answer,
        action: 'agent',
        usedMcp: mode === 'mcp',
        agentSteps: trace.length,
        backend: mode,
      };
    }

    const name = String(parsed.name || '').trim();
    const args = parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {};
    if (!name || !toolNames.has(name)) {
      messages.push(
        { role: 'assistant', content: reply },
        {
          role: 'user',
          content: `Tool error: unknown or missing tool "${name || '(empty)'}". Reply with a final answer JSON.`,
        },
      );
      continue;
    }

    emit(progress, { type: 'step', tool: name, status: 'running' });
    let observation = '';
    try {
      observation = await callTool(name, args);
      trace.push({ tool: name, ok: true });
      emit(progress, { type: 'step', tool: name, status: 'done' });
    } catch (e) {
      observation = `Tool call failed: ${e.message}`;
      trace.push({ tool: name, ok: false, error: e.message });
      emit(progress, { type: 'step', tool: name, status: 'error', error: e.message });
    }

    messages.push(
      { role: 'assistant', content: reply },
      { role: 'user', content: `Tool result for ${name}:\n${trim(observation, 8000)}` },
    );
  }

  emit(progress, { type: 'status', message: 'Finishing up…' });
  emit(progress, { type: 'stream_reset' });
  let fallback = '';
  await streamChat(
    net,
    settings,
    messages.concat([
      { role: 'user', content: 'Step budget exhausted. Reply now with {"action":"answer","text":"..."} only.' },
    ]),
    (delta) => {
      fallback += delta;
      emit(progress, { type: 'delta', text: delta, phase: 'plan' });
    },
  );
  const parsed = parseAgentStep(fallback);
  const answer = String((parsed && parsed.text) || fallback || '').trim();
  return { text: answer, action: 'agent', usedMcp: mode === 'mcp', agentSteps: trace.length, backend: mode };
}

async function run(net, settings, req, progress) {
  return runAgent(net, settings, { ...req, action: 'agent' }, progress);
}

module.exports = { run };
