@'
╔══════════════════════════════════════════╗
║        SWARM IDE — 一键安装脚本          ║
╚══════════════════════════════════════════╝
'@ | Write-Host

# Check Node.js
try {
    $nodeVer = node --version
    Write-Host "[✓] Node.js $nodeVer"
} catch {
    Write-Host "[✗] Node.js not found — install from https://nodejs.org (v18+)"
    exit 1
}

# Check npm
try {
    $npmVer = npm --version
    Write-Host "[✓] npm v$npmVer"
} catch {
    Write-Host "[✗] npm not found"
    exit 1
}

# Check PostgreSQL
try {
    $psqlVer = psql --version
    Write-Host "[✓] $psqlVer"
} catch {
    Write-Host "[!] PostgreSQL not detected — install from https://postgresql.org"
    Write-Host "    Or set DATABASE_URL in .env to point to a remote PostgreSQL instance"
}

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND = Join-Path $ROOT "backend"

Write-Host "`n[1/3] Installing backend dependencies..."
Set-Location $BACKEND
npm install --loglevel=warn
if ($LASTEXITCODE -ne 0) {
    Write-Host "[✗] npm install failed"
    exit 1
}
Write-Host "[✓] Dependencies installed"

# Create .env if not exists
$envFile = Join-Path $BACKEND ".env"
$envExample = Join-Path $BACKEND ".env.example"
if (-not (Test-Path $envFile)) {
    Write-Host "`n[2/3] Creating .env from .env.example..."
    Copy-Item $envExample $envFile

    # Prompt for LLM provider
    Write-Host "`nChoose an LLM provider:"
    Write-Host "  1) GLM (ZhipuAI) — default"
    Write-Host "  2) OpenRouter — access to many models"
    Write-Host "  3) Anthropic — Claude API"
    Write-Host "  4) Ollama — local (no API key)"
    $choice = Read-Host "Provider [1-4, default=1]"

    switch ($choice) {
        "2" {
            $key = Read-Host "Enter your OpenRouter API key"
            (Get-Content $envFile) -replace 'LLM_PROVIDER=glm', 'LLM_PROVIDER=openrouter' | Set-Content $envFile
            (Get-Content $envFile) -replace 'OPENROUTER_API_KEY=replace_me', "OPENROUTER_API_KEY=$key" | Set-Content $envFile
        }
        "3" {
            $key = Read-Host "Enter your Anthropic API key"
            (Get-Content $envFile) -replace 'LLM_PROVIDER=glm', 'LLM_PROVIDER=anthropic' | Set-Content $envFile
            (Get-Content $envFile) -replace 'ANTHROPIC_API_KEY=replace_me', "ANTHROPIC_API_KEY=$key" | Set-Content $envFile
        }
        "4" {
            (Get-Content $envFile) -replace 'LLM_PROVIDER=glm', 'LLM_PROVIDER=ollama' | Set-Content $envFile
            (Get-Content $envFile) -replace '# OLLAMA_MODEL=qwen3:8b', 'OLLAMA_MODEL=qwen3:8b' | Set-Content $envFile
        }
        default {
            $key = Read-Host "Enter your GLM API key (from https://bigmodel.cn)"
            (Get-Content $envFile) -replace 'GLM_API_KEY=replace_me', "GLM_API_KEY=$key" | Set-Content $envFile
            Write-Host "[✓] GLM configured"
        }
    }

    $dbUrl = Read-Host "`nPostgreSQL connection string [default: postgres://postgres:postgres@localhost:5432/agent_wechat]"
    if ($dbUrl) {
        $escaped = $dbUrl -replace '/', '\/'
        (Get-Content $envFile) -replace 'postgres://postgres:postgres@localhost:5432/agent_wechat', $escaped | Set-Content $envFile
    }
} else {
    Write-Host "[…] .env already exists, skipping"
}

Write-Host "`n[3/3] Installing docs dependencies..."
$DOCS = Join-Path $ROOT "docs"
if (Test-Path (Join-Path $DOCS "package.json")) {
    Set-Location $DOCS
    npm install --loglevel=warn
    Write-Host "[✓] Docs dependencies installed"
}

Write-Host @"

╔══════════════════════════════════════════╗
║          安装完成！启动方式               ║
╚══════════════════════════════════════════╝

  开发模式:
    cd backend && npm run dev

  生产构建:
    cd backend && npm run build && npm start

  文档站:
    cd docs && npm run dev

  访问地址: http://localhost:3017

环境变量文件: backend/.env
文档: docs/README.md
"@
