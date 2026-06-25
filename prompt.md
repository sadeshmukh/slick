# Handoff: basic Linux support for Slick

## Mission

Add **basic Linux support** to Slick (the BYOE Slack mod). This work resumes the
closed PR [#10 "feat: support for my penguin peeps"](https://github.com/3kh0/slick/pull/10)
by @matmanna, which got Slick running on Arch + niri. That PR was closed because
the repo history was rewritten and other things changed underneath it, so **you
cannot just apply the old diff** — you must re-implement its approach on top of
the _current_ `main`.

Keep the change **minimal and surgical**. Mirror the existing macOS/Windows
patterns. Do not refactor unrelated code, do not "improve" the mac/win paths.

The commit(s) MUST credit the original author:

```
Co-authored-by: matmanna <matmanna@users.noreply.github.com>
```

But dont worry, I will commit it, you just need to implement the Linux support.

## How Slick works (read first)

Slick runs Slack's own `app.asar` under a Bring-Your-Own-Electron (BYOE) binary
with a custom `--require` preload (`scripts/byoe/inject.js`) that injects themes
and plugins. No Slack files are modified, so auto-updates keep working.

Current platform layout:

- **macOS**: `install.sh` → `scripts/byoe/build-handoff-app.js` → builds
  `~/Applications/Slick.app`; launched via `open` / `scripts/launch-byoe.sh`.
- **Windows**: `install.ps1` → `scripts/byoe/build-handoff-app-win.js`.
- **Shared injection/runtime** (platform-agnostic, reused as-is on Linux):
  `scripts/byoe/inject.js`, `login-handoff.js`, `plugins.js`, `settings-*.js`,
  `switches.js`, `perf.js`, `internals/`, `scripts/theme.js`.

Linux follows the **same shape**: a builder produces a small wrapper whose
`index.js` sets `userData`, points `app.getAppPath()` at Slack's real asar, then
`require`s `login-handoff.js`, `inject.js`, and finally Slack's asar.

## Test environment (already set up) — READ THE ARM64 CAVEAT

- Host: macOS (Apple Silicon). Guest: **Debian 12, `arm64`/aarch64** in Parallels,
  reachable as `ssh slick-vm` (user `parallels`, `10.211.55.5`). Key auth +
  `~/.ssh/config` alias are done. `sudo` is passwordless.
- Run commands in the VM with: `ssh slick-vm '<cmd>'`. The VM starts bare — you
  must install `git`, `nodejs`/`npm` (Node 18+) yourself
  (`sudo apt install -y git nodejs npm`).
- The Mac repo is shared into the VM at `/media/psf/Home/Documents/GitHub/slick`
  (Parallels shared folder), so you can edit on the host and run in the guest.
  If the psf mount is slow or causes node/electron issues, `git clone` into the
  guest instead and sync.

### ⚠️ arm64 limits what you can verify here

**Slack ships an x86_64 (amd64) Linux build only — there is NO official arm64
Slack.** Apple-Silicon Parallels can only run arm64 guests, so this VM cannot
install official Slack, and Slick BYOEs Slack's own `app.asar` (whose native
modules are x86_64). Therefore:

- ✅ Use this VM for **build-level verification**: electron has arm64 npm builds,
  so `install-linux.sh` → `build-handoff-linux.js` should run, the asar packing,
  path probing, desktop-file/icon install, lint/shellcheck, and `npm run check`
  can all be exercised. To exercise the Slack-found path without real Slack, you
  may point the probes at a dummy `resources/app.asar` you create, OR extract an
  amd64 Slack `app.asar` for asar-handling tests (it will NOT run correctly).
- ❌ **Do NOT claim end-to-end success from this VM.** The real launch / sign-in /
  "auth loop fixed" test REQUIRES an **x86_64 Linux** environment (cloud VM,
  Intel box, or x86 emulation). GUI launch also needs the Parallels desktop
  session, not the SSH shell (SSH has no `$DISPLAY`).

