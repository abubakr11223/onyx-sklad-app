// ТЗ №20 J (§11.2) — текстуры для 3D: БД + хранилище.
//
//   saveTexture      — проверка фото (JPG, ≥ 4000 px), превью 2048 px,
//                      пропорции против плиты, upsert StoneTexture + «История».
//   loadTextureZip   — ZIP texture.jpg + texture_2048.jpg + info.txt; собирается
//                      при первом скачивании и лежит в хранилище, пока не
//                      поменяются данные (подпись zipSignature).
//   loadTexturesFor* — что показать в 3D-просмотре (только превью и размер
//                      плиты: ни остатков, ни цен).
//
// Текстура висит на узоре или на однородной партии (без узоров) — ровно как
// единица учёта ТЗ №19. Код вида/плиты/боя в загрузке не принимается.

import type { PrismaClient } from "@prisma/client";
import { findByCode, type StoneCodeHit } from "./stone-code";
import { putStorageFile, readStorageBytes } from "./storage/photo-storage";
import {
  aspectMismatch,
  buildStoredZip,
  checkTextureSize,
  orientedSize,
  textureInfoTxt,
  textureZipName,
  textureZipSignature,
  TEXTURE_PREVIEW_PX,
  type TextureCheckError,
} from "./textures";

export class TextureError extends Error {
  constructor(public code: TextureCheckError | "noTarget" | "hasPatterns") {
    super(code);
    this.name = "TextureError";
  }
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tashkent",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Куда вешается текстура (узор или однородная партия) + данные для info.txt. */
export interface TextureTarget {
  code: string;
  stoneTypeId: string;
  batchId: string | null;
  batchPatternId: string | null;
  name: string;
  rockType: string;
  color: string | null;
  detail: string;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
}

type TargetDb = Pick<PrismaClient, "stoneType" | "batch" | "batchPattern" | "slab" | "piece">;

/** Код узора или однородной партии → цель. Иначе TextureError. */
export async function resolveTextureTarget(db: TargetDb, code: string): Promise<TextureTarget> {
  const hit = await findByCode(db, code);
  if (!hit || (hit.kind !== "PATTERN" && hit.kind !== "BATCH")) throw new TextureError("noTarget");
  if (hit.kind === "PATTERN") {
    const p = await db.batchPattern.findUnique({
      where: { id: hit.ids.batchPatternId! },
      select: {
        id: true,
        code: true,
        description: true,
        lengthMm: true,
        widthMm: true,
        thicknessMm: true,
        batch: {
          select: {
            lengthMm: true,
            widthMm: true,
            thicknessMm: true,
            stoneType: { select: { id: true, name: true, rockType: true, color: true } },
          },
        },
      },
    });
    if (!p) throw new TextureError("noTarget");
    return {
      code: p.code,
      stoneTypeId: p.batch.stoneType.id,
      batchId: null,
      batchPatternId: p.id,
      name: p.batch.stoneType.name,
      rockType: p.batch.stoneType.rockType,
      color: p.batch.stoneType.color,
      detail: `узор «${p.description}»`,
      lengthCm: num(p.lengthMm) ?? num(p.batch.lengthMm),
      widthCm: num(p.widthMm) ?? num(p.batch.widthMm),
      thicknessCm: num(p.thicknessMm) ?? num(p.batch.thicknessMm),
    };
  }
  const b = await db.batch.findUnique({
    where: { id: hit.ids.batchId! },
    select: {
      id: true,
      code: true,
      arrivedAt: true,
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      _count: { select: { patterns: true } },
      stoneType: { select: { id: true, name: true, rockType: true, color: true } },
    },
  });
  if (!b) throw new TextureError("noTarget");
  if (b._count.patterns > 0) throw new TextureError("hasPatterns");
  return {
    code: b.code,
    stoneTypeId: b.stoneType.id,
    batchId: b.id,
    batchPatternId: null,
    name: b.stoneType.name,
    rockType: b.stoneType.rockType,
    color: b.stoneType.color,
    detail: `партия от ${dateFmt.format(b.arrivedAt)}`,
    lengthCm: num(b.lengthMm),
    widthCm: num(b.widthMm),
    thicknessCm: num(b.thicknessMm),
  };
}

export interface SaveTextureResult {
  textureId: string;
  aspectMismatch: boolean;
  widthPx: number;
  heightPx: number;
}

type SaveDb = Pick<PrismaClient, "$transaction">;

/**
 * Сохранить текстуру. originalKey передан → оригинал уже в хранилище (браузер
 * загрузил его напрямую в Blob); иначе кладём байты сами. Превью делаем всегда.
 */
export async function saveTexture(
  db: SaveDb,
  args: {
    target: TextureTarget;
    bytes: Buffer;
    originalKey: string | null;
    actorId: string;
    now?: Date;
  },
): Promise<SaveTextureResult> {
  const sharp = (await import("sharp")).default;
  let meta;
  try {
    meta = await sharp(args.bytes).metadata();
  } catch {
    throw new TextureError("unreadable");
  }
  const sized = orientedSize(meta.width ?? 0, meta.height ?? 0, meta.orientation);
  const err = checkTextureSize(meta.format, sized.widthPx, sized.heightPx, args.bytes.length);
  if (err) throw new TextureError(err);

  const { data: preview, info } = await sharp(args.bytes)
    .rotate() // EXIF-ориентация → «как на экране»
    .resize({
      width: TEXTURE_PREVIEW_PX,
      height: TEXTURE_PREVIEW_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const now = args.now ?? new Date();
  const stamp = now.getTime().toString(36);
  const base = `textures/${args.target.code}/${stamp}`;
  const originalKey =
    args.originalKey ??
    (await putStorageFile({ path: `${base}-original.jpg`, bytes: args.bytes, contentType: "image/jpeg" }))
      .storageKey;
  const previewKey = (
    await putStorageFile({ path: `${base}-2048.jpg`, bytes: preview, contentType: "image/jpeg" })
  ).storageKey;

  const mismatch = aspectMismatch(
    sized.widthPx,
    sized.heightPx,
    args.target.lengthCm,
    args.target.widthCm,
  );
  const t = args.target;
  const data = {
    stoneTypeId: t.stoneTypeId,
    originalKey,
    previewKey,
    widthPx: sized.widthPx,
    heightPx: sized.heightPx,
    previewWidthPx: info.width,
    previewHeightPx: info.height,
    sizeBytes: args.bytes.length,
    aspectMismatch: mismatch,
    zipKey: null,
    zipSignature: null,
    uploadedById: args.actorId,
  };

  const saved = await db.$transaction(async (tx) => {
    const where = t.batchPatternId
      ? { batchPatternId: t.batchPatternId }
      : { batchId: t.batchId! };
    const prev = await tx.stoneTexture.findUnique({ where, select: { id: true } });
    const row = await tx.stoneTexture.upsert({
      where,
      create: { ...data, batchId: t.batchId, batchPatternId: t.batchPatternId },
      update: data,
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorId,
        action: "TEXTURE_UPLOAD",
        entityType: "StoneTexture",
        entityId: row.id,
        payload: {
          code: t.code,
          stoneTypeId: t.stoneTypeId,
          replaced: prev !== null,
          widthPx: sized.widthPx,
          heightPx: sized.heightPx,
          aspectMismatch: mismatch,
        },
      },
    });
    return row;
  });

  return {
    textureId: saved.id,
    aspectMismatch: mismatch,
    widthPx: sized.widthPx,
    heightPx: sized.heightPx,
  };
}

// ───────────────────────────── Скачивание ─────────────────────────────

export interface TextureZip {
  fileName: string;
  /** Vercel Blob: ссылка «скачать». На своём сервере — null, отдаём bytes. */
  downloadUrl: string | null;
  bytes: Buffer | null;
  stoneTypeId: string;
  textureCode: string;
}

type ZipDb = Pick<PrismaClient, "stoneTexture" | "stoneType" | "batch" | "batchPattern" | "slab" | "piece">;

/** ZIP текстуры по коду узора/партии. Нет текстуры → null. */
export async function loadTextureZip(db: ZipDb, code: string): Promise<TextureZip | null> {
  let target: TextureTarget;
  try {
    target = await resolveTextureTarget(db, code);
  } catch {
    return null;
  }
  const where = target.batchPatternId
    ? { batchPatternId: target.batchPatternId }
    : { batchId: target.batchId! };
  const tex = await db.stoneTexture.findUnique({ where });
  if (!tex) return null;

  const fileName = textureZipName(target.code, target.name, target.lengthCm, target.widthCm);
  const info = textureInfoTxt({ ...target, widthPx: tex.widthPx, heightPx: tex.heightPx });
  const signature = textureZipSignature({
    fileName,
    info,
    originalKey: tex.originalKey,
    previewKey: tex.previewKey,
  });

  // Готовый архив с той же подписью — отдаём без пересборки.
  if (tex.zipKey && tex.zipSignature === signature) {
    if (/^https?:\/\//.test(tex.zipKey)) {
      return {
        fileName,
        downloadUrl: blobDownloadUrl(tex.zipKey),
        bytes: null,
        stoneTypeId: target.stoneTypeId,
        textureCode: target.code,
      };
    }
    const bytes = await readStorageBytes(tex.zipKey);
    if (bytes) {
      return { fileName, downloadUrl: null, bytes, stoneTypeId: target.stoneTypeId, textureCode: target.code };
    }
  }

  const [original, preview] = await Promise.all([
    readStorageBytes(tex.originalKey),
    readStorageBytes(tex.previewKey),
  ]);
  if (!original || !preview) return null;
  const zip = buildStoredZip([
    { name: "texture.jpg", data: original },
    { name: "texture_2048.jpg", data: preview },
    { name: "info.txt", data: Buffer.from(info, "utf8") },
  ]);
  const put = await putStorageFile({
    path: `textures/${target.code}/zip-${signature.slice(0, 12)}/${fileName}`,
    bytes: zip,
    contentType: "application/zip",
  });
  await db.stoneTexture.update({
    where: { id: tex.id },
    data: { zipKey: put.storageKey, zipSignature: signature },
  });
  return {
    fileName,
    downloadUrl: put.downloadUrl,
    bytes: put.downloadUrl ? null : zip,
    stoneTypeId: target.stoneTypeId,
    textureCode: target.code,
  };
}

/** Публичный URL Blob → ссылка «скачать» (Blob отдаёт attachment по ?download=1). */
export function blobDownloadUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("download", "1");
  return u.toString();
}

// ───────────────────────────── 3D-просмотр ─────────────────────────────

/** Камень в 3D-сцене: только то, что можно показать клиенту. */
export interface Stone3D {
  textureId: string;
  /** Код для подписи/ссылки на карточку (узор или партия). */
  code: string;
  stoneTypeId: string;
  name: string;
  detail: string | null;
  previewUrl: string;
  lengthCm: number | null;
  widthCm: number | null;
}

const TEXTURE_3D_SELECT = {
  id: true,
  batchId: true,
  batchPatternId: true,
  updatedAt: true,
  stoneTypeId: true,
  stoneType: { select: { name: true } },
  batch: { select: { code: true, lengthMm: true, widthMm: true } },
  batchPattern: {
    select: {
      code: true,
      description: true,
      lengthMm: true,
      widthMm: true,
      batch: { select: { lengthMm: true, widthMm: true } },
    },
  },
} as const;

type Texture3DRow = {
  id: string;
  batchId: string | null;
  batchPatternId: string | null;
  updatedAt: Date;
  stoneTypeId: string;
  stoneType: { name: string };
  batch: { code: string; lengthMm: number | null; widthMm: number | null } | null;
  batchPattern: {
    code: string;
    description: string;
    lengthMm: number | null;
    widthMm: number | null;
    batch: { lengthMm: number | null; widthMm: number | null };
  } | null;
};

export function texturePreviewUrl(id: string, updatedAt: Date): string {
  return `/api/texture-preview/${id}?v=${updatedAt.getTime().toString(36)}`;
}

function toStone3D(r: Texture3DRow): Stone3D {
  const p = r.batchPattern;
  return {
    textureId: r.id,
    code: p?.code ?? r.batch?.code ?? "",
    stoneTypeId: r.stoneTypeId,
    name: r.stoneType.name,
    detail: p ? p.description : null,
    previewUrl: texturePreviewUrl(r.id, r.updatedAt),
    lengthCm: p ? (num(p.lengthMm) ?? num(p.batch.lengthMm)) : num(r.batch?.lengthMm),
    widthCm: p ? (num(p.widthMm) ?? num(p.batch.widthMm)) : num(r.batch?.widthMm),
  };
}

type ListDb = Pick<PrismaClient, "stoneTexture">;

/** Текстуры в области кода (вид / партия / узор / плита / бой). */
export async function loadTexturesForHit(db: ListDb, hit: StoneCodeHit): Promise<Stone3D[]> {
  const { stoneTypeId, batchId, batchPatternId } = hit.ids;
  const where =
    hit.kind === "STONE_TYPE"
      ? { stoneTypeId }
      : hit.kind === "BATCH"
        ? { OR: [{ batchId: batchId! }, { batchPattern: { batchId: batchId! } }] }
        : batchPatternId
          ? { batchPatternId }
          : batchId
            ? { batchId }
            : { stoneTypeId };
  const rows = await db.stoneTexture.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 20,
    select: TEXTURE_3D_SELECT,
  });
  return rows.map(toStone3D);
}

