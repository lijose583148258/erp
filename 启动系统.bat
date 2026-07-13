@echo off
chcp 65001 >nul
if /I "%~1"=="dev" goto dev_mode

echo ========================================
echo AilaoDa ERP+CRM safe launcher
echo ========================================
echo.
echo 默认进入正式稳定链:
echo   稳定启动.bat -> scripts\start-stable-v2.ps1 -> http://127.0.0.1:5001
echo.
echo 如需开发模式，请使用:
echo   启动系统.bat dev
echo.
call "%~dp0稳定启动.bat"
goto :eof

:dev_mode
echo ========================================
echo AilaoDa ERP+CRM development launcher
echo ========================================
echo.
echo [警告] 当前进入开发调试链，不作为正式稳定验收入口。
echo [1/5] 安全停止爱牢达监听并清理缓存...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-runtime.ps1"
if errorlevel 1 (
  echo 安全停止失败，请查看上方错误。
  pause
  exit /b 1
)

echo [2/5] 已完成安全清理，不会触碰 5173/5180 或全局 node 进程。

echo [3/5] 启动后端开发服务 (5001)...
cd /d "%~dp0backend"
start "爱劳达-后端开发" cmd /k "set PORT=5001 && npm run dev"
timeout /t 5 >nul

echo [4/5] 启动前端开发服务 (3000)...
cd /d "%~dp0"
start "爱劳达-前端开发" cmd /k "npm run dev"
timeout /t 3 >nul

echo [5/5] 开发链启动完成
echo.
echo ========================================
echo   前端地址: http://localhost:3000
echo   后端地址: http://localhost:5001
echo   登录方式: 使用已创建的本地账号登录
echo ========================================
echo.
echo 请按 Ctrl+Shift+R 强制刷新浏览器。
echo.
pause
