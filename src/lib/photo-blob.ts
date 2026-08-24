// Аудит ТЗ №7 #29 — последовательность put(Vercel Blob) → db.photo.create была
// продублирована в priemka/actions.ts:submitIntake (SAMPLE узор-фото) и
// kamen/actions.ts:generateInteriors (INTERIOR_AI). Разошлась мелочью
// extFromMime (priemka знает про webp, kamen — только png/jpg). Здесь — единый
// helper, extFromMime — часть контракта, дубль убран.
//
// final/pattern-photo: put + create split so batch-edit can put outside the
// Prisma TX then create Photo rows inside the same TX as field changes
// (atomic DB; blob put is not transactional by nature).

import type { PhotoKind, Prisma } from "@prisma/client";
import { db } from "./db";
import { extFromMime, putPhotoObject } from "./storage/photo-storage";

// extFromMime endi ombor moduli bilan umumiy (bir xil qoida ikki joyda
// yashamasin) — eski import yo'llari buzilmasin uchun bu yerdan ham chiqaramiz.
export { extFromMime };

export interface StorePhotoBlobParams {
  /** Префикс пути в Blob (например `patterns/{batchId}/{patternId}-{ts}`).
   *  Расширение файла добавляется helper'ом из mediaType — НЕ включай его в path. */
  pathPrefix: string;
  bytes: Buffer;
  /** MIME из источника (File.type / модель). Используется и для Blob contentType, и для .ext. */
  mediaType: string;
  kind: PhotoKind;
  /** Момент съёмки / генерации — фиксируется как Photo.takenAt (TZ §5.3). */
  takenAt: Date;
  takenById?: string | null;
  stoneTypeId?: string | null;
  slabId?: string | null;
  pieceId?: string | null;
  batchPatternId?: string | null;
  /** ТЗ №16 B — фото партии целиком (общий вид поставки). */
  batchId?: string | null;
  photoRequestId?: string | null;
}

export type PhotoDbClient = {
  photo: {
    create: (args: {
      data: Prisma.PhotoUncheckedCreateInput;
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
};

/**
 * Upload bytes to Vercel Blob only (no DB). Caller must create Photo in the
 * same domain transaction that depends on this file existing.
 */
export async function putPhotoBlob(params: {
  pathPrefix: string;
  bytes: Buffer;
  mediaType: string;
}): Promise<{ storageKey: string; mediaType: string }> {
  // ТЗ (ko'chirish) — ombor drayver ortida: Vercel Blob yoki o'z diskimiz.
  // Bu yerda tanlov YO'Q: qaysi drayver ishlashini PHOTO_STORAGE hal qiladi.
  return putPhotoObject({
    pathPrefix: params.pathPrefix,
    bytes: params.bytes,
    mediaType: params.mediaType,
  });
}

/** Insert Photo row via optional TX client (default: global db). */
export async function createPhotoRecord(
  client: PhotoDbClient,
  params: {
    storageKey: string;
    mediaType?: string; // unused — storageKey already has url
    kind: PhotoKind;
    takenAt: Date;
    takenById?: string | null;
    stoneTypeId?: string | null;
    slabId?: string | null;
    pieceId?: string | null;
    batchPatternId?: string | null;
    batchId?: string | null;
    photoRequestId?: string | null;
  },
): Promise<{ id: string; url: string }> {
  const data: Prisma.PhotoUncheckedCreateInput = {
    storageKey: params.storageKey,
    kind: params.kind,
    takenAt: params.takenAt,
    takenById: params.takenById ?? null,
    stoneTypeId: params.stoneTypeId ?? null,
    slabId: params.slabId ?? null,
    pieceId: params.pieceId ?? null,
    batchPatternId: params.batchPatternId ?? null,
    batchId: params.batchId ?? null,
    photoRequestId: params.photoRequestId ?? null,
  };
  const photo = await client.photo.create({ data, select: { id: true } });
  return { id: photo.id, url: params.storageKey };
}

/**
 * put() → db.photo.create в одной обёртке. Возвращает созданную Photo (id + url).
 * Ошибку не глотает — вызывающий сам решит (аудит хочет консистентности; priemka
 * ловит и продолжает без photo, kamen выбрасывает наверх).
 */
export async function storePhotoBlob(
  params: StorePhotoBlobParams,
): Promise<{ id: string; url: string }> {
  const { storageKey } = await putPhotoBlob({
    pathPrefix: params.pathPrefix,
    bytes: params.bytes,
    mediaType: params.mediaType,
  });
  return createPhotoRecord(db, {
    storageKey,
    kind: params.kind,
    takenAt: params.takenAt,
    takenById: params.takenById,
    stoneTypeId: params.stoneTypeId,
    slabId: params.slabId,
    pieceId: params.pieceId,
    batchPatternId: params.batchPatternId,
    batchId: params.batchId,
    photoRequestId: params.photoRequestId,
  });
}
