@echo off
REM Double-click to get the latest version of the store and open it in your browser.
REM One-time setup: install Git (https://git-scm.com) and Node.js LTS (https://nodejs.org), then clone this repository.
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Download it from https://git-scm.com, install it, then double-click this file again.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b 1
)
echo Getting the latest version...
git checkout claude/happy-darwin-53cxjf
git pull origin claude/happy-darwin-53cxjf
cd frontend
echo Installing anything new...
call npm install --no-audit --no-fund
echo Starting. Your browser will open by itself.
call npm run dev -- --open
pause
