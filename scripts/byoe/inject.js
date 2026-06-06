'use strict';

const perf = require('./perf');
perf.mark('inject.js start');

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const { app, session, Notification } = electron;
const { loadPlugins, mergeSettings } = require('./plugins');
const settings = require('./settings-ui');
const { buildSpec } = require('../theme');
perf.mark('modules loaded');

const LAUNCHER_MS = process.env.SLICK_LAUNCH_T0
  ? Math.max(0, Math.round(performance.timeOrigin - Number(process.env.SLICK_LAUNCH_T0)))
  : 0;

const THEMES_DIR = path.join(__dirname, '..', '..', 'themes');
const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');
const SETTINGS_DIR = path.join(app.getPath('userData'), 'slick');
const ENABLED_FILE = path.join(SETTINGS_DIR, 'enabled-plugins.json');
const DEFAULT_ENABLED_FILE = path.join(PLUGINS_DIR, 'enabled.json');
const ACTIVE_THEME_FILE = path.join(SETTINGS_DIR, 'active-theme');
const PLUGIN_SETTINGS_FILE = path.join(SETTINGS_DIR, 'plugin-settings.json');
const enabledPlugins = () => settings.readEnabled(ENABLED_FILE) || settings.readEnabled(DEFAULT_ENABLED_FILE);
const pluginSettings = () => settings.readPluginSettings(PLUGIN_SETTINGS_FILE);
let THEME = process.env.SLICK_THEME || settings.readActiveTheme(ACTIVE_THEME_FILE) || '';
let THEME_FILE = THEME ? path.join(THEMES_DIR, `${THEME}.json`) : null;

function themeCss() {
  const spec = buildSpec(THEME_FILE);
  const SEL = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';
  const decls = Object.entries(spec.vars)
    .map(([k, v]) => `${k}:${v} !important`)
    .join(';');
  return { name: spec.name, css: (decls ? `${SEL}{${decls}}\n` : '') + (spec.css || '') };
}

let theme = { name: '', css: '' };
function rebuild() {
  if (!THEME_FILE) {
    theme = { name: '', css: '' };
    return;
  }
  try {
    theme = themeCss();
  } catch (e) {
    console.error(`[slick-byoe] theme load failed: ${e.message}`);
  }
}
const endTheme = perf.span();
rebuild();
endTheme(`theme "${theme.name || 'none'}" built`);

const endPlugins = perf.span();
const plugins = loadPlugins({
  pluginsDir: PLUGINS_DIR,
  enabled: enabledPlugins(),
  electron,
  settings: pluginSettings(),
});
endPlugins(`${plugins.loaded.length} plugin(s) loaded`);

const reportPerf = () => perf.report({ launcherMs: LAUNCHER_MS, pluginTimings: plugins.timings });
setTimeout(reportPerf, 60000).unref();

function pluginCss() {
  const stored = pluginSettings();
  const dynamic = plugins.cssFns.map(({ name, schema, fn }) => {
    try {
      return fn(mergeSettings(schema, stored[name]));
    } catch (e) {
      console.error(`[slick-byoe] plugin "${name}" css() failed: ${e.message}`);
      return '';
    }
  });
  return plugins.css.concat(dynamic).filter(Boolean).join('\n');
}

function fullCss() {
  return [theme.css, pluginCss()].filter(Boolean).join('\n');
}

const armedSessions = new WeakSet();
function armBlocking(sess) {
  if (!sess || armedSessions.has(sess)) return;
  armedSessions.add(sess);
  const urls = plugins.block.concat([settings.controlPattern]);
  sess.webRequest.onBeforeRequest({ urls }, (details, cb) => {
    if (
      settings.handleControl(details.url, {
        pluginsDir: PLUGINS_DIR,
        themesDir: THEMES_DIR,
        enabledFile: ENABLED_FILE,
        defaultEnabledFile: DEFAULT_ENABLED_FILE,
        activeThemeFile: ACTIVE_THEME_FILE,
        pluginSettingsFile: PLUGIN_SETTINGS_FILE,
        app,
        onTheme: setTheme,
        onPluginSetting: applyAllLive,
      })
    ) {
      cb({ cancel: true });
      return;
    }
    blockedCount++;
    cb({ cancel: true });
  });
}
let blockedCount = 0;

function requestNoti() {
  try {
    if (!Notification.isSupported()) return; // unlikely, but just in case
    const marker = path.join(app.getPath('userData'), '.slick-notif-prompt');
    if (fs.existsSync(marker)) return;
    const n = new Notification({
      title: 'Slick',
      body: 'Notifications are enabled! Manage them in System Settings -> Notifications.',
    });
    n.show();
    fs.writeFileSync(marker, '');
  } catch (e) {
    console.error('[slick-byoe] notification request fail:', e.message);
  }
}

app.whenReady().then(() => {
  perf.mark('app ready');
  armBlocking(session.defaultSession);
  requestNoti();
});

const WORKSPACE_READY_JS = `(() => {
  const SEL = '.p-client_workspace, .p-workspace__primary_view';
  const result = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { readyMs: Math.round(performance.now()), dclMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0 };
  };
  return new Promise((resolve) => {
    if (document.querySelector(SEL)) return resolve(result());
    const mo = new MutationObserver(() => {
      if (!document.querySelector(SEL)) return;
      mo.disconnect();
      resolve(result());
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve(null); }, 120000);
  });
})()`;

