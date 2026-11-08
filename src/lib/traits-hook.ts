// ТЗ №20 K (§12.1) — признаки «при загрузке фото»: обёртка для after() в
// action'ах приёмки и правки партии. Никогда не бросает (продажа/приёмка уже
// сохранены); то, что не успелось, доберёт ночной пересчёт.
import { after } from "next/server";
import { db } from "./db";
import { refreshTraitsForBatches } from "./traits-store";

export async function refreshTraitsForBatchesSafe(batchIds: readonly string[]): Promise<void> {
  try {
    const r = await refreshTraitsForBatches(db, batchIds);
    console.info(`[traits] after-upload ${JSON.stringify(r)}`);
  } catch (err) {
    console.warn("[traits] after-upload failed:", (err as Error).message);
  }
}

/**
 * Запланировать пересчёт после ответа (after). Вне запроса (тесты, скрипты)
 * after бросает — тогда просто пропускаем: доберёт ночной пересчёт.
 */
export function scheduleTraitsRefresh(batchIds: readonly string[]): void {
  try {
    after(() => refreshTraitsForBatchesSafe(batchIds));
  } catch {
    // нет контекста запроса — не страшно
  }
}
