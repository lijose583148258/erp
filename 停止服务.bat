@echo off
chcp 65001 >nul
echo ========================================
echo AilaoDa ERP+CRM stop runtime
echo ========================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\stop-runtime.ps1"
pause
