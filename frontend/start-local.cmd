@echo off
REM Double-click to run the store on this computer. Opens http://localhost:5173 when ready.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing, this takes a minute the first time...
  call npm install
)
call npm run dev -- --open
pause