/** По одной (свежей) текстуре на вид — для «похожих», подборки и шоу-рума. */
export async function loadTexturesForTypes(
  db: ListDb,
  stoneTypeIds: readonly string[],
): Promise<Map<string, Stone3D>> {
  const out = new Map<string, Stone3D>();
  if (stoneTypeIds.length === 0) return out;
  const rows = await db.stoneTexture.findMany({
    where: { stoneTypeId: { in: [...new Set(stoneTypeIds)] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: TEXTURE_3D_SELECT,
  });
  for (const r of rows) if (!out.has(r.stoneTypeId)) out.set(r.stoneTypeId, toStone3D(r));
  return out;
}

/** Есть ли текстура у вида (кнопка «Показать в интерьере» в каталоге/карточке). */
export async function typesWithTexture(
  db: ListDb,
  stoneTypeIds: readonly string[],
): Promise<Set<string>> {
  if (stoneTypeIds.length === 0) return new Set();
  const rows = await db.stoneTexture.findMany({
    where: { stoneTypeId: { in: [...new Set(stoneTypeIds)] } },
    distinct: ["stoneTypeId"],
    select: { stoneTypeId: true },
  });
  return new Set(rows.map((r) => r.stoneTypeId));
}

/** Все текстуры видов разом: по узору, по партии и свежая по виду (шоу-рум). */
export async function loadTextureIndex(
  db: ListDb,
  stoneTypeIds: readonly string[],
): Promise<{
  byPattern: Map<string, Stone3D>;
  byBatch: Map<string, Stone3D>;
  byType: Map<string, Stone3D>;
}> {
  const byPattern = new Map<string, Stone3D>();
  const byBatch = new Map<string, Stone3D>();
  const byType = new Map<string, Stone3D>();
  if (stoneTypeIds.length > 0) {
    const rows = await db.stoneTexture.findMany({
      where: { stoneTypeId: { in: [...new Set(stoneTypeIds)] } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: TEXTURE_3D_SELECT,
    });
    for (const r of rows) {
      const s = toStone3D(r);
      if (r.batchPatternId) byPattern.set(r.batchPatternId, s);
      if (r.batchId) byBatch.set(r.batchId, s);
      if (!byType.has(r.stoneTypeId)) byType.set(r.stoneTypeId, s);
    }
  }
  return { byPattern, byBatch, byType };
}
