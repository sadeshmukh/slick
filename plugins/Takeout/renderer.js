(function () {
  'use strict';
  if (window.__slickTakeout) return;
  window.__slickTakeout = true;

  // Selectors. Every lookup has fallbacks; Slack reshuffles these often.
  const ROW = '.c-message_kit__message,[data-qa="message_container"],[id^="message-list_"][role="listitem"]';
  const BODY =
    '[data-qa="message-text"],.p-rich_text_block,.c-message_kit__blocks,.c-message__body,.p-rich_text_section';
  const SENDER = '.c-message__sender_button,[data-qa="message_sender_name"],.c-message_kit__sender,.c-message__sender';
  const THREAD =
    '[data-qa="threads_flexpane"],.p-threads_flexpane,[data-qa="thread_view"],.p-thread_view,[data-qa="thread_messages"]';
  const LIST = '[data-qa="slack_kit_list"],.c-virtual_list__scroll_container,[data-qa="message_pane"]';
  const HEADER =
    '[data-qa="channel-header__right"],.p-view_header__actions,.p-view_header__buttons,.p-flexpane_header__buttons,[data-qa="flexpane_header_buttons"]';
  const TITLE =
    '.p-view_header__text,[data-qa="channel_name"],[data-qa="channel_header__title"],.p-view_header__channel_title';
  const STRIP =
    '.c-message__edited_label,.c-message_kit__reply_bar,[data-qa="reply_bar"],[data-qa="reactions"],.c-reaction_bar,.c-message_kit__attachments .c-message_kit__gutter,.slick-ml-edited-original,.slick-ml-deleted';
  const ID = /^[UWC][A-Z0-9]{6,}$/;

  const S = (k, d) => {
    const v = ((window.__slickPluginSettings || {}).Takeout || {})[k];
    return v == null ? d : v;
  };
  const clean = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => {
    if (!el || el.nodeType !== 1 || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const decode = (v) => {
    try {
      const t = document.createElement('textarea');
      t.innerHTML = String(v == null ? '' : v);
      return t.value;
    } catch (e) {
      return String(v == null ? '' : v);
    }
  };
  const fmt = (ts) => {
    const n = parseFloat(ts);
    if (!n) return '';
    const d = new Date(n * 1000),
      p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // React fiber reading (adapted from MessageLogger) — reliable { user, ts, text }.
  const fiber = (el) => {
    const k =
      el && Object.keys(el).find((n) => n.startsWith('__reactFiber$') || n.startsWith('__reactInternalInstance$'));
    return k ? el[k] : null;
  };
  const propsMsg = (p) => {
    if (!p || typeof p !== 'object') return null;
    const m = p.message || p.msg || p.event;
    if (m && typeof m === 'object' && (m.ts || m.event_ts || m.message_ts))
      return {
        ts: m.ts || m.event_ts || m.message_ts,
        user: m.user || m.user_id || m.sender || m.authorUserId || '',
        text: typeof m.text === 'string' ? m.text : '',
      };
    if (p.ts || p.messageTs || p.message_ts)
      return {
        ts: p.ts || p.messageTs || p.message_ts,
        user: p.user || p.userId || p.user_id || '',
        text: typeof p.text === 'string' ? p.text : '',
      };
    return null;
  };
  const fiberMsg = (el) => {
    let f = fiber(el);
    for (let i = 0; f && i < 40; f = f.return, i++) {
      const m = propsMsg(f.memoizedProps) || propsMsg(f.pendingProps);
      if (m) return m;
    }
    return null;
  };
  const rowMsg = (row) => {
    let m = fiberMsg(row);
    if (m) return m;
    const all = row.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 80; i++) if ((m = fiberMsg(all[i]))) return m;
    return null;
  };

  // DOM body -> Markdown / plain text. Walking the rendered DOM resolves mentions,
  // channel links and <a> hrefs to display names for free; mrkdwn() is the fallback.
  const fence = (t, md) => {
    const b = String(t == null ? '' : t).replace(/\n+$/, '');
    return md ? '```\n' + b + '\n```' : '---\n' + b + '\n---';
  };
  const wrap = (s, m, md) => (md && s.trim() ? m + s + m : s);
  const quote = (t, md) =>
    t
      .replace(/\s+$/, '')
      .split('\n')
      .map((l) => (md ? '> ' : '| ') + l)
      .join('\n');

  function inline(node, md) {
    let o = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        o += c.nodeValue;
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (tag === 'BR') {
        o += '\n';
      } else if (tag === 'IMG' || c.matches('.c-emoji,[data-stringify-emoji]')) {
        const img = tag === 'IMG' ? c : c.querySelector('img');
        o +=
          c.getAttribute('data-stringify-emoji') ||
          (img && (img.getAttribute('data-stringify-emoji') || img.getAttribute('alt'))) ||
          clean(c);
      } else if (
        c.hasAttribute('data-stringify-type') ||
        c.matches('.c-member_slug,.c-channel_entity,[data-qa="channel_entity"],.c-mrkdwn__broadcast')
      ) {
        o += clean(c); // mentions / channels carry resolved text
      } else if (tag === 'A') {
        const t = clean(c),
          h = c.getAttribute('href') || '';
        o += !md ? (h && h !== t ? `${t} (${h})` : t || h) : !h || h === t ? t || h : `[${t || h}](${h})`;
      } else if (tag === 'CODE' && !c.closest('pre')) {
        o += wrap((c.textContent || '').trim(), '`', md);
      } else {
        const mark =
          tag === 'B' || tag === 'STRONG'
            ? '**'
            : tag === 'I' || tag === 'EM'
              ? '_'
              : /^(S|STRIKE|DEL)$/.test(tag)
                ? '~~'
                : '';
        o += mark ? wrap(inline(c, md), mark, md) : inline(c, md);
      }
    }
    return o;
  }

  function list(el, md, depth) {
    const ord = el.tagName === 'OL' || /ordered/.test(el.className || ''),
      pad = '  '.repeat(depth),
      out = [];
    let n = 1;
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const nested = [];
      let s = '';
      for (const part of li.childNodes) {
        if (part.nodeType === 1 && /^(UL|OL)$/.test(part.tagName)) nested.push(list(part, md, depth + 1));
        else if (part.nodeType === 1) s += inline(part, md);
        else if (part.nodeType === 3) s += part.nodeValue;
      }
      out.push(
        pad +
          (ord ? n++ + '. ' : '- ') +
          s.replace(/\s+/g, ' ').trim() +
          (nested.length ? '\n' + nested.join('\n') : ''),
      );
    }
    return out.join('\n');
  }

  function serialize(host, md) {
    const kids = [...host.children].filter((c) => c.nodeType === 1),
      out = [];
    for (const el of kids.length ? kids : [host]) {
      const cls = typeof el.className === 'string' ? el.className : '';
      const kind =
        el === host
          ? ''
          : /preformatted/.test(cls) || el.tagName === 'PRE'
            ? 'pre'
            : /quote/.test(cls) || el.tagName === 'BLOCKQUOTE'
              ? 'q'
              : /rich_text_list/.test(cls) || el.tagName === 'UL' || el.tagName === 'OL'
                ? 'list'
                : '';
      if (kind === 'pre') out.push(fence(el.textContent || '', md));
      else if (kind === 'q') out.push(quote(inline(el, md), md));
      else if (kind === 'list') out.push(list(el, md, 0));
      else {
        const t = inline(el, md)
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (t) out.push(t);
      }
    }
    return out.join('\n\n').trim();
  }

  function mrkdwn(text, md, names) {
    let s = decode(text || '');
    if (!s) return '';
    s = s.replace(/<([@#!])?([^>|]*)(?:\|([^>]*))?>/g, (_m, sig, b, label) => {
      if (sig === '@') return '@' + (label || (names && names[b]) || b.replace(/^[UW]/, 'user-'));
      if (sig === '#') return '#' + (label || (names && names[b]) || b);
      if (sig === '!') return '@' + (label ? label.replace(/^@/, '') : b);
      return md ? (label && label !== b ? `[${label}](${b})` : b) : label && label !== b ? `${label} (${b})` : b;
    });
    if (!md) return s;
    return s
      .replace(/```([\s\S]*?)```/g, (_m, c) => ' FENCE ' + c + ' FENCE ')
      .replace(/`([^`\n]+)`/g, (_m, c) => ' CODE ' + c + ' CODE ')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1**$2**')
      .replace(/~([^~\n]+)~/g, '~~$1~~')
      .replace(/ CODE ([\s\S]*?) CODE /g, '`$1`')
      .replace(/ FENCE ([\s\S]*?) FENCE /g, '```$1```');
  }

  const isEdited = (row) =>
    !!row.querySelector('.c-message__edited_label,[data-qa="message_edited_label"]') ||
    /\(edited\)\s*$/.test((row.querySelector(BODY)?.textContent || '').trim());
  const replyCount = (row) => {
    const b = row.querySelector('[data-qa="reply_bar"],.c-message_kit__reply_bar,[data-qa="reply_bar_count"]');
    const m = b && (b.textContent || '').match(/(\d+)\s+repl/i);
    return m ? +m[1] : 0;
  };
  function files(row) {
    const out = [],
      seen = new Set();
    row
      .querySelectorAll(
        '[data-qa="file_container"],[data-qa*="file_entity"],.c-file_container,.p-file_image_thumbnail,.c-message_kit__file',
      )
      .forEach((h) => {
        const a = h.querySelector('a[href]'),
          img = h.querySelector('img[src]');
        const url = (a && a.getAttribute('href')) || (img && img.getAttribute('src')) || '';
        const name = (
          clean(h.querySelector('[data-qa="file_title"],.c-file__title,.p-file__title')) ||
          clean(a) ||
          (img && (img.getAttribute('alt') || '').trim()) ||
          'attachment'
        )
          .replace(/\s+/g, ' ')
          .slice(0, 120);
        const key = name + '|' + url;
        if (name && !seen.has(key)) {
          seen.add(key);
          out.push({ name, url });
        }
      });
    return out;
  }

  function record(row, names) {
    const msg = rowMsg(row),
      ts =
        (msg && msg.ts) ||
        (String(row.getAttribute('data-ts') || row.getAttribute('data-message-ts') || row.id || '').match(
          /\d{10}\.\d{6}/,
        ) || [''])[0];
    if (!ts) return null;
    const host =
      row.querySelector('[data-qa="message-text"]') ||
      row.querySelector('.c-message_kit__blocks') ||
      row.querySelector(BODY);
    let md = '',
      tx = '';
    if (host)
      try {
        const clone = host.cloneNode(true);
        clone.querySelectorAll(STRIP).forEach((n) => n.remove());
        md = serialize(clone, true);
        tx = serialize(clone, false);
      } catch (e) {}
    if (!md && msg && msg.text) md = mrkdwn(msg.text, true, names);
    if (!tx && msg && msg.text) tx = mrkdwn(msg.text, false, names);
    const name = clean(row.querySelector(SENDER));
    if (name && msg && ID.test(msg.user || '')) names[msg.user] = name;
    return {
      userId: (msg && msg.user) || '',
      name,
      ts,
      time: fmt(ts),
      md: md.replace(/\s*\(edited\)\s*$/, '').trim(),
      tx: tx.replace(/\s*\(edited\)\s*$/, '').trim(),
      edited: isEdited(row),
      replies: replyCount(row),
      files: files(row),
    };
  }

  // Scope detection & collection.
  const threadPane = () => [...document.querySelectorAll(THREAD)].find(vis) || null;
  const scrollRoot = (p) => p.querySelector('.c-virtual_list__scroll_container') || p.querySelector(LIST) || p;
  function scopeOf(forced) {
    const th = threadPane();
    let sc = forced || S('scope', 'auto');
    if (sc === 'auto') sc = th ? 'thread' : 'channel';
    if (sc === 'thread' && !th) sc = 'channel';
    return { scope: sc, hasThread: !!th };
  }
  // The channel list and the sidebar are both virtualized, so pick the visible
  // non-thread list that actually holds message rows (most rows wins).
  function channelRoot() {
    const th = threadPane();
    let best = null,
      most = -1;
    for (const l of document.querySelectorAll(LIST)) {
      if ((th && th.contains(l)) || l.closest(THREAD) || !vis(l)) continue;
      const n = l.querySelectorAll(ROW).length;
      if (n > most) {
        most = n;
        best = l;
      }
    }
    return best || document.querySelector('[data-qa="message_pane"]') || document.body;
  }
  function paneTitle(scope) {
    let t = (document.title || '')
      .split(/\s+[-|]\s+/)[0]
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
    if (!t || /^slack$/i.test(t))
      for (const sel of TITLE.split(',')) {
        const c = clean(document.querySelector(sel));
        if (c) {
          t = c.slice(0, 60);
          break;
        }
      }
    return (scope === 'thread' ? 'Thread in ' : '') + (t || 'Slack');
  }

  function collect(forced) {
    const { scope, hasThread } = scopeOf(forced);
    const root = scope === 'thread' ? scrollRoot(threadPane() || document.body) : channelRoot();
    const names = {},
      msgs = [],
      seen = new Set();
    let last = '';
    (root ? root.querySelectorAll(ROW) : []).forEach((row) => {
      if (row.parentElement && row.parentElement.closest(ROW)) return; // skip nested/quoted
      const r = record(row, names);
      if (!r || seen.has(r.ts)) return;
      seen.add(r.ts);
      r.name = r.name || last || (r.userId && names[r.userId]) || '';
      if (r.name) last = r.name;
      msgs.push(r);
    });
    let partial = false;
    try {
      partial = !!root && root.scrollHeight > root.clientHeight + 4;
    } catch (e) {
      partial = msgs.length > 0;
    }
    return { scope, hasThread, title: paneTitle(scope), messages: msgs, partial };
  }

  // Rendering.
  function group(msgs) {
    const g = [];
    for (const m of msgs) {
      const l = g[g.length - 1];
      if (l && l.userId && m.userId && l.userId === m.userId && l.name === m.name) l.items.push(m);
      else g.push({ userId: m.userId, name: m.name, time: m.time, items: [m] });
    }
    return g;
  }
  function range(msgs) {
    const t = msgs.map((m) => m.time).filter(Boolean);
    if (!t.length) return '';
    const a = t[0].slice(0, 10),
      b = t[t.length - 1].slice(0, 10);
    return a === b ? a : `${a} → ${b}`;
  }
  const fileLines = (fs, md) =>
    fs
      .map((f) =>
        md
          ? f.url
            ? `📎 [${f.name}](${f.url})`
            : `📎 ${f.name}`
          : f.url
            ? `[file] ${f.name} (${f.url})`
            : `[file] ${f.name}`,
      )
      .join('\n');
  const plural = (n) => (n === 1 ? '' : 's');
  const finish = (L) =>
    L.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n';

  function renderMd(data, o) {
    const L = [];
    if (o.metadata) {
      const meta = [
        `Exported ${fmt(Date.now() / 1000)}`,
        `${data.messages.length} message${plural(data.messages.length)}`,
      ];
      const r = range(data.messages);
      if (r) meta.push(r);
      L.push(`_${meta.join(' — ')}_`);
      if (data.partial) L.push('> ⚠️ Only currently-loaded messages are included (Slack virtualizes history).');
      L.push('');
    }
    if (!data.messages.length) return '_No messages found in the current view._';
    const blocks = o.group ? group(data.messages) : data.messages.map((m) => ({ ...m, items: [m] }));
    for (const g of blocks) {
      const h = [];
      if (g.name) h.push(`**${g.name}**`);
      if (o.timestamps && g.time) h.push(g.time);
      if (h.length) L.push(h.join(' — '));
      for (const m of g.items) {
        let b = m.md || (m.files.length ? '' : '_(no text)_');
        if (m.edited) b += b ? ' _(edited)_' : '_(edited)_';
        if (b) L.push(o.blockquote ? quote(b, true) : b);
        if (m.files.length) L.push(fileLines(m.files, true));
        if (m.replies > 0) L.push(`_↳ ${m.replies} repl${m.replies === 1 ? 'y' : 'ies'} in thread_`);
      }
      L.push('');
    }
    return finish(L);
  }

  function renderTxt(data, o) {
    const L = [];
    if (o.metadata) {
      L.push(data.title);
      const meta = [`Exported ${fmt(Date.now() / 1000)}`, `${data.messages.length} messages`];
      const r = range(data.messages);
      if (r) meta.push(r);
      L.push(meta.join(' · '));
      if (data.partial) L.push('(only currently-loaded messages are included)');
      L.push('='.repeat(40), '');
    }
    if (!data.messages.length) return 'No messages found in the current view.';
    const blocks = o.group ? group(data.messages) : data.messages.map((m) => ({ items: [m] }));
    for (const g of blocks) {
      for (const m of g.items) {
        let b = m.tx || '';
        if (m.edited) b += b ? ' (edited)' : '(edited)';
        const ls = b ? b.split('\n') : [''];
        L.push((o.timestamps && m.time ? `[${m.time}] ` : '') + (m.name ? `${m.name}: ` : '') + ls[0]);
        for (let i = 1; i < ls.length; i++) L.push('    ' + ls[i]);
        if (m.files.length)
          fileLines(m.files, false)
            .split('\n')
            .forEach((l) => L.push('    ' + l));
        if (m.replies > 0) L.push(`    (${m.replies} replies in thread)`);
      }
      L.push('');
    }
    return finish(L);
  }

  const renderDocument = (data, o) => (o.format === 'txt' ? renderTxt : renderMd)(data, o);

  // Copy / download / toast.
  const sanitize = (n) =>
    String(n || 'slack')
      .replace(/^[#@]/, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'slack';

  async function copy(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (e) {}
    try {
      const a = document.createElement('textarea');
      a.value = t;
      a.style.position = 'fixed';
      a.style.opacity = '0';
      document.body.appendChild(a);
      a.focus();
      a.select();
      const ok = document.execCommand('copy');
      a.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function download(text, data, format) {
    try {
      const date = (range(data.messages) || fmt(Date.now() / 1000)).slice(0, 10);
      const blob = new Blob([text], { type: format === 'txt' ? 'text/plain' : 'text/markdown' });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = `slick-takeout-${sanitize(data.title)}-${date}.${format === 'txt' ? 'txt' : 'md'}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function toast(msg, ok) {
    let h = document.getElementById('slick-takeout-toast');
    if (!h) {
      h = document.createElement('div');
      h.id = 'slick-takeout-toast';
      document.body.appendChild(h);
    }
    h.textContent = msg;
    h.dataset.state = ok ? 'ok' : 'err';
    h.classList.add('slick-takeout-toast--show');
    clearTimeout(h.__t);
    h.__t = setTimeout(() => h.classList.remove('slick-takeout-toast--show'), 2600);
  }

  // Modal.
  const SVG =
    '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M10 2.25a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V3a.75.75 0 0 1 .75-.75zM4 12.5a.75.75 0 0 1 .75.75V15c0 .14.11.25.25.25h10a.25.25 0 0 0 .25-.25v-1.75a.75.75 0 0 1 1.5 0V15A1.75 1.75 0 0 1 15 16.75H5A1.75 1.75 0 0 1 3.25 15v-1.75A.75.75 0 0 1 4 12.5z"/></svg>';

  function mk(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  }
  const section = (legend, ...kids) =>
    mk('div', { class: 'slick-takeout-section' }, [
      mk('div', { class: 'slick-takeout-legend', text: legend }),
      ...kids,
    ]);
  const seg = (...kids) => mk('div', { class: 'slick-takeout-segment' }, kids);
  function radio(name, value, label, checked, onSel) {
    const input = mk('input', { type: 'radio', name, value });
    input.checked = !!checked;
    input.addEventListener('change', () => input.checked && onSel());
    return { input, label: mk('label', { class: 'slick-takeout-radio' }, [input, mk('span', { text: label })]) };
  }
  function check(label, checked, onChange) {
    const input = mk('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', onChange);
    return { input, label: mk('label', { class: 'slick-takeout-check' }, [input, mk('span', { text: label })]) };
  }

  let modal = null,
    prevFocus = null;
  function close() {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.removeEventListener('keydown', onKey, true);
    try {
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    } catch (e) {}
  }
  function onKey(e) {
    if (!modal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key !== 'Tab') return;
    const f = [...modal.querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.disabled && vis(el),
    );
    if (!f.length) return;
    const first = f[0],
      last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(anchor) {
    close();
    prevFocus = anchor || document.activeElement;
    const init = scopeOf();
    const st = {
      scope: init.scope,
      hasThread: init.hasThread,
      format: S('format', 'markdown') === 'txt' ? 'txt' : 'markdown',
      amount: 'all',
      data: null,
    };

    const body = mk('div', { class: 'slick-takeout-body' });

    let scopeInputs = {};
    if (st.hasThread) {
      const t = radio(
        'slick-takeout-scope',
        'thread',
        'Thread',
        st.scope === 'thread',
        () => ((st.scope = 'thread'), refresh()),
      );
      const c = radio(
        'slick-takeout-scope',
        'channel',
        'Main channel',
        st.scope === 'channel',
        () => ((st.scope = 'channel'), refresh()),
      );
      scopeInputs = { thread: t.input, channel: c.input };
      body.appendChild(section('You have a thread open. Export the…', seg(t.label, c.label)));
    }

    const countInput = mk('input', { type: 'number', min: '1', step: '1', class: 'slick-takeout-num' });
    countInput.value = '50';
    const all = radio(
      'slick-takeout-amount',
      'all',
      'All loaded messages',
      true,
      () => ((st.amount = 'all'), summary()),
    );
    const lastR = radio(
      'slick-takeout-amount',
      'lastN',
      'Last',
      false,
      () => ((st.amount = 'lastN'), countInput.focus(), countInput.select(), summary()),
    );
    lastR.label.appendChild(countInput);
    lastR.label.appendChild(mk('span', { text: 'messages' }));
    countInput.addEventListener('input', () => ((lastR.input.checked = true), (st.amount = 'lastN'), summary()));
    const avail = mk('div', { class: 'slick-takeout-hint' });
    body.appendChild(section('How much?', all.label, lastR.label, avail));

    const fmtR = {
      markdown: radio(
        'slick-takeout-format',
        'markdown',
        'Markdown',
        st.format === 'markdown',
        () => ((st.format = 'markdown'), summary()),
      ),
      txt: radio(
        'slick-takeout-format',
        'txt',
        'Plain text',
        st.format === 'txt',
        () => ((st.format = 'txt'), summary()),
      ),
    };
    body.appendChild(section('Format', seg(fmtR.markdown.label, fmtR.txt.label)));

    const opt = {
      timestamps: check('Include timestamps', S('includeTimestamps', true), () => summary()),
      metadata: check('Metadata header', S('includeMetadataHeader', true), () => summary()),
      group: check('Group by sender', S('groupBySender', true), () => summary()),
      blockquote: check('Blockquote message text (Markdown)', S('blockquote', true), () => summary()),
    };
    body.appendChild(section('Options', ...Object.values(opt).map((o) => o.label)));

    const sum = mk('div', { class: 'slick-takeout-summary' });
    body.appendChild(sum);

    const primary = S('defaultAction', 'copy') === 'download' ? 'download' : 'copy';
    const copyBtn = mk('button', { type: 'button', class: 'slick-takeout-btn', text: 'Copy' });
    const dlBtn = mk('button', { type: 'button', class: 'slick-takeout-btn', text: 'Download' });
    (primary === 'download' ? dlBtn : copyBtn).classList.add('slick-takeout-btn--primary');

    const x = mk('button', { class: 'slick-takeout-x', type: 'button', 'aria-label': 'Close', html: '&times;' });
    x.addEventListener('click', close);
    const dialog = mk(
      'div',
      { class: 'slick-takeout-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export conversation' },
      [
        mk('div', { class: 'slick-takeout-head' }, [mk('h2', { text: 'Export conversation' }), x]),
        body,
        mk('div', { class: 'slick-takeout-foot' }, [copyBtn, dlBtn]),
      ],
    );
    const overlay = mk('div', { id: 'slick-takeout-modal', class: 'slick-takeout-overlay' }, [dialog]);

    const opts = () => ({
      format: st.format,
      timestamps: opt.timestamps.input.checked,
      metadata: opt.metadata.input.checked,
      group: opt.group.input.checked,
      blockquote: opt.blockquote.input.checked,
    });
    const picked = () => {
      if (!st.data) return [];
      const a = st.data.messages;
      return st.amount === 'lastN' ? a.slice(-Math.max(1, Math.min(a.length, Math.floor(+countInput.value || 0)))) : a;
    };
    function summary() {
      const n = picked().length;
      sum.textContent = `Exporting ${n} message${plural(n)} as ${st.format === 'txt' ? 'plain text' : 'Markdown'}.`;
    }
    function refresh() {
      st.data = collect(st.hasThread ? st.scope : undefined);
      const n = st.data.messages.length;
      avail.textContent = `${n} message${plural(n)} loaded${st.data.partial ? ' · scroll up to load more' : ''}.`;
      countInput.max = String(Math.max(1, n));
      if (+countInput.value > n) countInput.value = String(n || 1);
      if (scopeInputs.thread) scopeInputs.thread.checked = st.scope === 'thread';
      if (scopeInputs.channel) scopeInputs.channel.checked = st.scope === 'channel';
      summary();
    }
    function go(kind) {
      const data = { ...st.data, messages: picked() };
      if (!data.messages.length) return toast('Nothing to export — no messages loaded.', false);
      const text = renderDocument(data, opts());
      if (kind === 'download') {
        const ok = download(text, data, st.format);
        toast(ok ? 'Export downloaded.' : 'Download failed.', ok);
        if (ok) close();
      } else
        copy(text).then((ok) => {
          toast(ok ? `Copied ${data.messages.length} messages to clipboard.` : 'Copy failed.', ok);
          if (ok) close();
        });
    }

    copyBtn.addEventListener('click', () => go('copy'));
    dlBtn.addEventListener('click', () => go('download'));
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        go(primary);
      }
    });
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

    document.body.appendChild(overlay);
    modal = overlay;
    document.addEventListener('keydown', onKey, true);
    refresh();
    (primary === 'download' ? dlBtn : copyBtn).focus();
  }

  // Header button injection.
  function makeBtn() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'c-button-unstyled slick-takeout-trigger';
    b.dataset.slickTakeoutBtn = '1';
    b.setAttribute('aria-label', 'Export conversation');
    b.title = 'Export conversation';
    b.innerHTML = SVG;
    b.addEventListener('click', (e) => (e.preventDefault(), e.stopPropagation(), open(b)));
    return b;
  }
  function inject() {
    if (!document.body) return;
    let placed = false;
    document.querySelectorAll(HEADER).forEach((h) => {
      if (!vis(h)) return;
      if (!h.querySelector('[data-slick-takeout-btn]')) h.appendChild(makeBtn());
      placed = true;
    });
    const float = document.getElementById('slick-takeout-float');
    if (!placed && !float) {
      const f = makeBtn();
      f.id = 'slick-takeout-float';
      f.classList.add('slick-takeout-trigger--float');
      document.body.appendChild(f);
    } else if (placed && float) float.remove();
  }
  let timer = 0;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      try {
        inject();
      } catch (e) {}
    }, 200);
  };
  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    inject();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('slick:plugin-settings', schedule);
  }

  window.__slickTakeoutApi = { collect, renderDocument, open };
  boot();
  console.log('[Takeout] active');
})();
