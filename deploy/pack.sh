#!/usr/bin/env bash
# Dijalankan di LAPTOP (Git Bash), dari folder proyek:  bash deploy/pack.sh
# Build admin panel lalu bungkus jadi drs-secret-release.tar.gz siap upload.
# TIDAK ikut: node_modules, .env (rahasia), backups, kode sumber pos-admin
# (server cukup hasil build pos-admin/dist).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Build admin panel =="
(cd pos-admin && npm run build)

OUT="drs-secret-release.tar.gz"
rm -f "$OUT"
echo "== Bungkus $OUT =="
tar -czf "$OUT" \
  --exclude='server/node_modules' \
  --exclude='server/.env' \
  --exclude='server/backups' \
  server/package.json server/package-lock.json server/src server/.env.example \
  pos-admin/dist \
  deploy

ls -lh "$OUT"
echo
echo "Upload ke server, mis.:"
echo "  scp $OUT USER@IP_SERVER:/tmp/"
