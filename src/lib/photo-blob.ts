// Аудит ТЗ №7 #29 — последовательность put(Vercel Blob) → db.photo.create была
// продублирована в priemka/actions.ts:submitIntake (SAMPLE узор-фото) и
// kamen/actions.ts:generateInteriors (INTERIOR_AI). Разошлась мелочью
// extFromMime (priemka знает про webp, kamen — только png/jpg). Здесь — единый
// helper, extFromMime — часть контракта, дубль убран.

import type { PhotoKind, Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { db } from "./db";

/** MIME image/png | image/webp | остальное (image/jpeg по умолчанию) → расширение файла. */
export function extFromMime(mime: string): "png" | "webp" | "jpg" {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

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
  photoRequestId?: string | null;
}

/**
 * put() → db.photo.create в одной обёртке. Возвращает созданную Photo (id + url).
 * Ошибку не глотает — вызывающий сам решит (аудит хочет консистентности; priemka
 * ловит и продолжает без photo, kamen выбрасывает наверх).
 */
export async function storePhotoBlob(
  params: StorePhotoBlobParams,
): Promise<{ id: string; url: string }> {
  const ext = extFromMime(params.mediaType);
  const blob = await put(`${params.pathPrefix}.${ext}`, params.bytes, {
    access: "public",
    contentType: params.mediaType,
  });
  const data: Prisma.PhotoUncheckedCreateInput = {
    storageKey: blob.url,
    kind: params.kind,
    takenAt: params.takenAt,
    takenById: params.takenById ?? null,
    stoneTypeId: params.stoneTypeId ?? null,
    slabId: params.slabId ?? null,
    pieceId: params.pieceId ?? null,
    batchPatternId: params.batchPatternId ?? null,
    photoRequestId: params.photoRequestId ?? null,
  };
  const photo = await db.photo.create({ data, select: { id: true } });
  return { id: photo.id, url: blob.url };
}
