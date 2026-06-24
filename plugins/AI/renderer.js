(function () {
  'use strict';
  if (window.__slickAI) return;

  const TEXT_SEL = [
    '.c-message_kit__blocks',
    '[data-qa="message-text"]',
    '.p-rich_text_block',
    '.p-rich_text_section',
    '[data-qa="message_content"]',
    '.c-message__body',
    '.c-message_kit__text',
  ].join(',');
  const ROW_SEL = [
    '.c-message_kit__message',
    '[data-qa="message_container"]',
    '[id^="message-list_"][role="listitem"]',
  ].join(',');
  const COMPOSER_SEL = [
    '[data-qa="message_input"]',
    '.ql-editor[data-input-metric-boundary="composer"]',
    '.p-message_input_field',
    '[role="textbox"][aria-label*="Message" i]',
  ].join(',');

  const pending = new Map();
  let seq = 0;
  let panelOpen = false;
  let toolbarHooked = false;
  let streamPhase = 'plan';
  let hasResponse = false;

  function decode(value) {
    let text = String(value == null ? '' : value);
    try {
      const ta = document.createElement('textarea');
      ta.innerHTML = text;
      text = ta.value;
    } catch (e) {}
    return text
      .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
      .replace(/<([^>]+)>/g, '$1')
      .trim();
  }

  function slackToken() {
    try {
      const t = window.boot_data && window.boot_data.api_token;
      if (typeof t === 'string' && t) return t;
    } catch (e) {}
    try {
      const c = JSON.parse(localStorage.getItem('localConfig_v2'));
      const tm = c && c.teams;
      if (tm) {
        const a = c.lastActiveTeamId || (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
        if (a && tm[a] && tm[a].token) return tm[a].token;
        for (const k in tm) if (tm[k] && tm[k].token) return tm[k].token;
      }
    } catch (e) {}
    try {
      const t = window.TS && window.TS.boot_data && window.TS.boot_data.api_token;
      if (typeof t === 'string' && t) return t;
    } catch (e) {}
    return '';
  }

  function channelId() {
    const m = location.pathname.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
    return m ? m[1] : '';
  }

  function threadTs() {
    const m = location.pathname.match(/\/thread\/([0-9.]+)/);
    return m ? m[1] : '';
  }

  function visibleMessages(limit) {
    const max = limit || 40;
    const rows = [...document.querySelectorAll(ROW_SEL)].slice(-max);
    return rows
      .map((row) => {
        const node = row.querySelector(TEXT_SEL);
        const text = node ? decode(node.innerText || node.textContent || '').slice(0, 1200) : '';
        if (!text) return null;
        const sender = row.querySelector('.c-message__sender_button, [data-qa="message_sender_name"]');
        return `${sender ? String(sender.textContent || '').trim() : 'Unknown'}: ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  function composerEl() {
    return document.querySelector(COMPOSER_SEL);
  }

  function selectedComposerText() {
    const el = composerEl();
    return el ? String(el.innerText || el.textContent || '').trim() : '';
  }

  function setComposerText(text) {
    const el = composerEl();
    if (!el) return false;
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      return true;
    } catch (e) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }
  }

  function clearComposer() {
    return setComposerText('');
  }

  function findAgentsButton() {
    const selectors = [
      'button[data-qa*="agent" i]',
      'button[aria-label*="Agent" i]',
      '[class*="AgentMenu" i] button',
      '[class*="agent_menu" i] button',
      '[class*="agents" i] button',
    ];
    for (const sel of selectors) {
      const hit = [...document.querySelectorAll(sel)].find((btn) => btn.offsetParent !== null);
      if (hit) return hit;
    }
    return null;
  }

  function sparkleMarkup(agentsBtn) {
    if (agentsBtn) {
      const svg = agentsBtn.querySelector('svg');
      if (svg) {
        const clone = svg.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.removeAttribute('class');
        clone.style.color = '#fff';
        return `<span class="slick-ai-icon">${clone.outerHTML}</span>`;
      }
    }
    return `<span class="slick-ai-icon"></span>`;
  }

  function positionPanel() {
    const panel = document.getElementById('slick-ai-panel');
    const btn = document.getElementById('slick-ai-toolbar-btn');
    if (!panel || !btn) return;
    const rect = btn.getBoundingClientRect();
    panel.style.setProperty('--slick-ai-panel-top', `${Math.round(rect.bottom + 8)}px`);
    panel.style.setProperty('--slick-ai-panel-right', `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`);
  }

  function ensurePanel() {
    let panel = document.getElementById('slick-ai-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'slick-ai-panel';
    panel.className = 'slick-ai-panel';
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="slick-ai-head"><span>Slick AI</span><button type="button" class="slick-ai-close" aria-label="Close">×</button></div>',
      '<div class="slick-ai-body">',
      '  <textarea class="slick-ai-input" placeholder="Ask about this channel or thread…"></textarea>',
      '  <button type="button" class="slick-ai-btn slick-ai-send">Send</button>',
      '  <div class="slick-ai-thinking">',
      '    <div class="slick-ai-loader"><span></span><span></span><span></span></div>',
      '    <div class="slick-ai-status-live">Thinking…</div>',
      '  </div>',
      '  <div class="slick-ai-response">',
      '    <textarea class="slick-ai-output" readonly></textarea>',
      '    <button type="button" class="slick-ai-btn slick-ai-copy">Copy</button>',
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(panel);
    return panel;
  }

  function ui() {
    const panel = ensurePanel();
    return {
      trigger: document.getElementById('slick-ai-toolbar-btn'),
      panel,
      ask: panel.querySelector('.slick-ai-input'),
      out: panel.querySelector('.slick-ai-output'),
      statusLive: panel.querySelector('.slick-ai-status-live'),
      send: panel.querySelector('.slick-ai-send'),
      copy: panel.querySelector('.slick-ai-copy'),
      close: panel.querySelector('.slick-ai-close'),
    };
  }

  function setStatus(text) {
    const { statusLive } = ui();
    if (statusLive) statusLive.textContent = text || '';
  }

  function setOutput(text) {
    const { out } = ui();
    if (!out) return;
    out.value = text || '';
    out.scrollTop = out.scrollHeight;
  }

  function appendOutput(text) {
    const { out } = ui();
    if (!out || !text) return;
    out.value += text;
    out.scrollTop = out.scrollHeight;
  }

  function showResponse() {
    if (hasResponse) return;
    hasResponse = true;
    const { panel } = ui();
    if (panel) panel.classList.add('has-response');
  }

  function resetResponse() {
    hasResponse = false;
    streamPhase = 'plan';
    const { panel } = ui();
    if (panel) panel.classList.remove('has-response');
    setOutput('');
  }

  function setBusy(on) {
    const { panel, trigger } = ui();
    if (panel) panel.classList.toggle('is-busy', on);
    if (trigger) trigger.classList.toggle('is-loading', on);
  }

  function togglePanel(force) {
    const { panel, trigger } = ui();
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    panel.hidden = !panelOpen;
    if (trigger) trigger.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    if (panelOpen) positionPanel();
  }

  function send(question) {
    const parts = ui();
    const text = String(question != null ? question : parts.ask.value).trim();
    if (!text) return Promise.reject(new Error('Enter a question'));

    const id = 'ai-' + ++seq;
    resetResponse();
    setBusy(true);
    setStatus('Thinking…');

    const disable = () => {
      document.querySelectorAll('.slick-ai-btn, .slick-ai-toolbar-btn, .slick-ai-input').forEach((el) => {
        el.disabled = true;
      });
    };
    const enable = () => {
      document.querySelectorAll('.slick-ai-btn, .slick-ai-toolbar-btn, .slick-ai-input').forEach((el) => {
        el.disabled = false;
      });
    };
    disable();

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.__slickAI.queue.push({
        id,
        action: 'agent',
        question: text,
        context: visibleMessages(50),
        channel: channelId(),
        threadTs: threadTs(),
        slackToken: slackToken(),
      });
    })
      .then((result) => {
        if (result && result.text) {
          showResponse();
          setOutput(result.text);
        }
        setStatus('');
        return result;
      })
      .catch((error) => {
        setStatus(error && error.message ? error.message : 'Request failed');
        throw error;
      })
      .finally(() => {
        setBusy(false);
        enable();
      });
  }

  function handleSlash(text) {
    const match = String(text || '')
      .trim()
      .match(/^\/ai(?:\s+([\s\S]*))?$/i);
    if (!match) return false;
    const question = String(match[1] || '').trim();
    togglePanel(true);
    if (question) ui().ask.value = question;
    send(question);
    return true;
  }

  window.__slickAI = {
    queue: [],
    drain() {
      if (!this.queue.length) return [];
      const batch = this.queue.slice();
      this.queue.length = 0;
      return batch;
    },
    progress(id, event) {
      const entry = pending.get(id);
      if (!entry || !event || typeof event !== 'object') return;

      if (event.type === 'status') setStatus(event.message || 'Thinking…');
      if (event.type === 'stream_reset') {
        streamPhase = event.phase || 'plan';
        if (streamPhase === 'answer') setOutput('');
      }
      if (event.type === 'delta') {
        if (event.phase) streamPhase = event.phase;
        if (streamPhase === 'answer') {
          showResponse();
          appendOutput(event.text || '');
        }
      }
    },
    resolve(id, result) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(result || {});
    },
    reject(id, error) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.reject(error || { message: 'Request failed' });
    },
    ask(_action, extra) {
      togglePanel(true);
      if (extra && extra.question) ui().ask.value = extra.question;
      return send(extra && extra.question ? extra.question : undefined);
    },
  };

  function mountToolbarButton() {
    const agents = findAgentsButton();
    if (!agents) return false;

    let wrap = document.getElementById('slick-ai-toolbar-wrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.id = 'slick-ai-toolbar-wrap';
      wrap.className = 'slick-ai-toolbar-wrap';

      const btn = document.createElement('button');
      btn.id = 'slick-ai-toolbar-btn';
      btn.type = 'button';
      btn.className = 'slick-ai-toolbar-btn';
      btn.setAttribute('aria-label', 'Slick AI');
      btn.setAttribute('aria-expanded', 'false');
      btn.title = 'Slick AI';
      btn.innerHTML = `${sparkleMarkup(agents)}<span class="slick-ai-toolbar-label">AI</span><span class="slick-ai-toolbar-caret" aria-hidden="true">▾</span>`;
      wrap.appendChild(btn);
    } else {
      const btn = wrap.querySelector('#slick-ai-toolbar-btn');
      const icon = btn && btn.querySelector('.slick-ai-icon');
      if (btn && icon) icon.outerHTML = sparkleMarkup(agents);
    }

    if (agents.nextElementSibling !== wrap) agents.insertAdjacentElement('afterend', wrap);
    return true;
  }

  function bindUi() {
    if (!mountToolbarButton()) return false;
    const parts = ui();
    if (!parts.trigger || toolbarHooked) return true;
    toolbarHooked = true;

    parts.trigger.addEventListener('click', () => togglePanel());
    parts.close.addEventListener('click', () => togglePanel(false));
    parts.send.addEventListener('click', () => send());
    parts.ask.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    parts.copy.addEventListener('click', async () => {
      const text = parts.out.value;
      if (!text) return;
      const label = parts.copy.textContent;
      try {
        await navigator.clipboard.writeText(text);
        parts.copy.textContent = 'Copied!';
        setTimeout(() => {
          parts.copy.textContent = label;
        }, 1200);
      } catch (e) {
        parts.copy.textContent = 'Copy failed';
        setTimeout(() => {
          parts.copy.textContent = label;
        }, 1200);
      }
    });

    window.addEventListener('resize', positionPanel);
    window.addEventListener('slick:plugin-settings', mountToolbarButton);
    document.addEventListener(
      'keydown',
      (event) => {
        const s = (window.__slickPluginSettings && window.__slickPluginSettings.AI) || {};
        if (s.enableSlash === false) return;
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        const text = selectedComposerText();
        if (!/^\/ai(?:\s|$)/i.test(text)) return;
        event.preventDefault();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        handleSlash(text);
        clearComposer();
      },
      true,
    );

    return true;
  }

  let obsTimer = null;
  const obs = new MutationObserver(() => {
    if (obsTimer) return;
    obsTimer = setTimeout(() => {
      obsTimer = null;
      bindUi();
      if (panelOpen) positionPanel();
    }, 250);
  });

  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    bindUi();
    obs.observe(document.body, { childList: true, subtree: true });
  }

  boot();
})();