If the user provides an x86_64 Linux host, do the full runtime test there:
install official Slack (`/usr/lib/slack/resources/app.asar`), `./install-linux.sh`,
sign in, confirm no auth-redirect loop, themes/plugins load. Report which checks
ran on arm64 (build-level) vs x86_64 (runtime).

## Deliverables

Create these three new files and make two small platform-guarded edits. The PR's
original versions are included below as **reference** — adapt them to current
`main`, don't paste blindly. Note the PR targeted Arch (`pacman`/AUR,
`/usr/lib/electron42`); our test box is Debian, so messaging/paths should be
distro-agnostic where reasonable (still probe the same locations).

### 1. `scripts/byoe/build-handoff-linux.js` (new)

Node builder, sibling to `build-handoff-app.js`. Responsibilities:

- Locate Slack: probe `/usr/lib/slack`, `/opt/Slack`, `/opt/slack`,
  `$HOME/.local/share/slack` for `resources/app.asar`.
- Determine Slack's Electron version (read `<slackdir>/version`, fall back to
  `<slackdir>/slack --version`).
- Find a matching-major Electron: probe system `/usr/lib/electron<major>` and
  `/usr/lib/electron`, then fall back to `byoe/node_modules/electron/dist`.
  ABI must match Slack's Electron **major** or native modules crash.
- Build the wrapper dir (default `byoe/slick-linux/`):
  - symlink `electron` → chosen binary,
  - copy Slack's `app.asar` → `resources/slack.asar` (+ `app.asar.unpacked` →
    `slack.asar.unpacked` if present),
  - write `resources/.electron-version` (for the launcher ABI check),
  - pack a tiny wrapper `resources/app.asar` whose `index.js` sets
    `userData` to `~/.config/slick`, redefines `process.resourcesPath`,
    overrides `app.getAppPath()` → the real `slack.asar`, then requires
    `login-handoff.js`, `inject.js`, and `slack.asar`,
  - write a `slick.desktop` entry (`Exec=<repo>/scripts/launch-linux.sh %U`,
    `Icon=slick`, `MimeType=x-scheme-handler/slack;`).
- Print a JSON summary like the mac builder.

### 2. `scripts/launch-linux.sh` (new)

Launcher, sibling to `scripts/launch-byoe.sh`. Responsibilities:

- Resolve `byoe/slick-linux/{electron,resources/app.asar,resources/slack.asar}`,
  bail with a helpful message if missing.
- Pick `--ozone-platform=wayland` when `$WAYLAND_DISPLAY` is set, else `x11`
  when `$DISPLAY` is set.
- ABI check: compare `resources/.electron-version` major vs the resolved
  electron binary `--version` major; refuse on mismatch unless `SLICK_FORCE=1`.
- Support `--debug [port]` → `--remote-debugging-port` (default 9223).
- `exec` the electron binary with `--no-sandbox --require <repo>/scripts/byoe/inject.js`
  and the wrapper asar, forwarding `slack://` args.

### 3. `install-linux.sh` (new)

One-step installer, sibling to `install.sh`. Responsibilities:

- Guard `uname -s` = Linux; require Node 18+.
- Find Slack (same probe list); error with install hint if missing.
- Find/install matching Electron (system first; else `bun add`/`npm install`
  the exact version into `byoe/`).
- Run `build-handoff-linux.js --target byoe/slick-linux --force`.
- Install icon → `~/.local/share/icons/hicolor/256x256/apps/slick.png`.
- Install desktop file → `~/.local/share/applications/dev.slick.byoe.desktop`,
  run `update-desktop-database`.
- Register `slack://` handler via `xdg-mime default dev.slick.byoe.desktop x-scheme-handler/slack`.
- `--no-launch` flag; otherwise launch via `scripts/launch-linux.sh`.

### 4. `scripts/byoe/login-handoff.js` (edit — platform guard)

Currently only registers the `slack://` protocol on `darwin`. Add a `linux`
branch that:

