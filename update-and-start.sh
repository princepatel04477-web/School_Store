#!/usr/bin/env sh
# Get the latest version of the store and open it in your browser.
# One-time setup: install Git and Node.js LTS, then clone this repository.
cd "$(dirname "$0")" || exit 1
command -v git >/dev/null 2>&1 || { echo "Git is not installed: https://git-scm.com"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed: https://nodejs.org"; exit 1; }
echo "Getting the latest version..."
git checkout claude/happy-darwin-53cxjf && git pull origin claude/happy-darwin-53cxjf || exit 1
cd frontend || exit 1
npm install --no-audit --no-fund
npm run dev -- --open
