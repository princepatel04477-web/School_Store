@echo off
REM Double-click this ON THE SERVER. Asks for administrator rights, installs School Store and publishes the permanent link.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-public-link.ps1"
echo.
echo Result file: %~dp0public-link-result.txt
pause
