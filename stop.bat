@echo off
echo Stopping SWARM IDE dev server...
echo.

REM Find and kill the process on port 3017 (more reliable)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3017 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
    echo Killed process %%a on port 3017
)

REM Fallback: kill node processes by name
taskkill /F /FI "IMAGENAME eq node.exe" /FI "MEMUSAGE gt 200000" 2>nul

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
