// ТЗ №20 K (§12.1) — признаки узора/партии: БД, фото, ИИ.
//
//   refreshTraitsFor   — по свежему фото узора/партии выставить признаки (ИИ).
//                        Ручную правку (MANUAL) не трогает; то же фото второй
//                        раз не отправляет (photoId).
//   refreshTraitsBacklog — фоновый пересчёт: цели без признаков или с новым
//                        фото, порциями (cron + первый пересчёт после внедрения).
//   saveManualTraits   — правка сотрудником (в «Историю»).
//   loadTraitsByType   — признаки для ранжирования поиска.

import type { Prisma, PrismaClient } from "@prisma/client";
import { aiAnalyzeStonePhoto, type CatalogVocabulary, type VisionDeps } from "./ai-vision";
import { readStorageBytes, isLocalKey, isRemoteUrl } from "./storage/photo-storage";
import { downloadFile, getFile } from "./telegram";
import { isPattern, isTone, isTraitColor, type StoneTraitsValue } from "./stone-traits";

/** Узор или однородная партия (как у текстуры — единица учёта ТЗ №19). */
export interface TraitsTarget {
  stoneTypeId: string;
  batchId: string | null;
  batchPatternId: string | null;
}

const TARGET_PHOTO_KINDS = ["SAMPLE", "SLAB", "BATCH"] as const;

/** Байты фото по storageKey: Blob-URL, свой диск или Telegram file_id. */
export async function readPhotoBytes(storageKey: string): Promise<Buffer | null> {
  if (isRemoteUrl(storageKey) || isLocalKey(storageKey)) return readStorageBytes(storageKey);
  try {
    const f = await getFile(storageKey);
    if (!f?.file_path) return null;
    const bytes = await downloadFile(f.file_path);
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

type VisionMedia = "image/jpeg" | "image/png" | "image/webp";

/** Тип картинки по первым байтам (без библиотек). */
export function sniffImageType(b: Uint8Array): VisionMedia | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    return "image/webp";
  }
  return null;
}

/** Предел картинки для модели (5 МБ) с запасом. */
const VISION_RAW_MAX = 4.5 * 1024 * 1024;

/**
 * Фото для ИИ: JPEG ≤ 1568 px (лимит модели, меньше трафика). Если sharp
 * недоступен (нативная библиотека не загрузилась), отдаём исходник, когда
 * он и так подходит модели (JPEG/PNG/WebP до 4,5 МБ) — поиск не ломается.
 */
export async function prepareForVision(bytes: Buffer): Promise<{ bytes: Buffer; mediaType: VisionMedia } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { bytes: out, mediaType: "image/jpeg" };
  } catch (err) {
    const type = sniffImageType(bytes);
    if (type && bytes.length <= VISION_RAW_MAX) return { bytes, mediaType: type };
    console.warn("[traits] фото не подготовлено:", (err as Error).message.slice(0, 200));
    return null;
  }
}

/** Породы и цвета видов, что есть в каталоге (словарь для ИИ). */
export async function catalogVocabulary(db: Pick<PrismaClient, "stoneType">): Promise<CatalogVocabulary> {
  const rows = await db.stoneType.findMany({
    where: { isArchived: false },
    select: { rockType: true, color: true },
    take: 1000,
  });
  const uniq = (xs: Array<string | null>) =>
    [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  return { rocks: uniq(rows.map((r) => r.rockType)), colors: uniq(rows.map((r) => r.color)) };
}

type PhotoDb = Pick<PrismaClient, "photo">;

/** Самое свежее фото узора / однородной партии (фото узора важнее паллеты). */
export async function latestTargetPhoto(
  db: PhotoDb,
  t: TraitsTarget,
): Promise<{ id: string; storageKey: string } | null> {
  const where: Prisma.PhotoWhereInput = t.batchPatternId
    ? { batchPatternId: t.batchPatternId, kind: { in: ["SAMPLE", "SLAB"] } }
    : {
        OR: [
          { batchId: t.batchId!, kind: "BATCH" },
          { slab: { batchId: t.batchId! }, kind: { in: [...TARGET_PHOTO_KINDS] } },
        ],
      };
  const rows = await db.photo.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 3,
    select: { id: true, storageKey: true, kind: true },
  });
  // Однородная партия: фото плиты точнее, чем паллета при приёмке.
  const best = rows.find((r) => r.kind !== "BATCH") ?? rows[0] ?? null;
  return best ? { id: best.id, storageKey: best.storageKey } : null;
}

