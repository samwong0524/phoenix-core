@echo off
setlocal

set PORT=3456
set LOCAL_MODE=1
set JWT_SECRET=lostudio-dev-secret
set USER_DATA_PATH=%~dp0backend\LOStudio-Fork

echo ============================================
echo   LO Studio - Full Desktop Launcher
echo ============================================
echo   Starting backend server...

start /B node "%~dp0backend\LOStudio-Fork\server.js"

timeout /t 3 /nobreak > nul

netstat -ano | findstr ":%PORT% " >nul
if errorlevel 1 (
    echo   ERROR: Server failed to start on port %PORT%
    pause
    exit /b 1
)

echo   Server running on http://localhost:%PORT%
echo   Opening browser...

msedge --app=http://localhost:%PORT% --window-size=1600,1000 2>nul
if errorlevel 1 (
    start chrome --app=http://localhost:%PORT% --window-size=1600,1000 2>nul
    if errorlevel 1 (
        start http://localhost:%PORT%
    )
)

echo   Done. Server runs in background.
echo   To stop: taskkill /F /IM node.exe /FI "WINDOWTITLE eq server.js*"
endlocal
