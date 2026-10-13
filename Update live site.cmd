@echo off
REM Double-click ON THE SERVER to put the latest code from GitHub live:
REM pulls main, installs packages, migrates the database, restarts the store.
REM The Cloudflare tunnel keeps running, so the public link stays the same.
cd /d "%~dp0"
powershell -NoProfile -Command "if ((Get-PSDrive -Name '%~d0'.TrimEnd(':')).DisplayRoot) { exit 1 }"
if errorlevel 1 goto notserver
REM The server keeps its runtime (Python, Postgres, Node) two folders up, e.g. E:\runtime
if not exist "%~dp0..\..\runtime\env.ps1" goto notserver
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\deploy.ps1"
if errorlevel 1 (
  echo.
  echo The update did NOT finish. Read the red message above, or send a photo of this window.
  echo.
  pause
  exit /b 1
)
echo.
echo Done. The store is updated. You can close this window.
pause
exit /b 0

:notserver
echo.
echo This is not the store server, so nothing was changed.
echo Open this file on the server computer itself, from E:\Projects\School_Store.
echo.
pause
exit /b 1