- takes `app.requestSingleInstanceLock()` (quit if not acquired),
- on `second-instance` and `open-url`, focuses an existing window,
- calls `registerSlackProtocol(originalSetDefault)`.

(PR also widened an arg filter from `isEphemeralArg` to just `isSlackUrl`;
evaluate whether that's still needed against current code — only change it if it
actually fixes the Linux auth path.)

### 5. `scripts/byoe/inject.js` (edit — platform guard)

Add a `process.platform === 'linux'` block near the top that fixes the auth
loop: strip any `slack://` arg from `process.argv` and patch
`shell.openExternal` to swallow `slack://` URLs (so the OAuth callback is handled
in-app instead of bouncing to the default handler). Do **not** add the noisy
`SLICK_DBG` logging from the PR unless you find you need it for debugging; keep
the committed diff clean.

## Constraints & validation

- Don't touch the macOS or Windows code paths beyond what's strictly required.
- Match existing code style. Run `npm run check` on the host (oxfmt + oxlint +
  shellcheck + validate) and fix everything before committing. New shell scripts
  must pass `shellcheck -S warning`; mark executable (`chmod +x`).
- **Functionally verify in the VM**, don't just compile:
  1. `ssh slick-vm 'cd <repo> && ./install-linux.sh --no-launch'` builds cleanly.
  2. `ssh slick-vm 'cd <repo> && ./scripts/launch-linux.sh'` (with a display)
     launches Slick, you can **sign in**, and the auth redirect does **not**
     loop. (First launch needs a fresh sign-in — expected, the new signature
     can't decrypt Slack's existing session.)
  3. Themes/plugins load and Preferences → Slick tab works.
- Report what you tested, what worked, and any distro caveats (Wayland vs X11,
  sandbox, electron availability on Debian vs Arch).

## Docs

Update `README.md` with a short **Linux (beta)** section mirroring the Windows
one: prerequisites (official Slack `.deb`), `./install-linux.sh`, manual launch,
and known limitations. Keep it brief.

## Reference: original PR #10 implementations

> Adapt to current `main`; paths/versions may differ. Fetch the full closed-PR
> diff if needed: `curl -fsSL https://github.com/3kh0/slick/pull/10.diff`.

### `scripts/byoe/build-handoff-linux.js` (PR original)

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const LINUX_SLACK_PATHS = ['/usr/lib/slack', '/opt/Slack', '/opt/slack', `${process.env.HOME}/.local/share/slack`];

const SYSTEM_ELECTRON_DIRS = [
  '/usr/lib/electron42',
  '/usr/lib/electron41',
  '/usr/lib/electron39',
  '/usr/lib/electron38',
  '/usr/lib/electron',
];

const DEFAULTS = { target: path.join(ROOT, 'byoe', 'slick-linux'), force: false };

function findSlack() {
  for (const p of LINUX_SLACK_PATHS) {
    const asar = path.join(p, 'resources', 'app.asar');
    if (fs.existsSync(asar)) return p;
  }
  return null;
}

function getElectronVersion(slackDir) {
  const versionFile = path.join(slackDir, 'version');
  if (fs.existsSync(versionFile)) return fs.readFileSync(versionFile, 'utf8').trim();
  const bin = path.join(slackDir, 'slack');
  if (fs.existsSync(bin)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/);
    if (m) return m[1];
  }
  return null;
}

function findBestElectron(slackMajor) {
  for (const dir of SYSTEM_ELECTRON_DIRS) {
    const bin = path.join(dir, 'electron');
    if (!fs.existsSync(bin)) continue;
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (ver.stdout || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (m && m[1] === String(slackMajor)) {
      return { bin, version: `${m[1]}.${m[2]}.${m[3]}`, source: 'system' };
    }
  }
  const npmBin = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'electron');
  if (fs.existsSync(npmBin)) {
    const ver = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'version');
    const v = fs.existsSync(ver) ? fs.readFileSync(ver, 'utf8').trim() : null;
    if (v && v.split('.')[0] === String(slackMajor)) return { bin: npmBin, version: v, source: 'npm' };
  }
  return null;
}

