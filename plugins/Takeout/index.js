'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'Takeout',
    description: 'One stop shop for exporting messages out of Slack.',
  },

  settings: {
    format: {
      type: 'select',
      label: 'Default format',
      description: 'Which format the export modal opens on.',
      default: 'markdown',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'txt', label: 'Plain text' },
      ],
    },
    scope: {
      type: 'select',
      label: 'Default scope',
      description: 'Auto exports the open thread if there is one, otherwise the channel.',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (thread if open, else channel)' },
        { value: 'channel', label: 'Channel' },
        { value: 'thread', label: 'Thread' },
      ],
    },
    includeTimestamps: {
      type: 'boolean',
      label: 'Include timestamps',
      description: 'Show the date and time on each author block.',
      default: true,
    },
    includeMetadataHeader: {
      type: 'boolean',
      label: 'Metadata header',
      description: 'Prepend a title, export time, message count and date range.',
      default: true,
    },
    groupBySender: {
      type: 'boolean',
      label: 'Group by sender',
      description: 'Collapse consecutive messages from the same person into one author block.',
      default: true,
    },
    blockquote: {
      type: 'boolean',
      label: 'Blockquote message text',
      description: 'Render Markdown message bodies as > blockquotes under each author.',
      default: true,
    },
    defaultAction: {
      type: 'select',
      label: 'Primary action',
      description: 'Which modal button is primary and triggered by Enter.',
      default: 'copy',
      options: [
        { value: 'copy', label: 'Copy to clipboard' },
        { value: 'download', label: 'Download file' },
      ],
    },
  },

  css: `
    .slick-takeout-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: 6px;
      color: var(--sk_foreground_high, rgba(232, 232, 232, .9));
      background: transparent;
      cursor: pointer;
    }
    .slick-takeout-trigger:hover {
      background: var(--sk_foreground_min, rgba(255, 255, 255, .1));
    }
    .slick-takeout-trigger:focus-visible {
      outline: 2px solid var(--sk_highlight, #1d9bd1);
      outline-offset: 1px;
    }
    .slick-takeout-trigger--float {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 1200;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--sk_primary_background, #1a1d21);
      box-shadow: 0 4px 14px rgba(0, 0, 0, .4);
    }

    .slick-takeout-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, .45);
    }
    .slick-takeout-dialog {
      box-sizing: border-box;
      width: min(460px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      border-radius: 10px;
      background: rgb(var(--sk_primary_background, 26, 29, 33));
      color: rgb(var(--sk_primary_foreground, 209, 210, 211));
      box-shadow: 0 18px 48px rgba(0, 0, 0, .5);
      border: 1px solid var(--sk_foreground_low, rgba(255, 255, 255, .12));
    }
    .slick-takeout-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px 8px;
    }
    .slick-takeout-head h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      line-height: 1.2;
    }
    .slick-takeout-x {
      border: 0;
      background: transparent;
      color: inherit;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      opacity: .7;
      padding: 0 4px;
    }
    .slick-takeout-x:hover { opacity: 1; }
    .slick-takeout-body {
      padding: 4px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .slick-takeout-section { display: flex; flex-direction: column; gap: 6px; }
    .slick-takeout-legend {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .04em;
      opacity: .7;
    }
    .slick-takeout-segment { display: flex; gap: 8px; flex-wrap: wrap; }
    .slick-takeout-radio,
    .slick-takeout-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    .slick-takeout-check { display: flex; }
    .slick-takeout-radio input,
    .slick-takeout-check input { accent-color: var(--sk_highlight, #1d9bd1); margin: 0; }
    .slick-takeout-num {
      box-sizing: border-box;
      width: 64px;
      height: 28px;
      padding: 0 6px;
      border-radius: 4px;
      border: 1px solid rgba(127, 127, 127, .45);
      background: var(--sk_primary_background, rgba(0, 0, 0, .2));
      color: inherit;
      font: inherit;
    }
    .slick-takeout-hint { font-size: 12px; opacity: .65; }
    .slick-takeout-summary {
      font-size: 13px;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--sk_foreground_min, rgba(255, 255, 255, .06));
    }
    .slick-takeout-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 18px 16px;
    }
    .slick-takeout-btn {
      border: 1px solid rgba(127, 127, 127, .5);
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 700;
      padding: 7px 16px;
      border-radius: 6px;
      cursor: pointer;
    }
    .slick-takeout-btn:hover { background: rgba(127, 127, 127, .16); }
    .slick-takeout-btn--primary {
      background: var(--sk_highlight, #1264a3);
      border-color: var(--sk_highlight, #1264a3);
      color: #fff;
    }
    .slick-takeout-btn--primary:hover { filter: brightness(1.08); background: var(--sk_highlight, #1264a3); }

    #slick-takeout-toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%) translateY(16px);
      z-index: 2147483600;
      max-width: 80vw;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 14px;
      color: #fff;
      background: rgba(28, 30, 34, .96);
      border: 1px solid rgba(255, 255, 255, .14);
      box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
      opacity: 0;
      pointer-events: none;
      transition: opacity .18s ease, transform .18s ease;
    }
    #slick-takeout-toast[data-state="ok"] { border-color: var(--sk_highlight, #1d9bd1); }
    #slick-takeout-toast[data-state="err"] { border-color: #e01e5a; }
    #slick-takeout-toast.slick-takeout-toast--show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `,

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
