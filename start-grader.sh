#!/usr/bin/env sh
# Runs only the existing local model; no downloads or background service.
set -eu
model=${STUDY_HUB_MODEL:-"$HOME/models/Qwen3-8B-Q4_K_M.gguf"}
port=${STUDY_HUB_GRADER_PORT:-8766}
if [ ! -f "$model" ]; then
  printf 'Local GGUF not found: %s\n' "$model" >&2
  exit 1
fi
exec llama-server --host 127.0.0.1 --port "$port" --model "$model" --alias study-grader \
  --ctx-size 8192 --parallel 1 --gpu-layers auto --reasoning-budget 0 --no-webui --no-slots --log-disable
