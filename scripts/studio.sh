#!/usr/bin/env bash
#
# Open the studio: `npm run studio`.
#
# The bench needs three things to be true at once — the dev server running, the
# site key readable, and the pipeline checkout next door for renders — and when
# one of them is not, the page fails in a way that looks like a different
# problem. A missing key looks like an authorisation bug; a missing pipeline
# looks like the renders being broken. So they are checked here, once, in the
# order you would debug them.
#
# Port 8770 is not negotiable: the project's CLAUDE.md pins it, the docs quote
# it, and the studio's own /api/ai-* proxy assumes that origin. If something
# else is holding it, this says so rather than quietly drifting to 8771 and
# leaving you on a page that cannot reach its own API.
set -euo pipefail

PORT=8770
URL="http://127.0.0.1:${PORT}/studio.html"
cd "$(dirname "$0")/.."

open_page() {
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  else echo "  open it yourself: $URL"
  fi
}

# Already up? Then this is just "show me the page".
if curl -sf -o /dev/null --max-time 2 "$URL"; then
  echo "studio  the dev server is already up on ${PORT}"
  echo "        ${URL}"
  open_page
  exit 0
fi

# Somebody else on the port. Say who, rather than moving.
holder=$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "${holder}" ]; then
  echo "studio  port ${PORT} is held by PID ${holder}:" >&2
  ps -p "${holder}" -o command= >&2 || true
  echo "        that port is pinned (CLAUDE.md, the docs, and the /api/ai-* proxy all assume it)." >&2
  echo "        stop it and try again:  kill ${holder}" >&2
  exit 1
fi

# The scene leg is proxied to the live functions and signed server-side. Without
# the key the page still judges, plans and renders — all of which are local and
# free — and only the image model refuses, so this warns rather than stops.
if ! grep -qE '^\s*(SITE_LOGIN_KEY|SITE_EXPORT_KEY)\s*=' .env .env.local 2>/dev/null \
   && [ -z "${SITE_LOGIN_KEY:-}" ] && [ -z "${SITE_EXPORT_KEY:-}" ]; then
  echo "studio  no SITE_LOGIN_KEY in .env — judging, angles and renders will work;"
  echo "        putting a render in a room will not. Add it to framework-site/.env."
fi

# Renders shell out to the sibling pipeline. Without it the queue simply never
# starts anything, which is indistinguishable from a slow machine.
if [ ! -d ../framework-renderer ]; then
  echo "studio  ../framework-renderer is not checked out — renders will not run."
fi

echo "studio  ${URL}"
echo "        ctrl-c stops the server. Renders and the scene budget live in the"
echo "        bar at the foot of the page."

# Open the page the moment the server answers, then hand the terminal to the
# server itself so its log — the render queue, the proxy, the decoder — is in
# front of you rather than buried in a pipe.
( for _ in $(seq 1 60); do
    curl -sf -o /dev/null --max-time 1 "$URL" && { open_page; break; }
    sleep 0.5
  done ) &

exec node scripts/dev-builder.mjs
