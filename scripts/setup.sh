#!/usr/bin/env bash
#
# One-command setup for neat-meet.
#
# Gets a fresh clone ready to `npm run dev`:
#   1. installs Node dependencies (if missing),
#   2. creates the Whisper sidecar's Python venv and installs its requirements,
#   3. seeds a .env from .env.example (never overwriting an existing one).
#
# Safe to re-run: every step is idempotent.
set -euo pipefail

# Run from the repo root regardless of where this is invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# 1. Node dependencies -------------------------------------------------------
if [ ! -d node_modules ]; then
  say "Installing Node dependencies (npm install)"
  npm install
else
  echo "✓ Node dependencies already installed (node_modules present)"
fi

# 2. Whisper sidecar (local, private transcription) --------------------------
say "Setting up the Whisper sidecar (Python)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 not found. Install Python 3.10+ and re-run: npm run setup" >&2
  exit 1
fi

VENV="whisper-sidecar/.venv"
if [ ! -d "$VENV" ]; then
  echo "Creating virtualenv at $VENV"
  python3 -m venv "$VENV"
else
  echo "✓ virtualenv already exists at $VENV"
fi

# Use the venv's interpreter directly so we don't depend on shell activation.
"$VENV/bin/python" -m pip install --quiet --upgrade pip
echo "Installing sidecar requirements (this can take a minute)…"
"$VENV/bin/python" -m pip install --quiet -r whisper-sidecar/requirements.txt
echo "✓ sidecar dependencies installed"

# 3. Environment file --------------------------------------------------------
say "Configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ created .env from .env.example"
else
  echo "✓ .env already exists — left untouched"
fi

# Done ----------------------------------------------------------------------
cat <<'EOF'

──────────────────────────────────────────────────────────────
Setup complete. Two things left before you start a meeting:

  1. Anthropic credentials (for summary + insights). Either
       • put your key in .env      →  ANTHROPIC_API_KEY=sk-ant-...
       • or use browser OAuth      →  ant auth login   (then: npm run dev:auth)
  2. (Optional) connector URLs in .env for grounded insights + sharing.

Then run:  npm run dev
And open:  http://localhost:3000
──────────────────────────────────────────────────────────────
EOF
