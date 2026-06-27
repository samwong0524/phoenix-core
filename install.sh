#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  SWARM IDE — 一键安装脚本 (Unix)
# ─────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"

echo "╔══════════════════════════════════════════╗"
echo "║        SWARM IDE — Install Script        ║"
echo "╚══════════════════════════════════════════╝"

# Check Node.js
if command -v node &>/dev/null; then
    echo "[✓] Node.js $(node --version)"
else
    echo "[✗] Node.js not found — install from https://nodejs.org (v18+)"
    exit 1
fi

# Check npm
if command -v npm &>/dev/null; then
    echo "[✓] npm v$(npm --version)"
else
    echo "[✗] npm not found"
    exit 1
fi

# Check PostgreSQL
if command -v psql &>/dev/null; then
    echo "[✓] $(psql --version 2>&1 | head -1)"
else
    echo "[!] PostgreSQL not detected — install from https://postgresql.org"
    echo "    Or set DATABASE_URL in .env to point to a remote PostgreSQL instance"
fi

echo ""
echo "[1/3] Installing backend dependencies..."
cd "$BACKEND"
npm install --loglevel=warn
echo "[✓] Dependencies installed"

# Create .env if not exists
if [ ! -f .env ]; then
    echo ""
    echo "[2/3] Creating .env from .env.example..."
    cp .env.example .env

    echo ""
    echo "Choose an LLM provider:"
    echo "  1) GLM (ZhipuAI) — default"
    echo "  2) OpenRouter"
    echo "  3) Anthropic"
    echo "  4) Ollama (local, no key needed)"
    read -rp "Provider [1-4, default=1]: " choice

    case "$choice" in
        2)
            read -rp "Enter your OpenRouter API key: " key
            sed -i "s/LLM_PROVIDER=glm/LLM_PROVIDER=openrouter/" .env
            sed -i "s/OPENROUTER_API_KEY=replace_me/OPENROUTER_API_KEY=$key/" .env
            ;;
        3)
            read -rp "Enter your Anthropic API key: " key
            sed -i "s/LLM_PROVIDER=glm/LLM_PROVIDER=anthropic/" .env
            sed -i "s/ANTHROPIC_API_KEY=replace_me/ANTHROPIC_API_KEY=$key/" .env
            ;;
        4)
            sed -i "s/LLM_PROVIDER=glm/LLM_PROVIDER=ollama/" .env
            sed -i "s|^# OLLAMA_MODEL=qwen3:8b|OLLAMA_MODEL=qwen3:8b|" .env
            ;;
        *)
            read -rp "Enter your GLM API key (from https://bigmodel.cn): " key
            sed -i "s/GLM_API_KEY=replace_me/GLM_API_KEY=$key/" .env
            echo "[✓] GLM configured"
            ;;
    esac

    read -rp $'\nPostgreSQL connection string\n[default: postgres://postgres:postgres@localhost:5432/agent_wechat]: ' db_url
    if [ -n "$db_url" ]; then
        # Escape slashes for sed
        db_url_escaped=$(echo "$db_url" | sed 's|/|\\/|g')
        sed -i "s/postgres:\/\/postgres:postgres@localhost:5432\/agent_wechat/$db_url_escaped/" .env
    fi
else
    echo "[…] .env already exists, skipping"
fi

echo ""
echo "[3/3] Installing docs dependencies..."
DOCS="$ROOT/docs"
if [ -f "$DOCS/package.json" ]; then
    cd "$DOCS"
    npm install --loglevel=warn
    echo "[✓] Docs dependencies installed"
fi

cd "$ROOT"

cat <<'EOF'

╔══════════════════════════════════════════╗
║         Install complete!                ║
╚══════════════════════════════════════════╝

  Development:
    cd backend && npm run dev

  Production build:
    cd backend && npm run build && npm start

  Documentation site:
    cd docs && npm run dev

  URL: http://localhost:3017

  Config: backend/.env
EOF
