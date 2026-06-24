'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./service');

module.exports = {
  meta: {
    name: 'AI',
    description: 'Your own AI system in Slack',
  },

  settings: {
    provider: {
      type: 'select',
      label: 'Provider',
      description: 'Which API to use',
      default: 'openai',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'xai', label: 'xAI' },
        { value: 'ollama', label: 'Ollama (local)' },
        { value: 'custom', label: 'Custom (OpenAI-compatible)' },
      ],
    },
    apiKey: {
      type: 'text',
      label: 'API key',
      default: '',
    },
    baseUrl: {
      type: 'text',
      label: 'Base URL',
      description: 'Optional override',
      default: '',
    },
    model: {
      type: 'text',
      label: 'Model',
      description: 'Model ID.',
      default: '',
    },
    useMcp: {
      type: 'boolean',
      label: 'Use Slack MCP',
      description: 'Fetch extra workspace context via Slack MCP (search, channel/thread history).',
      default: true,
    },
    mcpToken: {
      type: 'text',
      label: 'Slack MCP OAuth token',
      description: 'Optional xoxp- OAuth user token. Leave blank to use your signed-in Slack session.',
      default: '',
    },
    agentMaxSteps: {
      type: 'number',
      label: 'Agent step budget',
      description: 'Maximum tool calls per request.',
      default: 5,
    },
    enableSlash: {
      type: 'boolean',
      label: '/ai slash command',
      description: 'Intercept /ai commands in the composer instead of sending them to Slack.',
      default: true,
    },
    systemPrompt: {
      type: 'text',
      label: 'System prompt',
      description: 'Optional extra instructions prepended to every request.',
      default: '',
    },
  },

  css: `
    .slick-ai-toolbar-wrap {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      vertical-align: middle;
    }
    .slick-ai-toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 28px;
      padding: 0 8px 0 6px;
      margin: 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      font: 600 13px/1 Slack-Lato, Lato, apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--dt_color-content-pry, #f8f8f8);
      background: rgba(255, 255, 255, 0.04);
      cursor: pointer;
      box-shadow: none;
      transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .slick-ai-toolbar-btn:hover,
    .slick-ai-toolbar-btn[aria-expanded="true"] {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.18);
    }
    .slick-ai-toolbar-btn.is-loading {
      pointer-events: none;
      opacity: 0.88;
    }
    .slick-ai-toolbar-btn .slick-ai-icon {
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .slick-ai-toolbar-btn .slick-ai-icon svg {
      width: 18px;
      height: 18px;
      display: block;
    }
    .slick-ai-toolbar-label {
      letter-spacing: -0.01em;
    }
    .slick-ai-toolbar-caret {
      opacity: 0.65;
      font-size: 9px;
      line-height: 1;
      margin-top: 1px;
    }
    .slick-ai-panel {
      position: fixed;
      top: var(--slick-ai-panel-top, 52px);
      right: var(--slick-ai-panel-right, 20px);
      width: min(420px, calc(100vw - 40px));
      max-height: min(72vh, 680px);
      z-index: 100000;
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      overflow: hidden;
      background: var(--dt_color-base-pry, #1a1d21);
      color: var(--dt_color-content-pry, #f8f8f8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    }
    .slick-ai-panel[hidden] { display: none !important; }
    .slick-ai-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font: 600 14px/1.2 Slack-Lato, Lato, apple-system, BlinkMacSystemFont, sans-serif;
    }
    .slick-ai-thinking {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
      font: 12px/1.35 Slack-Lato, Lato, apple-system, BlinkMacSystemFont, sans-serif;
    }
    .slick-ai-panel.is-busy:not(.has-response) .slick-ai-thinking { display: flex; }
    .slick-ai-response {
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    .slick-ai-panel.has-response .slick-ai-response { display: flex; }
    .slick-ai-panel.has-response .slick-ai-thinking { display: none; }
    .slick-ai-loader {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      flex: 0 0 auto;
    }
    .slick-ai-loader span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #e01e5a;
      animation: slick-ai-bounce 1.2s infinite ease-in-out;
    }
    .slick-ai-loader span:nth-child(2) { animation-delay: 0.15s; }
    .slick-ai-loader span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes slick-ai-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
      40% { transform: translateY(-4px); opacity: 1; }
    }

    .slick-ai-close {
      border: 0;
      background: transparent;
      color: inherit;
      opacity: 0.7;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .slick-ai-body {
      padding: 12px 14px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .slick-ai-btn {
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      border-radius: 999px;
      padding: 6px 10px;
      font: 500 12px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
    }
    .slick-ai-btn:hover { background: rgba(255, 255, 255, 0.12); }
    .slick-ai-btn[disabled] { opacity: 0.45; cursor: default; }
    .slick-ai-input,
    .slick-ai-output {
      width: 100%;
      box-sizing: border-box;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(0, 0, 0, 0.22);
      color: inherit;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 10px;
      resize: vertical;
    }
    .slick-ai-input { min-height: 72px; }
    .slick-ai-output { min-height: 160px; }
    .slick-ai-send { align-self: flex-start; }
    .slick-ai-copy { align-self: flex-start; }
    .slick-ai-input[disabled] { opacity: 0.7; }
  `,

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),

  main(ctx) {
    const net = ctx.electron && ctx.electron.net;
    const inflight = new Set();

    ctx.onWindow((win) => {
      const wc = win.webContents;
      let timer = null;

      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };

      const tick = async () => {
        if (wc.isDestroyed()) return stop();

        let batch;
        try {
          batch = await wc.executeJavaScript(
            'window.__slickAI && window.__slickAI.drain ? window.__slickAI.drain() : []',
            true,
          );
        } catch {
          return;
        }
        if (!Array.isArray(batch) || !batch.length) return;

        for (const req of batch) {
          const id = req && req.id;
          if (!id || inflight.has(id)) continue;
          inflight.add(id);

          const push = (event) => {
            if (wc.isDestroyed()) return;
            wc.executeJavaScript(
              `window.__slickAI && window.__slickAI.progress(${JSON.stringify(id)}, ${JSON.stringify(event)})`,
              true,
            ).catch(() => {});
          };

          run(net, ctx.settings, req, push)
            .then((result) => {
              if (wc.isDestroyed()) return;
              return wc.executeJavaScript(
                `window.__slickAI && window.__slickAI.resolve(${JSON.stringify(id)}, ${JSON.stringify(result)})`,
                true,
              );
            })
            .catch((error) => {
              if (wc.isDestroyed()) return;
              return wc.executeJavaScript(
                `window.__slickAI && window.__slickAI.reject(${JSON.stringify(id)}, ${JSON.stringify({ message: error.message || String(error) })})`,
                true,
              );
            })
            .finally(() => inflight.delete(id));
        }
      };

      timer = setInterval(() => {
        tick().catch(() => {});
      }, 400);
      wc.on('destroyed', stop);
    });
  },
};
