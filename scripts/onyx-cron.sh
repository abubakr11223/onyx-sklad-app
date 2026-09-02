#!/bin/sh
# Onyx — kunlik vazifalar (o'z serverida).
#
# NEGA BU FAYL BOR. Vercel'da jadval `vercel.json` ichida yashaydi va o'sha
# platformaga bog'langan. Ko'chgandan keyin u YO'Q bo'ladi. Audit 2026-09-02
# hujjatdagi crontab qatorini tekshirib chiqdi va u ISHLAMASLIGINI aniqladi:
#
#   0 2 * * * curl -H "Authorization: Bearer $CRON_SECRET" ... > /dev/null
#             └── cron o'z muhitida bu kalitni BILMAYDI → sarlavha bo'sh ketadi
#                 → server 401 qaytaradi → zaxira olinmaydi
#                                              └── natija /dev/null'ga → IZ QOLMAYDI
#
# Ya'ni ko'chgan kundan boshlab zaxira jimgina olinmay qolardi va buni faqat
# falokat kuni bilib qolish mumkin edi.
#
# Bu skript docker-compose.prod.yml dagi `cron` xizmati ichida ishlaydi.
# Muhit o'zgaruvchilari konteynerga `env_file` orqali keladi — ya'ni CRON_SECRET
# har doim joyida. Chiqish konteyner jurnaliga yoziladi:
#
#   docker compose -f docker-compose.prod.yml logs cron
#
# Ilova ichki tarmoq orqali chaqiriladi (http://app:3000) — domen, sertifikat
# va tashqi tarmoq umuman kerak emas.

set -u

APP="${CRON_TARGET:-http://app:3000}"
BACKUP_AT="${CRON_BACKUP_UTC:-2100}"    # 21:00 UTC = 02:00 Toshkent
EXPIRE_AT="${CRON_EXPIRE_UTC:-0300}"    # 03:00 UTC = 08:00 Toshkent

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')Z] $*"; }

call() {
  name="$1"
  path="$2"
  if [ -z "${CRON_SECRET:-}" ]; then
    log "XATO: CRON_SECRET bo'sh — $name chaqirilmadi. .env.production'ni tekshiring."
    return 1
  fi
  # -f: HTTP xatosi ham xato deb hisoblansin (aks holda 401 «muvaffaqiyat»).
  # -m: zaxira uzoq bo'lishi mumkin, lekin cheksiz emas.
  if out=$(curl -fsS -m 600 -H "Authorization: Bearer ${CRON_SECRET}" "${APP}${path}" 2>&1); then
    log "$name OK: $(echo "$out" | head -c 400)"
    return 0
  fi
  log "$name XATO: $(echo "$out" | head -c 400)"
  return 1
}

log "cron ishga tushdi. zaxira ${BACKUP_AT} UTC, bron tozalash ${EXPIRE_AT} UTC, manzil ${APP}"

last_backup=""
last_expire=""

while :; do
  now=$(date -u +%H%M)
  today=$(date -u +%Y-%m-%d)

  # Kuniga BIR marta: shu kunda allaqachon bajarilgan bo'lsa qayta chaqirmaymiz
  # (daqiqa ichida bir necha aylanish bo'lishi mumkin).
  if [ "$now" = "$BACKUP_AT" ] && [ "$last_backup" != "$today" ]; then
    last_backup="$today"
    call "zaxira" "/api/cron/backup"
  fi

  if [ "$now" = "$EXPIRE_AT" ] && [ "$last_expire" != "$today" ]; then
    last_expire="$today"
    call "bron tozalash" "/api/cron/expire-reservations"
  fi

  sleep 30
done
