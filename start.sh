#!/bin/sh
# macOS / Linux launcher: find Python 3.9+, open the browser, start the server.
# Opens Mochi (web6) by default; another layout: WEB_DIR=web PORT=8787 ./start.sh
# Card art downloads in the background on first start (skip: NO_CARD_FETCH=1).
cd "$(dirname "$0")" || exit 1
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.9 or newer not found. Install it from https://www.python.org/downloads/"
  exit 1
fi
WEB_DIR="${WEB_DIR:-web6}"
PORT="${PORT:-8796}"
export WEB_DIR PORT PYTHONUTF8=1
URL="http://127.0.0.1:$PORT/"
echo "$WEB_DIR  $URL"
(
  sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  fi
) &
exec "$PY" server.py
