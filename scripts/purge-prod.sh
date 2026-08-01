#!/usr/bin/env bash
# Prod bazasini tozalash — YORDAMCHI SKRIPT (o'zi hech narsa o'chirmaydi).
#
# Nima qiladi: .env.production.local dan prod ulanishini oladi va purge CLI'ni
# chaqiradi. Bayroqlarsiz — QURUQ YURGIZISH: faqat sanaydi, hech narsa o'chmaydi.
#
#   ./scripts/purge-prod.sh --scope=C                    ← quruq yurgizish
#   ./scripts/purge-prod.sh --scope=C --execute --yes    ← HAQIQIY O'CHIRISH
#
# ⚠️  O'chirilgan ma'lumot QAYTMAYDI. Avval Neon'da zaxira branch yarating.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "⛔ $ENV_FILE topilmadi."
  echo "   Avval shuni yugurtiring:"
  echo "   vercel env pull $ENV_FILE --environment=production --yes"
  exit 1
fi

# Prod ulanishini yuklaymiz (ekranga chiqarmaymiz).
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

if [ -z "${DATABASE_URL_UNPOOLED:-}" ]; then
  echo "⛔ $ENV_FILE ichida DATABASE_URL_UNPOOLED yo'q."
  exit 1
fi

# Neon'ning to'g'ridan-to'g'ri (pooler'siz) ulanishi — migratsiya/DDL uchun shart.
export DATABASE_URL="$DATABASE_URL_UNPOOLED"
export ONYX_PURGE_ALLOW="I_UNDERSTAND_IRREVERSIBLE"

echo "→ Baza: prod (Neon, unpooled). Rejim: ${*:-quruq yurgizish}"
echo ""

exec npm run purge:inventory -- "$@"