// packAsar(): minimal asar writer — header (uint32 magic=4, sizes) + JSON dir + blobs.
// Wrapper index.js: app.setPath('userData', ~/.config/slick); redefine
// process.resourcesPath; app.getAppPath = () => SLACK_ASAR; then require
// login-handoff.js, inject.js, slack.asar. Build dir contains:
//   electron (symlink), resources/{slack.asar,.electron-version,app.asar}, slick.desktop
```

### `scripts/launch-linux.sh` (PR original)

```bash
#!/bin/bash
# launch-linux.sh [--debug [port]] — launch Slick on Linux (Wayland/X11)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EBIN="$TARGET/electron"
WRAPPER_ASAR="$TARGET/resources/app.asar"
SLACK_ASAR="$TARGET/resources/slack.asar"

DEBUG=()
OZONE=()
[ "${1:-}" = "--debug" ] && DEBUG=(--remote-debugging-port="${2:-9223}")

if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=wayland)
elif [ -n "${DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=x11)
fi

[ -f "$EBIN" ] || { echo "BYOE Electron missing, run ./install-linux.sh"; exit 1; }
[ -f "$WRAPPER_ASAR" ] || { echo "Wrapper ASAR missing, run ./install-linux.sh"; exit 1; }
[ -f "$SLACK_ASAR" ] || { echo "Slack ASAR missing, run ./install-linux.sh"; exit 1; }

SVER_FILE="$TARGET/resources/.electron-version"
SVER=$(cat "$SVER_FILE" 2>/dev/null || true)
REAL_EBIN=$(readlink -f "$EBIN" 2>/dev/null || echo "$EBIN")
BVER=$("$REAL_EBIN" --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || true)
if [ -n "$SVER" ] && [ -n "$BVER" ] && [ "${SVER%%.*}" != "${BVER%%.*}" ] && [ "${SLICK_FORCE:-}" != "1" ]; then
  echo "REFUSING: Slack Electron major $SVER != BYO Electron $BVER — native modules would ABI-crash."
  echo "  Re-run ./install-linux.sh to match, or set SLICK_FORCE=1 to try anyway."
  exit 1
fi

if [ $# -eq 0 ]; then
  pkill -f "slick-linux/electron" 2>/dev/null || true
  for _ in {1..20}; do pgrep -f "slick-linux/electron" >/dev/null 2>&1 || break; sleep 0.25; done
fi

exec "$EBIN" "${OZONE[@]}" "${DEBUG[@]+"${DEBUG[@]}"}" --no-sandbox --require "$ROOT/scripts/byoe/inject.js" "$WRAPPER_ASAR" "$@"
```

### `scripts/byoe/inject.js` (PR auth-loop fix)

```js
if (process.platform === 'linux') {
  const authUrl = process.argv.find((a) => /^slack:/i.test(a));
  if (authUrl) process.argv = process.argv.filter((a) => !/^slack:/i.test(a));

  const { shell } = electron;
  const origOpenExternal = shell.openExternal.bind(shell);
  shell.openExternal = function patchedOpenExternal(url, ...rest) {
    if (/^slack:/i.test(url)) return Promise.resolve();
    return origOpenExternal(url, ...rest);
  };
}
```

### `scripts/byoe/login-handoff.js` (PR platform branch)

```js
if (process.platform === 'linux') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const { BrowserWindow } = require('electron');
      for (const w of BrowserWindow.getAllWindows())
        if (!w.isDestroyed()) {
          w.focus();
          return;
        }
    });
    app.on('open-url', () => {
      const { BrowserWindow } = require('electron');
      for (const w of BrowserWindow.getAllWindows())
        if (!w.isDestroyed()) {
          w.focus();
          return;
        }
    });
    registerSlackProtocol(originalSetDefault);
  }
} else if (process.platform === 'darwin') {
  registerSlackProtocol(originalSetDefault);
}
```

The full `install-linux.sh` reference is in the PR diff (`curl` it as above).
