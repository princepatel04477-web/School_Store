#!/usr/bin/env sh
# Run the store on this computer. Opens http://localhost:5173 when ready.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this again."
  exit 1
fi
[ -d node_modules ] || npm install
npm run dev -- --open
