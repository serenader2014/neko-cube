#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIHOMO_CONTROLLER_URL="${MIHOMO_CONTROLLER_URL:-http://127.0.0.1:9096}"
MIHOMO_SECRET="${MIHOMO_SECRET:-}"
MIHOMO_CONFIG="${MIHOMO_CONFIG:-$ROOT_DIR/.dev/mihomo/home/config.yaml}"
AUTH_ARGS=()

if [[ -z "$MIHOMO_SECRET" && -f "$MIHOMO_CONFIG" ]]; then
  MIHOMO_SECRET="$(awk -F': ' '/^secret:/ {print $2; exit}' "$MIHOMO_CONFIG")"
fi

if [[ -n "$MIHOMO_SECRET" ]]; then
  AUTH_ARGS=(-H "Authorization: Bearer $MIHOMO_SECRET")
fi

echo "controller: $MIHOMO_CONTROLLER_URL"
echo "config: $MIHOMO_CONFIG"

if [[ ${#AUTH_ARGS[@]} -gt 0 ]]; then
  curl -fsS "${AUTH_ARGS[@]}" "$MIHOMO_CONTROLLER_URL/version"
else
  curl -fsS "$MIHOMO_CONTROLLER_URL/version"
fi
echo
if [[ ${#AUTH_ARGS[@]} -gt 0 ]]; then
  curl -fsS "${AUTH_ARGS[@]}" "$MIHOMO_CONTROLLER_URL/configs"
else
  curl -fsS "$MIHOMO_CONTROLLER_URL/configs"
fi
echo
