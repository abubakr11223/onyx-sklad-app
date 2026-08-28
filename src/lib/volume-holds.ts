// W1-T1 — ЕДИНЫЙ расчёт «занято» (holds) по объёму партии: активные
// (ACTIVE и НЕ истёкшие) BATCH_VOLUME-брони + активные BATCH_VOLUME-образцы.
// Формула — та же, что в issueSample (samples.ts: resHolds + sampleHolds):
//   • бронь считается, только пока expiresAt > now (A2: истёкшая фактически
//     свободна и не должна резать остаток до sweep);
//   • образец держит объём, пока status = ACTIVE (у образца нет expiry-правила);
//   • qtySlabs/qtyAreaM2 = null → 0 (это измерение не занято).
// Потребители: охрана объёмной продажи (sales.executeVolumeSale), охрана
// объёмной брони (reservations.reserveBatchVolume), витрина /prodazha шаг 2.
// НЕ форкать эту математику — сюда же смотрит и /bron, и /poisk
// (batch-remainders.getBatchReservationHolds — map-вариант той же формулы).

/** Минимальная строка volume-брони для расчёта hold'а. */
export interface VolumeHoldReservationRow {
  qtySlabs: number | null;
  qtyAreaM2: number | null;
  expiresAt: Date;
}

/** Минимальная строка активного BATCH_VOLUME-образца. */
export interface VolumeHoldSampleRow {
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}

/** Разбивка «занято» по источникам + итог (для витрины и охраны). */
export interface BatchVolumeHolds {
  /** Активные (не истёкшие) volume-брони. */
  reservationSlabs: number;
  reservationAreaM2: number;
  /** Активные BATCH_VOLUME-образцы. */
  sampleSlabs: number;
  sampleAreaM2: number;
  /** Итог: брони + образцы (это и режет доступный остаток). */
  totalSlabs: number;
  totalAreaM2: number;
}

/** Пустой hold (партия без броней и образцов). */
export const EMPTY_BATCH_VOLUME_HOLDS: BatchVolumeHolds = {
  reservationSlabs: 0,
  reservationAreaM2: 0,
  sampleSlabs: 0,
  sampleAreaM2: 0,
  totalSlabs: 0,
  totalAreaM2: 0,
};

/**
 * Чистая: суммирует активные брони (expiresAt > now) и активные образцы.
 * Истёкшие брони ИСКЛЮЧАЮТСЯ — даже если SQL-фильтр их уже отсёк, здесь
 * повторная (дешёвая) защита, как в reservationHoldsFromRows.
 */
export function computeBatchVolumeHolds(args: {
  reservations: readonly VolumeHoldReservationRow[];
  samples: readonly VolumeHoldSampleRow[];
  now: Date;
}): BatchVolumeHolds {
  let reservationSlabs = 0;
  let reservationAreaM2 = 0;
  for (const r of args.reservations) {
    if (r.expiresAt.getTime() <= args.now.getTime()) continue; // истекла — свободна
    reservationSlabs += r.qtySlabs ?? 0;
    reservationAreaM2 += r.qtyAreaM2 ?? 0;
  }
  let sampleSlabs = 0;
  let sampleAreaM2 = 0;
  for (const s of args.samples) {
    sampleSlabs += s.qtySlabs ?? 0;
    sampleAreaM2 += s.qtyAreaM2 ?? 0;
  }
  return {
    reservationSlabs,
    reservationAreaM2,
    sampleSlabs,
    sampleAreaM2,
    totalSlabs: reservationSlabs + sampleSlabs,
    totalAreaM2: reservationAreaM2 + sampleAreaM2,
  };
}

/** Строка брони с принадлежностью — для «своя бронь на этой партии». */
export interface OwnedVolumeReservationRow extends VolumeHoldReservationRow {
  id: string;
  managerId: string;
  customerName: string;
}

/**
 * Свои активные (не истёкшие) volume-брони актора — для чекбокса
 * «Закрыть мою бронь этой продажей» и для проверки согласия на сервере.
 */
export function findOwnActiveVolumeReservations<
  T extends OwnedVolumeReservationRow,
>(reservations: readonly T[], actorId: string, now: Date): T[] {
  return reservations.filter(
    (r) => r.managerId === actorId && r.expiresAt.getTime() > now.getTime(),
  );
}

const areaFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/**
 * «3 плит · ≈12,5 м²» / «10 м²» / «0» — компактный объём hold'а для UI
 * и сообщений об ошибке. Нули по измерению опускаются; оба нуля → «0».
 */
export function formatHoldQty(slabs: number, areaM2: number): string {
  const parts: string[] = [];
  if (slabs > 0) parts.push(`${slabs} плит`);
  if (areaM2 > 0) parts.push(`≈${areaFmt.format(areaM2)} м²`);
  return parts.length > 0 ? parts.join(" · ") : "0";
}
