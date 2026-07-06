#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/byoe/slick-linux"
PROFILE="$HOME/.config/slick"
DESKTOP_FILE="$HOME/.local/share/applications/dev.slick.byoe.desktop"
ICON_FILE="$HOME/.local/share/icons/hicolor/256x256/apps/slick.png"
FAIL=0

step() { printf '\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }

[ "$(uname -s)" = "Linux" ] || { echo "error: uninstall-linux.sh only supports Linux." >&2; exit 1; }

step "Stopping Slick"
pkill -f "$TARGET/electron" 2>/dev/null || true
for _ in {1..20}; do
  pgrep -f "$TARGET/electron" >/dev/null 2>&1 || break
  sleep 0.25
done
if pgrep -f "$TARGET/electron" >/dev/null 2>&1; then
  warn "some Slick processes are still running"
  FAIL=1
fi

step "Restoring slack:// to official Slack"
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default slack.desktop x-scheme-handler/slack \
    && echo "    slack:// now opens the official Slack again." \
    || { warn "could not restore the slack:// handler"; FAIL=1; }
else
  warn "xdg-mime not found; could not restore the slack:// handler"
  FAIL=1
fi

step "Removing desktop integration"
rm -f "$DESKTOP_FILE" "$ICON_FILE"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

step "Removing Slick"
rm -rf "$TARGET" "$TARGET.old"

step "Purging Slick data"
rm -rf "$PROFILE"
find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'slick-update-*' -exec rm -rf {} + 2>/dev/null || true

if [ "$FAIL" -ne 0 ]; then
  warn "Slick was partially removed, see the warnings above."
  exit 1
fi

printf '\n\033[1;32mSlick has been fully removed.\033[0m\n'
