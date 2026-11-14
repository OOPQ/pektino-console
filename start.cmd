@echo off
setlocal
cd /d "%~dp0"
title pektino console
rem 先关掉旧的 console/media 进程和旧 cmd 窗口，避免重复启动越堆越多
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\dev\stop-console.ps1" -AppRoot "%~dp0app" -Port 8791 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\console.ps1" -Root "%~dp0app" %*
rem 控制台退出后直接关窗口，不再 pause 留一个空 cmd
endlocal