function ownerWhere(t: TraitsTarget) {
  return t.batchPatternId ? { batchPatternId: t.batchPatternId } : { batchId: t.batchId! };
}

type RefreshDb = Pick<PrismaClient, "photo" | "stoneTraits" | "stoneType">;

export type RefreshResult = "updated" | "manual" | "same-photo" | "no-photo" | "ai-failed";

/**
 * Выставить признаки цели по её свежему фото. Никогда не бросает: ИИ не
 * ответил — "ai-failed" (попробуем в следующий раз).
 */
export async function refreshTraitsFor(
  db: RefreshDb,
  t: TraitsTarget,
  opts: { vocab?: CatalogVocabulary; deps?: VisionDeps } = {},
): Promise<RefreshResult> {
  try {
    const existing = await db.stoneTraits.findUnique({
      where: ownerWhere(t),
      select: { source: true, photoId: true },
    });
    if (existing?.source === "MANUAL") return "manual";
    const photo = await latestTargetPhoto(db, t);
    if (!photo) return "no-photo";
    if (existing?.photoId === photo.id) return "same-photo";
    const raw = await readPhotoBytes(photo.storageKey);
    const img = raw ? await prepareForVision(raw) : null;
    if (!img) return "ai-failed";
    const vocab = opts.vocab ?? (await catalogVocabulary(db));
    // Фоновая работа — ждём дольше, чем в живом поиске.
    const traits = await aiAnalyzeStonePhoto(img, vocab, { forSearch: false, timeoutMs: 30_000 }, opts.deps);
    if (!traits) return "ai-failed";
    const data = {
      color: traits.color,
      tone: traits.tone,
      pattern: traits.pattern,
      veinColor: traits.veinColor,
      source: "AI" as const,
      photoId: photo.id,
    };
    // updateMany с условием «не MANUAL»: ручная правка, успевшая между чтением
    // и записью, не перетирается.
    const upd = await db.stoneTraits.updateMany({
      where: { ...ownerWhere(t), source: "AI" },
      data,
    });
    if (upd.count === 0) {
      const again = await db.stoneTraits.findUnique({ where: ownerWhere(t), select: { id: true } });
      if (again) return "manual";
      await db.stoneTraits.create({
        data: { ...data, stoneTypeId: t.stoneTypeId, batchId: t.batchId, batchPatternId: t.batchPatternId },
      });
    }
    return "updated";
  } catch (err) {
    console.warn("[traits] refresh failed:", (err as Error).message);
    return "ai-failed";
  }
}

type BacklogDb = RefreshDb & Pick<PrismaClient, "batch">;

/** Цели вида/партий: узоры, а у партий без узоров — сама партия. */
export async function traitsTargets(
  db: Pick<PrismaClient, "batch">,
  where: Prisma.BatchWhereInput,
): Promise<TraitsTarget[]> {
  const batches = await db.batch.findMany({
    where,
    orderBy: [{ arrivedAt: "desc" }, { id: "asc" }],
    select: { id: true, stoneTypeId: true, patterns: { select: { id: true } } },
  });
  return batches.flatMap((b): TraitsTarget[] =>
    b.patterns.length > 0
      ? b.patterns.map((p) => ({ stoneTypeId: b.stoneTypeId, batchId: null, batchPatternId: p.id }))
      : [{ stoneTypeId: b.stoneTypeId, batchId: b.id, batchPatternId: null }],
  );
}

/** После загрузки фото (приёмка, правка партии) — признаки этих партий. */
export async function refreshTraitsForBatches(
  db: BacklogDb,
  batchIds: readonly string[],
  deps?: VisionDeps,
): Promise<Record<RefreshResult, number>> {
  const counts: Record<RefreshResult, number> = {
    updated: 0,
    manual: 0,
    "same-photo": 0,
    "no-photo": 0,
    "ai-failed": 0,
  };
  if (batchIds.length === 0) return counts;
  const targets = await traitsTargets(db, { id: { in: [...batchIds] } });
  const vocab = await catalogVocabulary(db);
  for (const t of targets) counts[await refreshTraitsFor(db, t, { vocab, deps })]++;
  return counts;
}

/**
 * Фоновый пересчёт: цели без признаков (или с фото новее, чем у признаков),
 * не больше `limit` обращений к ИИ за запуск. Первый запуск после внедрения
 * проходит весь склад за несколько ночей (по `limit` целей).
 */
