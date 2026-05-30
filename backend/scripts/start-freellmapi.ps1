# start-freellmapi.ps1 — Start FreeLLMAPI and wait for it to be ready
$url = 'http://127.0.0.1:3001/api/health'
$flDir = "$env:USERPROFILE\freellmapi"

# Check if already running
try {
    Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing | Out-Null
    Write-Host 'FreeLLMAPI running on 3001.'
    Start-Process 'http://localhost:5173'
    exit 0
} catch {}

# Check if installed
if (-not (Test-Path "$flDir\.env")) {
    Write-Host 'FreeLLMAPI not installed. Set LLM_PROVIDER=glm in .env or install FreeLLMAPI.'
    exit 0
}

# Start FreeLLMAPI
Write-Host 'Starting FreeLLMAPI...'
$flDir = Join-Path $env:USERPROFILE 'freellmapi'
Start-Process -FilePath 'cmd.exe' -ArgumentList "/c", "cd /d `"$flDir`" && npm run dev" -WindowStyle Minimized

# Wait for it to be ready (max 30s)
Write-Host 'Waiting up to 30s...'
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep 2
    try {
        Invoke-WebRequest -Uri $url -TimeoutSec 1 -UseBasicParsing | Out-Null
        Write-Host 'FreeLLMAPI started on port 3001.'
        Start-Process 'http://localhost:5173'
        exit 0
    } catch {}
}

Write-Host 'WARN: FreeLLMAPI did not start after 30s.'
