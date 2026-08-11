// TG-C — Фото: повторное использование + «свежесть» (TZ §5.3, последний пункт).
// Фото хранятся вечно (Photo) и показываются на карточке камня; склад повторно
// не снимаем. Но менеджеру важно видеть ДАТУ съёмки и понимать, не устарело ли
// фото. Здесь — чистые (без DB) хелперы: парс конфига «через сколько месяцев
// считать фото устаревшим» и сама проверка устаревания. UI га bog'liq narsa yo'q —
// bu funksiyalar server component'dan ham, kelajakdagi Telegram botdan ham
// chaqirilishi mumkin va alohida unit-testlanadi.

// ─────────────────────────── Konstantalar ───────────────────────────

/** AppConfig kaliti: fotoni «eskirgan» deb hisoblash chegarasi (oy). */
export const PHOTO_STALE_MONTHS_KEY = "photoStaleMonths";
/** TZ §5.3: default — «несколько месяцев», olamiz 6 oy. */
export const DEFAULT_PHOTO_STALE_MONTHS = 6;
/** Sog'lom yuqori chegara (10 yil) — buzuq/aql bovar qilmas config'ga qarshi. */
export const MAX_PHOTO_STALE_MONTHS = 120;
/** Pastki chegara — kamida 1 oy (0 yoki manfiy — mantiqsiz). */
export const MIN_PHOTO_STALE_MONTHS = 1;

/**
 * ТЗ №16 B — сколько общих фото партии принимаем за одну приёмку.
 * Потолок нужен не для красоты: каждый файл это отдельная загрузка в Blob и
 * отдельная строка Photo, а приёмка идёт со склада по слабой сети.
 * Живёт здесь (а не рядом с формой или действием), потому что нужен обоим:
 * форма — «use client», действие — «use server», общий модуль обязан быть чистым.
 */
export const MAX_BATCH_PHOTOS = 4;

// ──────────────────── Sof helperlar (DB YO'Q — unit-test) ────────────────────

/**
 * AppConfig.photoStaleMonths qiymatini parse qiladi.
 * Butun son bo'lib [MIN, MAX] oralig'ida bo'lsa — o'zi; aks holda (yo'q/buzuq/
 * chegaradan tashqari) — jim default 6 ga qaytadi. Bu foydalanuvchi kiritadigan
 * emas, admin-config qiymati — shuning uchun VALIDATION xato tashlamaymiz,
 * xavfsiz default bilan davom etamiz.
 */
export function parsePhotoStaleMonthsConfig(
  value: string | null | undefined,
): number {
  if (value == null) return DEFAULT_PHOTO_STALE_MONTHS;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isInteger(n) &&
    n >= MIN_PHOTO_STALE_MONTHS &&
    n <= MAX_PHOTO_STALE_MONTHS
    ? n
    : DEFAULT_PHOTO_STALE_MONTHS;
}

/**
 * `now` dan `months` oy ayirilgan sanani qaytaradi. Oy uzunligi har xil
 * bo'lgani uchun kun «to'lib ketishi»ni oldini olamiz: masalan 31-mart − 1 oy
 * → 31-fevral emas, balki 28/29-fevral (o'sha oyning oxirgi kuni). Sof funksiya —
 * ichida `new Date()` argumentsiz chaqirilmaydi, faqat berilgan `now` dan hosila.
 */
function subtractMonths(now: Date, months: number): Date {
  const day = now.getDate();
  const t = new Date(now.getTime());
  t.setDate(1); // avval 1-kunga o'tamiz — oy siljishida kun to'lib ketmasin
  t.setMonth(t.getMonth() - months);
  // Nishon oyning oxirgi kuni (keyingi oyning 0-kuni = shu oy oxiri).
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, lastDay));
  return t;
}

/**
 * Foto «eskirgan»mi? `takenAt` — `now` dan `months` oy oldindan QAT'IY oldinroq
 * bo'lsa true. Aynan `months` oy oldin olingan foto HALI eskirmagan (chegara
 * qat'iy: `<`, `<=` emas) — «возможно, переснять» pometkasi faqat undan keyin
 * chiqadi. Sof funksiya: `now` ni chaqiruvchi beradi (test vaqtga bog'liq emas).
 */
export function isPhotoStale(takenAt: Date, now: Date, months: number): boolean {
  const threshold = subtractMonths(now, months);
  return takenAt.getTime() < threshold.getTime();
}