export async function refreshTraitsBacklog(
  db: BacklogDb,
  opts: { limit: number; deps?: VisionDeps },
): Promise<Record<RefreshResult, number> & { scanned: number }> {
  const targets = await traitsTargets(db, { stoneType: { isArchived: false } });
  const existing = await db.stoneTraits.findMany({
    select: { batchId: true, batchPatternId: true, source: true },
  });
  const manual = new Set(
    existing.filter((e) => e.source === "MANUAL").map((e) => e.batchPatternId ?? e.batchId),
  );
  const has = new Set(existing.map((e) => e.batchPatternId ?? e.batchId));
  // Сначала цели без признаков, затем остальные (новое фото проверит refresh).
  const ordered = [
    ...targets.filter((t) => !has.has(t.batchPatternId ?? t.batchId)),
    ...targets.filter((t) => has.has(t.batchPatternId ?? t.batchId)),
  ].filter((t) => !manual.has(t.batchPatternId ?? t.batchId));

  const counts = { updated: 0, manual: 0, "same-photo": 0, "no-photo": 0, "ai-failed": 0, scanned: 0 };
  const vocab = await catalogVocabulary(db);
  let aiCalls = 0;
  for (const t of ordered) {
    if (aiCalls >= opts.limit) break;
    counts.scanned++;
    const r = await refreshTraitsFor(db, t, { vocab, deps: opts.deps });
    counts[r]++;
    if (r === "updated" || r === "ai-failed") aiCalls++;
  }
  return counts;
}

// ───────────────────────── Ручная правка ─────────────────────────

export type ManualTraitsInput = Partial<Record<"color" | "tone" | "pattern" | "veinColor", string>>;

/** Значения формы → признаки (пустое поле — «не задано»). null — мусор в форме. */
export function parseManualTraits(raw: ManualTraitsInput): StoneTraitsValue | null {
  const pick = (v: string | undefined) => (v ?? "").trim();
  const color = pick(raw.color);
  const tone = pick(raw.tone);
  const pattern = pick(raw.pattern);
  const vein = pick(raw.veinColor);
  if (color && !isTraitColor(color)) return null;
  if (tone && !isTone(tone)) return null;
  if (pattern && !isPattern(pattern)) return null;
  if (vein && !isTraitColor(vein)) return null;
  return {
    color: color || null,
    tone: tone ? (tone as StoneTraitsValue["tone"]) : null,
    pattern: pattern ? (pattern as StoneTraitsValue["pattern"]) : null,
    veinColor: vein || null,
  };
}

/** Сохранить ручную правку (source = MANUAL — ИИ больше не перезаписывает). */
export async function saveManualTraits(
  db: Pick<PrismaClient, "$transaction">,
  args: { target: TraitsTarget; value: StoneTraitsValue; actorId: string },
): Promise<string> {
  const t = args.target;
  return db.$transaction(async (tx) => {
    const prev = await tx.stoneTraits.findUnique({
      where: ownerWhere(t),
      select: { color: true, tone: true, pattern: true, veinColor: true, source: true },
    });
    const row = await tx.stoneTraits.upsert({
      where: ownerWhere(t),
      create: {
        ...args.value,
        source: "MANUAL",
        editedById: args.actorId,
        stoneTypeId: t.stoneTypeId,
        batchId: t.batchId,
        batchPatternId: t.batchPatternId,
      },
      update: { ...args.value, source: "MANUAL", editedById: args.actorId },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorId,
        action: "TRAITS_EDIT",
        entityType: "StoneTraits",
        entityId: row.id,
        payload: {
          stoneTypeId: t.stoneTypeId,
          batchId: t.batchId,
          batchPatternId: t.batchPatternId,
          from: prev ?? null,
          to: { ...args.value },
        } as Prisma.InputJsonValue,
      },
    });
    return row.id;
  });
}

// ───────────────────────── Для поиска ─────────────────────────

/** Признаки всех узоров/партий видов (вид → список). */
export async function loadTraitsByType(
  db: Pick<PrismaClient, "stoneTraits">,
  stoneTypeIds: readonly string[],
): Promise<Map<string, StoneTraitsValue[]>> {
  const out = new Map<string, StoneTraitsValue[]>();
  if (stoneTypeIds.length === 0) return out;
  const rows = await db.stoneTraits.findMany({
    where: { stoneTypeId: { in: [...new Set(stoneTypeIds)] } },
    select: { stoneTypeId: true, color: true, tone: true, pattern: true, veinColor: true },
  });
  for (const r of rows) {
    const arr = out.get(r.stoneTypeId) ?? [];
    arr.push({ color: r.color, tone: r.tone, pattern: r.pattern, veinColor: r.veinColor });
    out.set(r.stoneTypeId, arr);
  }
  return out;
}
