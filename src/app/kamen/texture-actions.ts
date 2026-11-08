"use server";

// ТЗ №20 J — server actions карточки камня:
//   • текстура для 3D (§11.2): saveUploadedTexture — оригинал уже загружен
//     браузером в Blob (большой файл), uploadTextureFile — свой сервер, файл
//     приходит в форме (лимита 4,5 МБ там нет);
//   • фото «В интерьере» (§11.1): uploadInteriorPhotos / deleteInteriorPhoto.
//
// Права — по реальной сессии (getCurrentUser + capabilitiesFor), как и
// остальные action'ы карточки. Текстурные возвращают результат (их вызывает
// клиентский компонент). Загрузка интерьеров — тоже результат (партиями из
// браузера), удаление — redirect с ?intDel / ?intErr.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { isOwnBlobUrl, readStorageBytes } from "@/lib/storage/photo-storage";
import { resolveTextureTarget, saveTexture, TextureError } from "@/lib/texture-store";
import {
  ASPECT_WARNING_RU,
  INTERIOR_MAX,
  TEXTURE_ERROR_RU,
  TEXTURE_MAX_BYTES,
  TEXTURE_UPLOAD_PREFIX,
} from "@/lib/textures";

export type TextureActionResult =
  | { ok: true; warning: string | null; widthPx: number; heightPx: number }
  | { ok: false; error: string };

async function textureActor(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return capabilitiesFor(user.role, { canSeePurchasePrice: false }).canUploadTexture
    ? user.id
    : null;
}

async function runSave(
  code: string,
  bytes: Buffer,
  originalKey: string | null,
  actorId: string,
): Promise<TextureActionResult> {
  try {
    const target = await resolveTextureTarget(db, code);
    const res = await saveTexture(db, { target, bytes, originalKey, actorId });
    revalidatePath(`/kamen/${target.stoneTypeId}`);
    return {
      ok: true,
      warning: res.aspectMismatch ? ASPECT_WARNING_RU : null,
      widthPx: res.widthPx,
      heightPx: res.heightPx,
    };
  } catch (err) {
    if (err instanceof TextureError) return { ok: false, error: TEXTURE_ERROR_RU[err.code] };
    console.error("[texture] save:", err);
    return { ok: false, error: TEXTURE_ERROR_RU.failed };
  }
}

/** Оригинал загружен браузером в наш Blob → проверить, сделать превью, сохранить. */
export async function saveUploadedTexture(input: {
  code: string;
  blobUrl: string;
}): Promise<TextureActionResult> {
  const actorId = await textureActor();
  if (!actorId) return { ok: false, error: TEXTURE_ERROR_RU.denied };
  if (typeof input?.code !== "string" || typeof input?.blobUrl !== "string") {
    return { ok: false, error: TEXTURE_ERROR_RU.failed };
  }
  // Только наше хранилище и только папка текстур — иначе сервер можно было бы
  // заставить скачать что угодно.
  if (!isOwnBlobUrl(input.blobUrl, TEXTURE_UPLOAD_PREFIX)) {
    return { ok: false, error: TEXTURE_ERROR_RU.failed };
  }
  const bytes = await readStorageBytes(input.blobUrl);
  if (!bytes) return { ok: false, error: TEXTURE_ERROR_RU.unreadable };
  return runSave(input.code, bytes, input.blobUrl, actorId);
}

/** Свой сервер (PHOTO_STORAGE=local): файл приходит в форме целиком. */
export async function uploadTextureFile(formData: FormData): Promise<TextureActionResult> {
  const actorId = await textureActor();
  if (!actorId) return { ok: false, error: TEXTURE_ERROR_RU.denied };
  const code = String(formData.get("code") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: TEXTURE_ERROR_RU.unreadable };
  }
  if (file.size > TEXTURE_MAX_BYTES) return { ok: false, error: TEXTURE_ERROR_RU.tooBig };
  const bytes = Buffer.from(await file.arrayBuffer());
  return runSave(code, bytes, null, actorId);
}

// ───────────────────────────── «В интерьере» ─────────────────────────────

const INTERIOR_MAX_BYTES = 4 * 1024 * 1024;

