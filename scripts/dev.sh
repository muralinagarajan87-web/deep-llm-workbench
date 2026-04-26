#!/usr/bin/env bash
# Boot all four processes for the Deep workbench.
# Requires: node, npm, python3 venvs already set up, ollama running.
set -euo pipefail
cd "$(dirname "$0")/.."

# Make sure all the venvs and node_modules exist.
[ -d ecommerce-chatbot/node_modules ] || (cd ecommerce-chatbot && npm install)
[ -d rag-explorer/backend/.venv ]      || (cd rag-explorer/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)
[ -d deepeval-framework/.venv ]        || (cd deepeval-framework && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pip install fastapi 'uvicorn[standard]')

# Start everything in parallel via npx concurrently.
exec npx -y concurrently \
  -n chat,rag,eval,ui \
  -c blue,green,magenta,cyan \
  "cd ecommerce-chatbot && npm run dev:server" \
  "cd rag-explorer/backend && .venv/bin/uvicorn main:app --port 8000 --host 0.0.0.0" \
  "cd deepeval-framework && .venv/bin/uvicorn runner_service:app --port 9000 --host 0.0.0.0" \
  "cd ecommerce-chatbot && npm run dev:client"
