#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required. Install with: brew install mkcert"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required."
  exit 1
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -z "$IP" ]]; then IP="$(ipconfig getifaddr en1 2>/dev/null || true)"; fi
if [[ -z "$IP" ]]; then
  echo "No Wi-Fi IP address found. Check your network connection."
  exit 1
fi

mkdir -p .local-https public
mkcert -install
mkcert -cert-file .local-https/iphone.pem -key-file .local-https/iphone-key.pem "$IP" localhost 127.0.0.1

# Public certificate only: never copy the private CA key or TLS private key.
cp "$(mkcert -CAROOT)/rootCA.pem" public/local-ca.crt
echo ""
echo "On your phone (same Wi-Fi), download and trust the local CA certificate:"
echo "  http://$IP:3100/local-ca.crt"
echo "  Settings > Profile Downloaded > Install"
echo "  Settings > General > About > Certificate Trust Settings > Enable Full Trust"
echo ""
echo "Open this HTTPS URL in Safari:"
echo "  https://$IP:3443"
echo ""
echo "Add the web app to the home screen and download all required content before going offline."
echo "If the local IP changes, rerun this script and open the new address."
echo ""

npm run build
npm run start -- -p 3100 -H 0.0.0.0 &
NEXT_PID=$!
cleanup(){ kill "$NEXT_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

APP_HTTPS_CERT="$PWD/.local-https/iphone.pem" \
APP_HTTPS_KEY="$PWD/.local-https/iphone-key.pem" \
APP_UPSTREAM_PORT=3100 \
node scripts/iphone-https-proxy.mjs
