@echo off
REM Double-click ON THE SERVER to put the latest code from GitHub live:
REM pulls main, installs packages, migrates the database, restarts the store.
REM The Cloudflare tunnel keeps running, so the public link stays the same.
cd /d "%~dp0"
powershell -NoProfile -Command "if ((Get-PSDrive -Name '%~d0'.TrimEnd(':')).DisplayRoot) { exit 1 }"
if errorlevel 1 (
  echo.
  echo This file is on a network drive, so this is not the server.
  echo Open it on the server computer itself, from E:\Projects\School_Store.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy.ps1"
echo.
echo Done. You can close this window.
pause
