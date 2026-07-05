#!/bin/bash
# launch-linux.sh [--debug [port]]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/byoe/slick-linux"
EBIN="$TARGET/electron"
WRAPPER_ASAR="$TARGET/resources/app.asar"

DEBUG=()

if [ "${1:-}" = "--debug" ]; then
  shift
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    DEBUG=(--remote-debugging-port="$1")
    shift
  else
    DEBUG=(--remote-debugging-port=9223)
  fi
fi

SLICK_LAUNCH_T0="$(date +%s%3N 2>/dev/null || echo '')"
export SLICK_LAUNCH_T0

[ -e "$EBIN" ] || {
  echo "BYOE Electron missing, run ./install-linux.sh"
  exit 1
}
[ -f "$WRAPPER_ASAR" ] || {
  echo "Wrapper ASAR missing, run ./install-linux.sh"
  exit 1
}

exec "$EBIN" "${DEBUG[@]}" "$WRAPPER_ASAR" "$@"
