@echo off
chcp 65001 >nul
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-stable-v2.ps1"
if errorlevel 1 (
  echo 稳定启动失败，请查看上方错误。
  pause
  exit /b 1
)
echo.
echo 正在打开爱牢达稳定入口: http://127.0.0.1:5001/
start "" "http://127.0.0.1:5001/"
pause
