#!/bin/bash
# launch-linux.sh [--debug [port]]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EBIN="$TARGET/electron"
WRAPPER_ASAR="$TARGET/resources/app.asar"
SLACK_ASAR="$TARGET/resources/slack.asar"

DEBUG=()
OZONE=()

if [ "${1:-}" = "--debug" ]; then
  shift
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    DEBUG=(--remote-debugging-port="$1")
    shift
  else
    DEBUG=(--remote-debugging-port=9223)
  fi
fi

if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=wayland)
elif [ -n "${DISPLAY:-}" ]; then
  OZONE=(--ozone-platform=x11)
fi

SLICK_LAUNCH_T0="$(date +%s%3N 2>/dev/null || echo '')"
export SLICK_LAUNCH_T0

[ -e "$EBIN" ] || { echo "BYOE Electron missing, run ./install-linux.sh"; exit 1; }
[ -f "$WRAPPER_ASAR" ] || { echo "Wrapper ASAR missing, run ./install-linux.sh"; exit 1; }
[ -f "$SLACK_ASAR" ] || { echo "Slack ASAR missing, run ./install-linux.sh"; exit 1; }

SVER="$(cat "$TARGET/resources/.electron-version" 2>/dev/null || true)"
REAL_EBIN="$(readlink -f "$EBIN" 2>/dev/null || printf '%s\n' "$EBIN")"
BVER="$("$REAL_EBIN" --version 2>/dev/null | sed -nE 's/^v?([0-9]+[.][0-9]+[.][0-9]+).*$/\1/p' | head -1)"
if [ -n "$SVER" ] && [ -n "$BVER" ] && [ "${SVER%%.*}" != "${BVER%%.*}" ] && [ "${SLICK_FORCE:-}" != "1" ]; then
  echo "REFUSING: Slack Electron major $SVER != BYOE Electron $BVER - native modules would ABI-crash."
  echo "  Re-run ./install-linux.sh to match, or set SLICK_FORCE=1 to try anyway."
  exit 1
fi

exec "$EBIN" "${OZONE[@]}" "${DEBUG[@]}" --no-sandbox "$WRAPPER_ASAR" "$@"
