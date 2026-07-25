"use server";

// ТЗ №6 — редактирование сетки склада (блоки + ориентиры). ТОЛЬКО Владелец
// (getRealSessionUser, как /accounts — defense-in-depth). Удаление блока — только
// если он пустой (нет камня: BatchLocation по букве блока). Все правки → редирект
// обратно в режим редактирования с ok/err.
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { normalizeBlockLetter } from "@/lib/block-letter";
import { getRealSessionUser } from "@/lib/session";

const BACK = "/karta-sklada?edit=1";

async function requireOwner(): Promise<void> {
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") redirect(`${BACK}&err=denied`);
}

/** Есть ли камень в блоке (по букве) — для защиты удаления. */
async function blockHasStone(letter: string): Promise<boolean> {
  const n = await db.batchLocation.count({ where: { block: letter } });
  return n > 0;
}

/**
 * ТЗ №7 §4 — «материализация» авто-блока. Блоки, появившиеся из приёмки
 * (BatchLocation по букве, без строки WarehouseBlock), должны редактироваться
 * так же, как ручные. При первой правке создаём для буквы строку WarehouseBlock
 * и переносим существующие ориентиры из BatchLocation, затем возвращаем её id.
 * Если строка уже есть (ручной блок или уже материализованный) — просто её id.
 */
async function materializeBlock(letter: string): Promise<string> {
  const existing = await db.warehouseBlock.findUnique({
    where: { letter },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Ориентиры авто-блока — из BatchLocation (свободный текст). Дедуп по
  // обрезанному значению, пустые — пропускаем (иначе дубль/пустой ориентир).
  const locs = await db.batchLocation.findMany({
    where: { block: letter },
    select: { landmark: true },
  });
  const numbers = [
    ...new Set(locs.map((l) => l.landmark.trim()).filter((s) => s !== "")),
  ];
  const max = await db.warehouseBlock.aggregate({ _max: { sortOrder: true } });
  const created = await db.warehouseBlock.create({
    data: {
      letter,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      landmarks: { create: numbers.map((number) => ({ number })) },
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * id блока для правки: либо явный blockId (ручной/сетевой блок), либо буква
 * авто-блока (fromLetter) — тогда материализуем его в сетку (см. выше).
 */
async function resolveBlockId(formData: FormData): Promise<string> {
  const id = String(formData.get("blockId") ?? "");
  if (id) return id;
  const fromLetter = String(formData.get("fromLetter") ?? "").trim();
  if (!fromLetter) redirect(`${BACK}&err=notfound`);
  return materializeBlock(fromLetter);
}

export async function addBlock(formData: FormData): Promise<void> {
  await requireOwner();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
  const areaRaw = String(formData.get("areaM2") ?? "").trim().replace(",", ".");
  const areaM2 = areaRaw === "" ? null : Number.parseFloat(areaRaw);
  if (areaM2 !== null && (!Number.isFinite(areaM2) || areaM2 < 0)) {
    redirect(`${BACK}&err=area`);
  }
  try {
    const max = await db.warehouseBlock.aggregate({ _max: { sortOrder: true } });
    await db.warehouseBlock.create({
      data: {
        letter,
        areaM2: areaM2 === null ? null : areaM2.toFixed(3),
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(`${BACK}&err=block_taken`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=block`);
}

export async function renameBlock(formData: FormData): Promise<void> {
  await requireOwner();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
  const id = await resolveBlockId(formData);
  try {
    await db.warehouseBlock.update({ where: { id }, data: { letter } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(`${BACK}&err=block_taken`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=renamed`);
}

export async function deleteBlock(formData: FormData): Promise<void> {
  await requireOwner();
  const id = String(formData.get("blockId") ?? "");
  // Авто-блок (только буква): строки WarehouseBlock ещё нет — материализовать
  // ради удаления бессмысленно. Камень в нём есть всегда (он и породил блок),
  // поэтому правило «только пустой» его и так заблокирует.
  if (!id) {
    const fromLetter = String(formData.get("fromLetter") ?? "").trim();
    if (!fromLetter) redirect(`${BACK}&err=notfound`);
    if (await blockHasStone(fromLetter)) redirect(`${BACK}&err=block_has_stone`);
    // Камня нет и строки нет — удалять нечего, считаем выполненным.
    redirect(`${BACK}&ok=deleted`);
  }
  const block = await db.warehouseBlock.findUnique({
    where: { id },
    select: { letter: true },
  });
  if (!block) redirect(`${BACK}&err=notfound`);
  // Защита данных: удаляем только пустой блок (нет камня по этой букве).
  if (await blockHasStone(block.letter)) redirect(`${BACK}&err=block_has_stone`);
  await db.warehouseBlock.delete({ where: { id } }); // landmarks — cascade
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=deleted`);
}

export async function setBlockMeta(formData: FormData): Promise<void> {
  await requireOwner();
  const id = await resolveBlockId(formData);
  const note = String(formData.get("note") ?? "").trim() || null;
  const isFull = formData.get("isFull") === "1";
  const areaRaw = String(formData.get("areaM2") ?? "").trim().replace(",", ".");
  const areaM2 = areaRaw === "" ? null : Number.parseFloat(areaRaw);
  if (areaM2 !== null && (!Number.isFinite(areaM2) || areaM2 < 0)) {
    redirect(`${BACK}&err=area`);
  }
  await db.warehouseBlock.update({
    where: { id },
    data: { note, isFull, areaM2: areaM2 === null ? null : areaM2.toFixed(3) },
  });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=meta`);
}

export async function addLandmark(formData: FormData): Promise<void> {
  await requireOwner();
  const number = String(formData.get("number") ?? "").trim();
  if (!number) redirect(`${BACK}&err=number`);
  const blockId = await resolveBlockId(formData);
  try {
    await db.warehouseLandmark.create({ data: { blockId, number } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(`${BACK}&err=landmark_taken`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=landmark`);
}

export async function removeLandmark(formData: FormData): Promise<void> {
  await requireOwner();
  const id = String(formData.get("landmarkId") ?? "");
  if (!id) redirect(`${BACK}&err=notfound`);
  await db.warehouseLandmark.delete({ where: { id } });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=landmark_removed`);
}
