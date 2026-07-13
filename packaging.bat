@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-stable.ps1"
exit /b %ERRORLEVEL%
