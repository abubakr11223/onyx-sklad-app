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

# 1-yo'l (tavsiya): ulanish satrini buyruq oldidan berish —
#   DATABASE_URL="postgres://..." ./scripts/purge-prod.sh --scope=C
# Sabab: `vercel env pull` baza ulanishlarini MAXFIY deb hisoblaydi va ularning
# qiymatini bo'sh qaytaradi, shuning uchun fayldan o'qish ko'pincha ishlamaydi.
# Satrni Neon panelidan (Connection string → Direct / unpooled) nusxalang.
if [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
else
  if [ ! -f "$ENV_FILE" ]; then
    echo "⛔ Ulanish satri berilmadi va $ENV_FILE ham topilmadi."
    echo ""
    echo "   Neon panelidan to'g'ridan-to'g'ri (unpooled) ulanish satrini oling va:"
    echo "   DATABASE_URL=\"postgres://...\" ./scripts/purge-prod.sh --scope=C"
    exit 1
  fi

# Faylni `source` QILMAYMIZ. Vercel bu faylga VERCEL_GIT_COMMIT_MESSAGE ni ham
# yozadi — bizning commit matnlarimiz ko'p qatorli, qo'shtirnoq/qavs/backtick
# bilan. Bash uni sourcing paytida noto'g'ri o'qib, keyingi o'zgaruvchilarni
# yutib yuboradi. Shuning uchun faqat kerakli BITTA qatorni ajratib olamiz.
  DB_URL="$(
    sed -n 's/^DATABASE_URL_UNPOOLED=//p' "$ENV_FILE" \
      | head -n 1 \
      | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  )"
fi

if [ -z "$DB_URL" ]; then
  echo "⛔ Ulanish satri topilmadi (yoki bo'sh)."
  echo ""
  echo "   Vercel maxfiy o'zgaruvchilarni bo'sh qaytaradi — shuning uchun"
  echo "   satrni Neon panelidan oling: loyiha → Connection string →"
  echo "   «Direct connection» (pooler'siz), keyin:"
  echo ""
  echo "   DATABASE_URL=\"postgres://...\" ./scripts/purge-prod.sh --scope=C"
  exit 1
fi

case "$DB_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "⛔ DATABASE_URL_UNPOOLED postgres:// bilan boshlanmadi — format kutilganidek emas."
    exit 1
    ;;
esac

# Neon'ning to'g'ridan-to'g'ri (pooler'siz) ulanishi — DDL/katta o'chirish uchun.
export DATABASE_URL="$DB_URL"
export ONYX_PURGE_ALLOW="I_UNDERSTAND_IRREVERSIBLE"

echo "→ Baza: prod (Neon, unpooled). Rejim: ${*:-quruq yurgizish}"
echo ""

exec npm run purge:inventory -- "$@"
