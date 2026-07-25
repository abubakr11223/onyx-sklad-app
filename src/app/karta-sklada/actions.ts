"use server";

// ТЗ №6 — редактирование сетки склада (блоки + ориентиры). ТОЛЬКО Владелец
// (getRealSessionUser, как /accounts — defense-in-depth). Удаление блока — только
// если он пустой (нет камня: BatchLocation по букве блока). Все правки → редирект
// обратно в режим редактирования с ok/err.
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
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

export async function addBlock(formData: FormData): Promise<void> {
  await requireOwner();
  const letter = String(formData.get("letter") ?? "").trim();
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
  const id = String(formData.get("blockId") ?? "");
  const letter = String(formData.get("letter") ?? "").trim();
  if (!id || !letter) redirect(`${BACK}&err=letter`);
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
  if (!id) redirect(`${BACK}&err=notfound`);
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
  const id = String(formData.get("blockId") ?? "");
  if (!id) redirect(`${BACK}&err=notfound`);
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
  const blockId = String(formData.get("blockId") ?? "");
  const number = String(formData.get("number") ?? "").trim();
  if (!blockId || !number) redirect(`${BACK}&err=number`);
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
