// W2-T7 — «Свободно под бронь» подсказка /bron: та же математика hold'ов,
// что и охрана брони (reservations.reserveBatchVolume): единая формула
// computeBatchVolumeHolds (активные брони, истёкшие исключены, + активные
// BATCH_VOLUME-образцы). Отличие ТОЛЬКО в показе: net клампится в 0 —
// «~-2 плит» пользователю не выводим. Чистая — тестируется без БД.
import {
  computeBatchVolumeHolds,
  type VolumeHoldReservationRow,
  type VolumeHoldSampleRow,
} from "@/lib/volume-holds";

export interface FreeHint {
  /** null — измерение не отслеживается (§3); иначе net free, ≥ 0. */
  freeSlabs: number | null;
  freeAreaM2: number | null;
}

/**
 * net = свободный остаток − hold'ы (брони + образцы), клампится в 0.
 * ВАЖНО: это ДИСПЛЕЙ; охрана (canReserveVolume) считает без клампа.
 */
export function computeFreeHint(args: {
  slabsFree: number | null;
  areaFreeM2: number | null;
  reservations: readonly VolumeHoldReservationRow[];
  samples: readonly VolumeHoldSampleRow[];
  now: Date;
}): FreeHint {
  const holds = computeBatchVolumeHolds({
    reservations: args.reservations,
    samples: args.samples,
    now: args.now,
  });
  return {
    freeSlabs:
      args.slabsFree === null
        ? null
        : Math.max(0, args.slabsFree - holds.totalSlabs),
    freeAreaM2:
      args.areaFreeM2 === null
        ? null
        : Math.max(0, args.areaFreeM2 - holds.totalAreaM2),
  };
}
