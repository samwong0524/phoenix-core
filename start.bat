@echo off
chcp 65001 >nul 2>&1

pushd "%~dp0backend"
if errorlevel 1 (
    echo [ERROR] Cannot change to backend directory
    pause
    exit /b 1
)

echo [1/5] Checking .env...
if not exist .env (
    echo .env not found, copying .env.example...
    copy .env.example .env >nul
    if not exist .env (
        echo [ERROR] Failed to create .env
        pause
        exit /b 1
    )
    echo .env created. Please edit it with your actual values.
    echo.
    type .env
    echo.
    pause
    exit /b 1
)
echo .env found.

echo [2/5] Checking node_modules...
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)
echo node_modules ready.

echo [3/5] Checking PostgreSQL...
where psql >nul 2>&1
if errorlevel 1 (
    echo WARN: psql not in PATH. Make sure PostgreSQL is running.
) else (
    echo PostgreSQL client found.
)

echo [4/5] Checking Redis...
where redis-cli >nul 2>&1
if errorlevel 1 (
    echo WARN: redis-cli not in PATH. Make sure Redis is running.
) else (
    redis-cli ping >nul 2>&1
    if errorlevel 1 (
        echo WARN: Redis not responding. Make sure Redis is running.
    ) else (
        echo Redis is running.
    )
)

echo [5/5] Starting dev server...
if exist .next (
    rmdir /s /q .next 2>nul
)
echo.
echo Server: http://127.0.0.1:3017
echo.
echo [1] Run in foreground (window stays open)
echo [2] Run in background (window minimized, close this to detach)
echo.
set /p mode="Choose mode (1/2, default 1): "

if "%mode%"=="2" (
    echo Starting in background...
    echo Logs: backend\dev-server.log
    echo.
    powershell -NoProfile -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev ^> dev-server.log 2^> dev-server-error.log' -WindowStyle Hidden -PassThru -WorkingDirectory '%CD%'; Start-Sleep -Seconds 3; Write-Host ('PID: ' + $p.Id); Get-Content dev-server.log -Tail 5 2>$null"
    echo.
    echo Server started in background. You can close this window.
    echo To stop: call stop.bat
) else (
    call npm run dev
    if errorlevel 1 (
        echo.
        echo [ERROR] Server exited with an error.
        pause
        exit /b 1
    )
    pause
)
