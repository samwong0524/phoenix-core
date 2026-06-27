@echo off
echo Starting llama.cpp server with Qwen3-14B Q8_0 model (GPU accelerated)...
echo.

set LLAMA_DIR=E:\llama-b9515-bin-win-cuda-13.3-x64
set MODEL=%LLAMA_DIR%\models\Qwen3-14B-Q8_0.gguf
set HOST=127.0.0.1
set PORT=8080
set CTX=65536

"%LLAMA_DIR%\llama-server.exe" ^
    --model "%MODEL%" ^
    --host %HOST% ^
    --port %PORT% ^
    --ctx-size %CTX% ^
    --threads 8 ^
    --threads-batch 8 ^
    -ngl 999 ^
    --flash-attn ^
    --jinja ^
    --slot-save-path "%LLAMA_DIR%\sessions" ^
    --verbose

pause
