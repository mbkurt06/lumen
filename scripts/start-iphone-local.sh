#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert gerekli. Mac'te: brew install mkcert"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js kurulu olmali."
  exit 1
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -z "$IP" ]]; then IP="$(ipconfig getifaddr en1 2>/dev/null || true)"; fi
if [[ -z "$IP" ]]; then
  echo "Wi-Fi IP adresi bulunamadi. Mac'in Wi-Fi baglantisini kontrol edin."
  exit 1
fi

mkdir -p .local-https public
mkcert -install
mkcert -cert-file .local-https/iphone.pem -key-file .local-https/iphone-key.pem "$IP" localhost 127.0.0.1

# Public certificate only: never copy the private CA key or TLS private key.
cp "$(mkcert -CAROOT)/rootCA.pem" public/lumen-local-ca.crt
echo ""
echo "iPhone'da (ayni Wi-Fi agindayken) su adreslerden sertifikayi yukleyin:"
echo "  http://$IP:3100/lumen-local-ca.crt"
echo "  Ayarlar > Profil Indirildi > Yukle"
echo "  Ayarlar > Genel > Hakkinda > Sertifika Guven Ayarlari > Tam guven"
echo ""
echo "Sonra Safari'de su HTTPS adresini acin:"
echo "  https://$IP:3443"
echo ""
echo "Ilk kurulumdan sonra Ana Ekrana Ekle; interneti kapatmadan once uygulamayi acip icerikleri indirin."
echo "Mac'inizin IP adresi degisirse bu komutu yeniden calistirin ve yeni adresi kullanin."
echo ""

npm run build
npm run start -- -p 3100 -H 0.0.0.0 &
NEXT_PID=$!
cleanup(){ kill "$NEXT_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

LUMEN_HTTPS_CERT="$PWD/.local-https/iphone.pem" \
LUMEN_HTTPS_KEY="$PWD/.local-https/iphone-key.pem" \
LUMEN_NEXT_PORT=3100 \
node scripts/iphone-https-proxy.mjs
