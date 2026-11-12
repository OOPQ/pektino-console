@echo off
setlocal
cd /d "%~dp0"
title pektino console
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\console.ps1" -Root "%~dp0app" -PauseOnError %*
if errorlevel 1 pause
endlocal