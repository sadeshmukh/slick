'use strict';

const fs = require('fs');
const path = require('path');
const { buildSpec } = require('../theme.js');
const { pluginDirs } = require('../byoe/plugins.js');

const ROOT = path.join(__dirname, '..', '..');
const errs = [];
const fail = (f, msg) => errs.push(`${f}: ${msg}`);

const THEMES = path.join(ROOT, 'themes');
const themes = fs.readdirSync(THEMES).filter((f) => f.endsWith('.json'));
for (const f of themes) {
  const p = path.join(THEMES, f);
  let t;
  try {
    t = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(f, `invalid JSON: ${e.message}`);
    continue;
  }

  if (!t.name || typeof t.name !== 'string') fail(f, '"name" must be a non-empty string');
  for (const [ramp, shades] of Object.entries(t.palette || {}))
    for (const [shade, v] of Object.entries(shades))
      if (!/^\d{1,3},\d{1,3},\d{1,3}$/.test(String(v)))
        fail(f, `palette.${ramp}.${shade} must be raw "r,g,b", got: ${v}`);
  for (const [k, v] of Object.entries({ ...t.sidebar, ...t.vars }))
    if (typeof v !== 'string') fail(f, `"${k}" must be a string`);
  if (t.css && typeof t.css !== 'string' && !Array.isArray(t.css)) fail(f, '"css" must be a string or array');
  try {
    buildSpec(p);
  } catch (e) {
    fail(f, `buildSpec threw: ${e.message}`);
  }
}

const PLUGINS = path.join(ROOT, 'plugins');
const dirs = pluginDirs(PLUGINS);
for (const d of dirs) {
  let m;
  try {
    m = require(path.join(PLUGINS, d, 'index.js'));
  } catch (e) {
    fail(`plugins/${d}`, `index.js failed to load: ${e.message}`);
    continue;
  }

  for (const k of ['name', 'description', 'version']) if (!m.meta?.[k]) fail(`plugins/${d}`, `missing meta.${k}`);
  if (m.main && typeof m.main !== 'function') fail(`plugins/${d}`, '"main" must be a function');
  if (!m.main && !m.css && !m.renderer) fail(`plugins/${d}`, 'exports none of main/css/renderer');
}

try {
  const list = JSON.parse(fs.readFileSync(path.join(PLUGINS, 'enabled.json'), 'utf8'));
  if (!Array.isArray(list)) fail('plugins/enabled.json', 'must be an array');
  else for (const n of list) if (!dirs.includes(n)) fail('plugins/enabled.json', `unknown plugin "${n}"`);
} catch (e) {
  fail('plugins/enabled.json', e.message);
}

if (errs.length) {
  console.error(errs.join('\n'));
  process.exit(1);
}
console.log(`ok: ${themes.length} themes, ${dirs.length} plugins`);
