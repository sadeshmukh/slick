'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'AnonymiseFileNames',
    description: 'Anonymise uploaded file names',
    version: '1.0.0',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
