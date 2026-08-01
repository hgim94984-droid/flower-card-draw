@echo off
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\rebuild-images.ps1"
echo.
pause
