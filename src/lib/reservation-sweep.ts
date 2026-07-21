// In-process «sweep-runner» — muddati o'tgan bronlarni yopish jarayonini
// bitta joyda o'raydi. instrumentation.ts (node-cron jadvali) shu funksiyani
// chaqiradi; /api/cron/expire-reservations endpoint'i esa to'g'ridan-to'g'ri
// expireOverdueReservations()ni chaqiradi.
//
// MUHIM: bu funksiya HECH QACHON throw QILMAYDI. pm2 doimiy Node jarayonida
// jadvalli sweep xato bersa ham (masalan DB ulanmadi), jarayon YIQILMASLIGI
// kerak — xato yutiladi va loglanadi, natija null bo'ladi.

export interface ReservationSweepDeps {
  /** Muddati o'tgan bronlarni yopadi, nechta yopilganini qaytaradi. */
  expire: () => Promise<number>;
  /** Muvaffaqiyat logi (ixtiyoriy — sukut bo'yicha console.info). */
  log?: (message: string) => void;
  /** Xato logi (ixtiyoriy — sukut bo'yicha console.error). */
  logError?: (message: string, error: unknown) => void;
}

/**
 * Bir marta sweep yuritadi. Muvaffaqiyatda — yopilgan bronlar soni; xatoda —
 * null (xato yutiladi, throw yo'q). Idempotent: qayta-qayta chaqirilsa xavfsiz.
 */
export async function runReservationSweep(
  deps: ReservationSweepDeps,
): Promise<number | null> {
  const log = deps.log ?? ((m: string) => console.info(m));
  const logError =
    deps.logError ?? ((m: string, e: unknown) => console.error(m, e));
  try {
    const expired = await deps.expire();
    log(`[reservation-sweep] ${expired} ta bron EXPIRED qilindi.`);
    return expired;
  } catch (error) {
    logError("[reservation-sweep] sweep xato bilan tugadi (yutildi)", error);
    return null;
  }
}