let workspaceReady = false;
function watchWorkspaceReady(wc) {
  wc.executeJavaScript(WORKSPACE_READY_JS, true)
    .then((r) => {
      if (!r || workspaceReady) return;
      workspaceReady = true;
      perf.mark(`workspace ready (page: dom-content-loaded ${r.dclMs}ms, workspace ${r.readyMs}ms after nav)`);
      reportPerf();
    })
    .catch(() => {});
}

const live = new Map();
const applyQueue = new WeakMap();

function applyTo(wc) {
  const prev = applyQueue.get(wc) || Promise.resolve();
  const next = prev.then(() => doApplyTo(wc)).catch((e) => console.error('[slick-byoe] applyTo failed:', e.message));
  applyQueue.set(wc, next);
  return next;
}

let perfApplied = false;
async function doApplyTo(wc) {
  if (wc.isDestroyed()) return;
  const track = !perfApplied && wc.getURL().includes('app.slack.com');
  if (track) perfApplied = true;
  const css = fullCss();
  const oldKeys = live.get(wc) || [];
  let newKeys = oldKeys;
  if (css) {
    const endCss = track && perf.span();
    try {
      const key = await wc.insertCSS(css);
      newKeys = [key];
      if (track) endCss(`css injected (${(css.length / 1024).toFixed(1)} kB)`);
    } catch (e) {
      console.error('[slick-byoe] insertCSS failed:', e.message);
      return;
    }
  } else {
    newKeys = [];
  }
  live.set(wc, newKeys);
  for (const k of oldKeys) {
    try {
      await wc.removeInsertedCSS(k);
    } catch (e) {}
  }
  const endJs = track && perf.span();
  const jsDone = [];
  try {
    const cfg = settings.allPluginSettings(PLUGINS_DIR, pluginSettings());
    await wc.executeJavaScript(
      `window.__slickPluginSettings = ${JSON.stringify(cfg)};` +
        `window.dispatchEvent(new CustomEvent('slick:plugin-settings'));`,
      true,
    );
  } catch (e) {
    console.error('[slick-byoe] plugin settings push failed:', e.message);
  }
  for (const js of plugins.js) {
    const p = wc.executeJavaScript(js, true).catch((e) => console.error('[slick-byoe] plugin JS failed:', e.message));
    if (track) jsDone.push(p);
  }
  try {
    const boot = settings.bootstrapScript(
      settings.buildManifest({
        pluginsDir: PLUGINS_DIR,
        themesDir: THEMES_DIR,
        enabled: enabledPlugins(),
        activeTheme: THEME,
        pluginSettings: pluginSettings(),
      }),
    );
    const p = wc
      .executeJavaScript(boot, true)
      .catch((e) => console.error('[slick-byoe] settings UI failed:', e.message));
    if (track) jsDone.push(p);
  } catch (e) {
    console.error('[slick-byoe] settings build failed:', e.message);
  }
  if (track) Promise.all(jsDone).then(() => endJs('plugin js + settings ui injected'));
}

let firstWindow = true;
let clientDomReady = false;
app.on('browser-window-created', (_event, win) => {
  if (firstWindow) {
    firstWindow = false;
    perf.mark('first window created');
  }
  const wc = win.webContents;
  armBlocking(wc.session);
  for (const hook of plugins.windowHooks) {
    try {
      hook(win);
    } catch (e) {
      console.error('[slick-byoe] plugin window hook failed:', e.message);
    }
  }
  wc.on('dom-ready', () => {
    if (!clientDomReady && wc.getURL().includes('app.slack.com')) {
      clientDomReady = true;
      perf.mark('client dom-ready');
    }
    applyTo(wc);
    if (!workspaceReady) watchWorkspaceReady(wc);
  });
  wc.on('did-navigate', () => applyTo(wc));
  wc.on('destroyed', () => live.delete(wc));
});

function applyAllLive() {
  for (const wc of live.keys()) applyTo(wc);
}

function onThemeFileChanged(curr, prev) {
  if (curr.mtimeMs === prev.mtimeMs) return;
  rebuild();
  applyAllLive();
  console.log(`[slick-byoe] hot-reloaded "${theme.name}" (${theme.css.length} bytes) -> ${live.size} window(s)`);
}
function watchTheme() {
  if (!THEME_FILE) return;
  fs.watchFile(THEME_FILE, { interval: 300 }, onThemeFileChanged);
  console.log(`[slick-byoe] watching ${path.basename(THEME_FILE)} for live edits`);
}
watchTheme();

function setTheme(name) {
  const file = name ? path.join(THEMES_DIR, `${name}.json`) : null;
  if (file && !fs.existsSync(file)) {
    console.error(`[slick-byoe] theme not found: ${name}`);
    return;
  }
  if (THEME_FILE) fs.unwatchFile(THEME_FILE, onThemeFileChanged);
  THEME = name || '';
  THEME_FILE = file;
  rebuild();
  watchTheme();
  applyAllLive();
  console.log(`[slick-byoe] theme switched -> "${theme.name || 'none'}" -> ${live.size} window(s)`);
}

if (plugins.block.length) {
  setInterval(() => {
    if (blockedCount) console.log(`[slick-byoe] blocked ${blockedCount} telemetry request(s) so far`);
  }, 30000).unref();
}

console.log(
  `[slick-byoe] armed: theme ${theme.name ? `"${theme.name}" (${theme.css.length} bytes)` : 'none'}` +
    ` + ${plugins.loaded.length} plugin(s): ${plugins.loaded.join(', ') || 'none'}` +
    (plugins.block.length ? ` | blocking ${plugins.block.length} URL pattern(s)` : ''),
);
