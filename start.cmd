@echo off
setlocal
cd /d "%~dp0"
title pektino console
rem 只有显式 -Restart 才先停旧实例；普通双击交给 console.ps1 判活后直接开浏览器，
rem 避免下载进行中双击一下就把控制台和下载进程一起杀掉。
set "RESTART="
for %%A in (%*) do if /I "%%~A"=="-Restart" set "RESTART=1"
if defined RESTART powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\dev\stop-console.ps1" -AppRoot "%~dp0app" -Port 8791 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\console.ps1" -Root "%~dp0app" %*
rem 控制台退出后直接关窗口，不再 pause 留一个空 cmd
endlocal
