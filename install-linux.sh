#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EDIST="$ROOT/byoe/node_modules/electron/dist"
EBIN="$EDIST/electron"
SLACK_PATHS=(
  "${SLICK_SLACK_DIR:-}"
  "/usr/lib/slack"
  "/opt/Slack"
  "/opt/slack"
  "$HOME/.local/share/slack"
)
NO_LAUNCH=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-launch) NO_LAUNCH=1 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

find_slack() {
  local dir
  for dir in "${SLACK_PATHS[@]}"; do
    [ -n "$dir" ] || continue
    [ -f "$dir/resources/app.asar" ] && { printf '%s\n' "$dir"; return 0; }
  done
  return 1
}

parse_version() {
  grep -Eo '[0-9]+[.][0-9]+[.][0-9]+' | head -1
}

electron_version() {
  "$1" --version 2>/dev/null | parse_version
}

slack_electron_version() {
  local slack_dir="$1"
  if [ -f "$slack_dir/version" ]; then
    parse_version <"$slack_dir/version"
    return 0
  fi
  if [ -x "$slack_dir/slack" ]; then
    "$slack_dir/slack" --version 2>/dev/null | parse_version
    return 0
  fi
}

matching_system_electron() {
  local major="$1"
  local bin version
  for bin in "/usr/lib/electron$major/electron" "/usr/lib/electron/electron"; do
    [ -x "$bin" ] || continue
    version="$(electron_version "$bin" || true)"
    [ "${version%%.*}" = "$major" ] && { printf '%s\n' "$bin"; return 0; }
  done
  return 1
}

matching_byoe_electron() {
  local major="$1"
  local version=""
  [ -x "$EBIN" ] || return 1
  [ -f "$EDIST/version" ] && version="$(parse_version <"$EDIST/version")"
  version="${version:-$(electron_version "$EBIN" || true)}"
  [ "${version%%.*}" = "$major" ] || return 1
  printf '%s\n' "$version"
}

step "Checking prerequisites"
[ "$(uname -s)" = "Linux" ] || die "install-linux.sh only supports Linux."
command -v node >/dev/null 2>&1 || die "Node.js 18+ is required."
node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null \
  || die "Node.js 18+ is required (found: $(node -v 2>/dev/null || echo none))."

SLACK="$(find_slack)" || die "Slack not found. Install the official Slack .deb from https://slack.com/downloads/linux, then rerun."
EVER="$(slack_electron_version "$SLACK" || true)"
[ -n "$EVER" ] || die "Could not read Slack's Electron version from $SLACK."
EMAJOR="${EVER%%.*}"
echo "    Slack resources: $SLACK/resources"
echo "    Slack ships Electron $EVER"

if SYS_EBIN="$(matching_system_electron "$EMAJOR")"; then
  step "Found matching system Electron at $SYS_EBIN"
elif HAVE="$(matching_byoe_electron "$EMAJOR")"; then
  step "Electron $HAVE already installed in byoe/"
else
  step "Installing Electron $EVER into byoe/ (~100MB download)"
  cd "$ROOT/byoe"
  npmi() { npm install --no-save --no-package-lock --no-audit --no-fund "$@"; }
  if command -v bun >/dev/null 2>&1; then
    bun add --exact "electron@$EVER" || bun add "electron@$EMAJOR"
  elif command -v npm >/dev/null 2>&1; then
    npmi "electron@$EVER" || npmi "electron@$EMAJOR"
  else
    die "Need bun or npm to install Electron."
  fi
  [ -x "$EBIN" ] || node node_modules/electron/install.js || true
  matching_byoe_electron "$EMAJOR" >/dev/null || die "Electron install failed or did not match major $EMAJOR."
  cd "$ROOT"
fi

step "Building $TARGET"
node "$ROOT/scripts/byoe/build-handoff-linux.js" --target "$TARGET" --force >/dev/null

step "Installing desktop integration"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.local/share/applications"
cp "$ROOT/assets/icon.png" "$HOME/.local/share/icons/hicolor/256x256/apps/slick.png"
cp "$TARGET/slick.desktop" "$HOME/.local/share/applications/dev.slick.byoe.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default dev.slick.byoe.desktop x-scheme-handler/slack || true
else
  echo "    xdg-mime not found; could not register slack:// automatically."
fi

if [ "$NO_LAUNCH" -eq 0 ]; then
  step "Launching Slick"
  "$ROOT/scripts/launch-linux.sh"
fi

printf '\n\033[1;32mYippee!\033[0m Slick is installed at %s\n' "$TARGET"
cat <<EOF
Things to know:
- First launch shows a sign-in screen (separate profile from official Slack). Sign in once; it persists.
- Configure at Preferences -> Slick.
- Manual launch: ./scripts/launch-linux.sh
EOF
