@echo off
REM Double-click this ON THE SERVER. It asks for administrator rights, then installs and starts School Store.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-on-server.ps1"
echo.
echo Result file: %~dp0install-result.txt
pause
