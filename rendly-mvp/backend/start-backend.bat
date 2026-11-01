@echo off
REM Starts the full Rendly backend (all services) in this one terminal.
REM Logs stream here; each service prints RUNNING when /health answers 200.
REM Press Ctrl+C to stop everything.

title Rendly Backend
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1"

echo.
echo Backend stopped.
pause
