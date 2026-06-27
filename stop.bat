@echo off
echo Stopping SWARM IDE dev server...
echo.

REM Kill SWARM IDE process on port 3100
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3100 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
    echo Killed SWARM IDE process %%a on port 3100
)

REM Stop FreeLLMAPI if running
echo Stopping FreeLLMAPI (if running)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
    echo Killed FreeLLMAPI process %%a on port 3001
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
    echo Killed FreeLLMAPI dashboard process %%a on port 5173
)

echo Done.
