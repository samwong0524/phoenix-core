@echo off
echo Stopping SWARM IDE dev server...
echo.

REM Kill node processes running next dev
taskkill /F /FI "WINDOWTITLE eq npm run dev" 2>nul
taskkill /F /FI "IMAGENAME eq node.exe" /FI "MEMUSAGE gt 200000" 2>nul

echo Done.
