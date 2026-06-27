@echo off
echo Starting llama.cpp server with Qwen3.6-35B model...
echo.

set LLAMA_DIR=E:\llama-b9515-bin-win-cuda-13.3-x64
set MODEL=%LLAMA_DIR%\models\Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf
set HOST=127.0.0.1
set PORT=8080
set CTX=8192

"%LLAMA_DIR%\llama-server.exe" ^
    --model "%MODEL%" ^
    --host %HOST% ^
    --port %PORT% ^
    --ctx-size %CTX% ^
    --threads 8 ^
    --threads-batch 8 ^
    --flash-attn ^
    --jinja ^
    --slot-save-path "%LLAMA_DIR%\sessions" ^
    --verbose

pause
