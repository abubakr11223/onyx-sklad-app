// Zaxira TIRIKMI — «o'lik odam tugmasi» (dead man's switch).
//
// Audit 2026-09-02 topgan muammo: ogohlantirish faqat zaxira funksiyasi ISHGA
// TUSHIB xatoni ushlaganda ketardi. Agar funksiya umuman chaqirilmasa — cron
// o'chib qolgan, jadval ko'chirishda yo'qolgan, kalit noto'g'ri — hech qayerga
// hech narsa chiqmasdi. Bu xayoliy xavf emas: aynan shunday holat egadagi
// kompyuterda yuz bergan — kunlik nusxa 27-avgustda to'xtagan va 6 kun davomida
// hech kim sezmagan.
//
// Yechim ikki qismdan iborat va ikkalasi ham SODDA:
//   1. Zaxira muvaffaqiyatli tugagach — AppConfig'ga sana yoziladi.
//   2. Ikkinchi cron (expire-reservations) o'sha sanani tekshiradi va eskirgan
//      bo'lsa egaga Telegram xabari yuboradi.
//
// Nega ikkinchi cron: u BOSHQA jadval bo'yicha, boshqa vaqtda ishlaydi. Zaxira
// crони butunlay o'lsa ham, bu tirik qoladi va o'lganini aytadi. Ikkalasi bir
// vaqtda o'lsa — buni faqat odam sezadi, shuning uchun hujjatga haftalik
// «oxirgi fayl qaysi sanada?» tekshiruvi ham yozilgan.

/** AppConfig kaliti — oxirgi MUVAFFAQIYATLI zaxira vaqti (ISO). */
export const LAST_BACKUP_OK_KEY = "lastBackupOkAt";

/**
 * Necha soatdan keyin «zaxira kelmayapti» deb hisoblanadi.
 * Zaxira kuniga bir marta olinadi (24 soat), 36 soat — bitta o'tkazib
 * yuborilgan kunni kechiradi, lekin ikkinchisini kechirmaydi.
 */
export const BACKUP_STALE_HOURS = 36;

/** Minimal delegate — testda soxta obyekt bilan almashadi. */
export interface AppConfigDelegate {
  findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
  upsert: (args: {
    where: { key: string };
    create: { key: string; value: string };
    update: { value: string };
  }) => Promise<unknown>;
}

export interface BackupStatusClient {
  appConfig: AppConfigDelegate;
}

/**
 * Zaxira eskirdimi. Sof funksiya — vaqt tashqaridan beriladi.
 * `last` null bo'lsa (hech qachon yozilmagan) — eskirgan deb hisoblanadi:
 * yangi o'rnatishda ham «zaxira ishlayaptimi?» degan savol darhol chiqsin.
 */
export function isBackupStale(
  last: string | null,
  nowIso: string,
  maxHours: number = BACKUP_STALE_HOURS,
): boolean {
  if (last === null || last.length === 0) return true;
  const lastMs = Date.parse(last);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return true;
  return nowMs - lastMs > maxHours * 3600_000;
}

/** Necha soat o'tgani — xabar matnida ko'rsatish uchun. */
export function hoursSince(last: string | null, nowIso: string): number | null {
  if (last === null) return null;
  const lastMs = Date.parse(last);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return null;
  return Math.floor((nowMs - lastMs) / 3600_000);
}

/**
 * Muvaffaqiyatli zaxira vaqtini yozadi. HECH QACHON throw qilmaydi: bu yozuv
 * qo'shimcha himoya, uning xatosi tayyor bo'lgan zaxirani bekor qilmasligi kerak.
 */
export async function recordBackupOk(
  client: BackupStatusClient,
  takenAtIso: string,
): Promise<boolean> {
  try {
    await client.appConfig.upsert({
      where: { key: LAST_BACKUP_OK_KEY },
      create: { key: LAST_BACKUP_OK_KEY, value: takenAtIso },
      update: { value: takenAtIso },
    });
    return true;
  } catch (e) {
    console.warn(
      `[backup-status] ${LAST_BACKUP_OK_KEY} yozilmadi: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/** Oxirgi muvaffaqiyatli zaxira vaqti (yoki null). Throw qilmaydi. */
export async function readLastBackupOk(
  client: BackupStatusClient,
): Promise<string | null> {
  try {
    const row = await client.appConfig.findUnique({ where: { key: LAST_BACKUP_OK_KEY } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Egaga ketadigan ogohlantirish matni (ruscha — ilovadagi boshqa xabarlar kabi). */
export function staleBackupMessage(last: string | null, nowIso: string): string {
  const h = hoursSince(last, nowIso);
  const when =
    last === null
      ? "ни одной резервной копии ещё не было"
      : `последняя копия: ${last.slice(0, 16).replace("T", " ")} UTC (${h} ч назад)`;
  return [
    "⚠️ Onyx: резервные копии не приходят.",
    when,
    "Проверьте, работает ли ежедневная задача (cron) и приходит ли файл в Telegram.",
  ].join("\n");
}
