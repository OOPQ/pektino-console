@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scrape-smoke.ps1" %*
