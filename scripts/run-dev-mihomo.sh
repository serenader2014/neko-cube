#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIHOMO_BIN="${MIHOMO_BIN:-$ROOT_DIR/.dev/mihomo/mihomo}"
MIHOMO_HOME="${MIHOMO_HOME:-$ROOT_DIR/.dev/mihomo/home}"
MIHOMO_CONFIG="${MIHOMO_CONFIG:-$MIHOMO_HOME/config.yaml}"
MIHOMO_CONTROLLER="${MIHOMO_CONTROLLER:-127.0.0.1:9096}"
MIHOMO_SECRET="${MIHOMO_SECRET:-}"
MIHOMO_MIXED_PORT="${MIHOMO_MIXED_PORT:-17890}"
MIHOMO_SOCKS_PORT="${MIHOMO_SOCKS_PORT:-17891}"
MIHOMO_DNS_LISTEN="${MIHOMO_DNS_LISTEN:-127.0.0.1:18053}"

if [[ ! -x "$MIHOMO_BIN" ]]; then
  echo "mihomo binary not found: $MIHOMO_BIN" >&2
  exit 1
fi

mkdir -p "$MIHOMO_HOME"

SECRET_LINE=""
if [[ -n "$MIHOMO_SECRET" ]]; then
  SECRET_LINE="secret: $MIHOMO_SECRET"
fi

if [[ ! -f "$MIHOMO_CONFIG" ]]; then
  cat >"$MIHOMO_CONFIG" <<EOF
mixed-port: $MIHOMO_MIXED_PORT
socks-port: $MIHOMO_SOCKS_PORT
allow-lan: false
mode: rule
log-level: info
external-controller: $MIHOMO_CONTROLLER
$SECRET_LINE
dns:
  enable: true
  listen: $MIHOMO_DNS_LISTEN
proxies: []
proxy-groups:
  - name: GLOBAL
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,DIRECT
EOF
fi

exec "$MIHOMO_BIN" -d "$MIHOMO_HOME" -f "$MIHOMO_CONFIG"
