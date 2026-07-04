// Karta готовности (/karta) holati — Postgres manbai (Part 2).
// Defaultlar yoqilgan holda ko'rinadi, ammo DB yozuvi bir marta tegilsa —
// haqiqat manbai DB bo'ladi (row.done qiymati defaultni bekor qiladi).
import { db } from "@/lib/db";

export const DEFAULT_DONE = ["1.1", "1.3", "1.6", "1.7"];

/**
 * Barcha kataklarning joriy holatini qaytaradi: avval DEFAULT_DONE = true,
 * so'ng har bir DB yozuvi ustidan yozadi (map[cellId] = row.done).
 */
export async function getKartaState(): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {};
  for (const id of DEFAULT_DONE) map[id] = true;

  const rows = await db.kartaCell.findMany();
  for (const row of rows) {
    map[row.cellId] = row.done;
  }
  return map;
}

/** cellId — qisqa, «axlat» qiymatlardan himoya (bo'sh emas, uzunligi <= 8). */
export function isValidCellId(cellId: string): boolean {
  return (
    typeof cellId === "string" &&
    cellId.length > 0 &&
    cellId.length <= 8 &&
    /^[0-9]+[.А-Яа-яA-Za-z]?[0-9]*$/.test(cellId)
  );
}

/** Bitta katakni upsert qiladi. Yaroqsiz cellId'da xato tashlaydi. */
export async function setKartaCell(
  cellId: string,
  done: boolean,
  updatedBy: string | null,
): Promise<void> {
  if (!isValidCellId(cellId)) {
    throw new Error(`Yaroqsiz cellId: ${cellId}`);
  }
  await db.kartaCell.upsert({
    where: { cellId },
    create: { cellId, done, updatedBy },
    update: { done, updatedBy },
  });
}
