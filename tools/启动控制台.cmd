@echo off
setlocal
cd /d "%~dp0"
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
echo.
echo   Starting pektino console ...
echo.
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0console.ps1" -PauseOnError %*
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" echo   Console exited with code %RC%. See out\console.log for details.
pause
