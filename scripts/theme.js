'use strict';

const fs = require('fs');
const path = require('path');

function buildSpec(themePath) {
  const t = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  const vars = {};
  for (const [ramp, shades] of Object.entries(t.palette || {}))
    for (const [shade, v] of Object.entries(shades)) vars[`--dt_color-plt-${ramp}-${shade}`] = String(v);
  for (const [k, v] of Object.entries(t.sidebar || {})) vars[`--p-team_sidebar__${k}`] = String(v);
  Object.assign(vars, t.vars || {});
  return {
    name: t.name || path.basename(themePath, '.json'),
    vars,
    css: Array.isArray(t.css) ? t.css.join('\n') : t.css || '',
  };
}

module.exports = { buildSpec };
