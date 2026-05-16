@echo off
cd /d "%~dp0backend"

if not exist .env (
    echo [WARN] .env not found, copying .env.example...
    copy .env.example .env >nul
    echo [WARN] Please edit .env with your actual values before continuing.
    pause
    exit /b 1
)

echo [1/2] Checking PostgreSQL...
psql --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PostgreSQL client not found. Make sure PostgreSQL is running.
    pause
    exit /b 1
)

echo [2/2] Starting SWARM IDE dev server...
echo Server will be available at http://127.0.0.1:3017
echo.
call npm run dev
