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

echo [5/5] Starting FreeLLMAPI...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo FreeLLMAPI not detected on port 3001. Starting...
    if exist "%USERPROFILE%\freellmapi\.env" (
        powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c cd /d %USERPROFILE%\freellmapi ^&^& npm run dev' -WindowStyle Minimized"
        echo Waiting for FreeLLMAPI to start on port 3001...
        echo Dashboard: http://localhost:5173
        echo Security note: port 3001 is bound to 0.0.0.0 — do not expose to public network.
        :: Wait up to 30s for FreeLLMAPI to respond
        set /a retries=0
        :wait_fl
        powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
        if errorlevel 1 (
            set /a retries+=1
            if %retries% lss 15 (
                timeout /t 2 /nobreak >nul
                goto wait_fl
            ) else (
                echo WARN: FreeLLMAPI did not start after 30s. SWARM IDE may fail if LLM_PROVIDER=freellmapi.
            )
        ) else (
            echo FreeLLMAPI started on port 3001.
        )
    ) else (
        echo WARN: FreeLLMAPI .env not found at %USERPROFILE%\freellmapi\.env
        echo Set LLM_PROVIDER=glm or another provider in .env, or install FreeLLMAPI first.
    )
) else (
    echo FreeLLMAPI is running on port 3001.
)

echo.
echo [6/6] Starting dev server...
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
    echo Opening browser...
    start http://127.0.0.1:3017
    echo.
    echo Server started in background. You can close this window.
    echo To stop: call stop.bat
) else (
    echo Opening browser...
    start http://127.0.0.1:3017
    call npm run dev
    if errorlevel 1 (
        echo.
        echo [ERROR] Server exited with an error.
        pause
        exit /b 1
    )
    pause
)
