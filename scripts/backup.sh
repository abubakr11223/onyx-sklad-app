#!/usr/bin/env bash
# Onyx lokal zaxira skripti
# Har kuni 3:30 da avtomatik ishlaydi (Cowork scheduled task), qo'lda ham mumkin:
#   bash scripts/backup.sh
#
# Dizayn:
#   - Arxiv nomi hafta kuniga bog'liq: onyx_backup_1_Mon.tar.gz ... onyx_backup_7_Sun.tar.gz
#     Har hafta o'sha kun o'z ustiga yozadi -> doim oxirgi 7 kunlik nusxa turadi,
#     eski faylni o'chirish umuman kerak emas (rotatsiya avtomatik).
#   - Arxivga kiradi: butun loyiha, .env* fayllar, .git tarixi
#   - Kirmaydi: node_modules, .next, .vercel, out, coverage, backups,
#     .claude/worktrees va .git/worktrees (boshqa terminallarning vaqtinchalik nusxalari)
#   - sha256 checksum + backups/backup.log jurnal
#
# Tiklash (restore):
#   mkdir restore && tar -xzf backups/onyx_backup_<kun>.tar.gz -C restore
#   cd restore && git fetch origin   # ixtiyoriy: sandbox o'qiy olmagan yakka git obyektlarini to'ldiradi

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/backups"
DAY="$(date +%u_%a)" # 1_Mon ... 7_Sun
ARCHIVE="$DEST/onyx_backup_${DAY}.tar.gz"
LOG="$DEST/backup.log"
ERRTMP="$(mktemp)"
trap 'rm -f "$ERRTMP"' EXIT

mkdir -p "$DEST"

log() { echo "[$(date +%Y-%m-%dT%H:%M:%S)] $*" | tee -a "$LOG"; }

log "BOSHLANDI: $(date +%F) -> slot $DAY"

# GNU tar (Linux) va BSD tar (macOS) mosligi
EXTRA_FLAGS=()
if tar --version 2>/dev/null | grep -q GNU; then
  EXTRA_FLAGS+=(--ignore-failed-read --warning=no-file-changed)
fi

# --- 1. Arxivlash (o'qib bo'lmagan yakka fayllar to'xtatmaydi) ---
rc=0
tar -czf "$ARCHIVE" \
  "${EXTRA_FLAGS[@]}" \
  --exclude='./backups' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.vercel' \
  --exclude='./out' \
  --exclude='./coverage' \
  --exclude='./.claude/worktrees' \
  --exclude='./.git/worktrees' \
  --exclude='.DS_Store' \
  --exclude='*.tsbuildinfo' \
  -C "$ROOT" . 2>"$ERRTMP" || rc=$?

WARN_COUNT="$(wc -l < "$ERRTMP" | tr -d ' ')"

if [ "$rc" -ge 2 ] && ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  log "XATO: arxiv yaratib bo'lmadi (tar kod $rc). Birinchi xatolar:"
  head -5 "$ERRTMP" | tee -a "$LOG"
  exit 1
fi

if [ "$WARN_COUNT" -gt 0 ]; then
  log "OGOHLANTIRISH: $WARN_COUNT ta fayl o'tkazib yuborildi/o'zgardi (birinchisi: $(head -1 "$ERRTMP"))"
fi

# --- 2. Arxiv sog'lomligini tekshirish ---
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  log "XATO: arxiv buzilgan — $ARCHIVE"
  exit 1
fi

# --- 3. Checksum ---
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DEST" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
else
  (cd "$DEST" && shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
COUNT="$(cd "$DEST" && ls -1 onyx_backup_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"

log "TAYYOR: $(basename "$ARCHIVE") ($SIZE) | jami slotlar: $COUNT/7 | ogohlantirish: $WARN_COUNT"