function back(stoneTypeId: string, q: string): never {
  redirect(`/kamen/${encodeURIComponent(stoneTypeId)}?${q}#interior`);
}

async function interiorActor(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return capabilitiesFor(user.role, { canSeePurchasePrice: false }).canUploadInterior
    ? user.id
    : null;
}

export type InteriorUploadResult = { ok: true; saved: number } | { ok: false; saved: number; error: string };

const INTERIOR_ERR = {
  denied: "Недостаточно прав (загружают владелец и менеджер).",
  nofile: "Выберите фото.",
  badfile: "Файл не похож на фото или слишком большой.",
  limit: `Не больше ${INTERIOR_MAX} фото «В интерьере» на камень.`,
  failed: "Не удалось сохранить фото — попробуйте ещё раз.",
} as const;

/**
 * До 10 фото готовых работ на вид. Браузер заранее ужимает фото до 2560 px
 * (InteriorUploader) и шлёт партиями — каждый запрос меньше лимита функции.
 */
export async function uploadInteriorPhotos(formData: FormData): Promise<InteriorUploadResult> {
  const stoneTypeId = String(formData.get("stoneTypeId") ?? "");
  const actorId = await interiorActor();
  if (!actorId) return { ok: false, saved: 0, error: INTERIOR_ERR.denied };
  const st = await db.stoneType.findUnique({ where: { id: stoneTypeId }, select: { id: true } });
  if (!st) return { ok: false, saved: 0, error: INTERIOR_ERR.failed };

  const files = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, saved: 0, error: INTERIOR_ERR.nofile };
  if (files.some((f) => !f.type.startsWith("image/") || f.size > INTERIOR_MAX_BYTES)) {
    return { ok: false, saved: 0, error: INTERIOR_ERR.badfile };
  }
  const have = await db.photo.count({ where: { stoneTypeId, kind: "INTERIOR" } });
  if (have + files.length > INTERIOR_MAX) return { ok: false, saved: 0, error: INTERIOR_ERR.limit };

  const { putPhotoBlob, createPhotoRecord } = await import("@/lib/photo-blob");
  const now = new Date();
  let saved = 0;
  try {
    for (const [i, f] of files.entries()) {
      const { storageKey } = await putPhotoBlob({
        pathPrefix: `interiors/${stoneTypeId}/${now.getTime().toString(36)}-${i}`,
        bytes: Buffer.from(await f.arrayBuffer()),
        mediaType: f.type,
      });
      await db.$transaction(async (tx) => {
        const photo = await createPhotoRecord(tx, {
          storageKey,
          kind: "INTERIOR",
          takenAt: now,
          takenById: actorId,
          stoneTypeId,
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "PHOTO_UPLOAD",
            entityType: "StoneType",
            entityId: stoneTypeId,
            payload: { kind: "INTERIOR", photoId: photo.id },
          },
        });
      });
      saved++;
    }
  } catch (err) {
    console.error("[interior] upload:", err);
    revalidatePath(`/kamen/${stoneTypeId}`);
    return { ok: false, saved, error: INTERIOR_ERR.failed };
  }
  revalidatePath(`/kamen/${stoneTypeId}`);
  return { ok: true, saved };
}

export async function deleteInteriorPhoto(formData: FormData): Promise<void> {
  const stoneTypeId = String(formData.get("stoneTypeId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  const actorId = await interiorActor();
  if (!actorId) back(stoneTypeId, "intErr=denied");
  // Только фото «В интерьере» этого вида — не узор, не AI, не чужой вид.
  const deleted = await db.$transaction(async (tx) => {
    const res = await tx.photo.deleteMany({
      where: { id: photoId, stoneTypeId, kind: "INTERIOR" },
    });
    if (res.count > 0) {
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "PHOTO_UPLOAD",
          entityType: "StoneType",
          entityId: stoneTypeId,
          payload: { kind: "INTERIOR", photoId, deleted: true },
        },
      });
    }
    return res.count;
  });
  revalidatePath(`/kamen/${stoneTypeId}`);
  back(stoneTypeId, deleted > 0 ? "intDel=1" : "intErr=failed");
}
