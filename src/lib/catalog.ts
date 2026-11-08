// ТЗ №20 I (§10.1, §10.2) — онлайн-каталог /katalog и «Похожие камни».
//
// Каталог — список ВИДОВ камня карточками (фото, название, порода, цвет,
// размеры плит, толщины) → клик открывает карточку /k/<код вида> (часть H).
//
// Кто что видит (таблица 9.1):
//   клиент  — витрина + наличие словом, без цифр;
//   партнёр — + свободно плит и м²;
//   сотрудник — всё, включая виды без фото и с выключенным флагом (с пометкой).
//
// Видимость вида (§10.1): клиенту и партнёру — только если флаг
// «Показывать в каталоге» включён И есть хотя бы одно фото (узора, партии или
// интерьера — тот же набор видов фото CARD_PHOTO_KINDS, что у карточки /k).
// Архивные виды не показываются никому.
//
// Остатки — только общими помощниками (loadStockLevels / loadStockLevelsByBatch
// из min-stock.ts, loadPatternStock из pattern-stock.ts) и та же функция
// «наличия словом», что у карточки (availabilityOf). Форматы плит — сводка
// «Поиска» typeFormatSummary. «Нужный размер» — набор видов из
// poisk-size-fit.ts (та же логика, что /poisk). Своих формул здесь нет.
//
// Модуль: чистые правила (видимость, сортировка, поля по ролям, похожие) +
// тонкие загрузчики с db параметром — тесты гоняют их на mock-БД.

import { hasWantedTraits, traitScore, type WantedTraits } from "./stone-traits";
import { loadTraitsByType } from "./traits-store";
import type { Prisma, PrismaClient } from "@prisma/client";
import { formatDim, formatThickness, thicknessToNumber } from "./dimensions";
import { loadStockLevels, loadStockLevelsByBatch, type StockLevel } from "./min-stock";
import { loadPatternStock } from "./pattern-stock";
import { materialWhere } from "./poisk-search";
import { typeFormatSummary, type TypeFormatEntry } from "./poisk-query";
import { loadPlateFitStoneTypeIds, parsePoiskDim } from "./poisk-size-fit";
import { availabilityOf, type CardAvailability, type CardViewer } from "./public-card";

export type CatalogViewer = CardViewer;

// ───────────────────────── Фильтры ─────────────────────────

export interface CatalogFilters {
  /** Название / порода / цвет / код ONX-… (тот же material-фильтр, что «Поиск»). */
  q: string;
  rock: string;
  color: string;
  /** Толщина, см (1,8 / 2); null — любая. */
  thickness: number | null;
  /** «Нужный размер», см — работает, только если заданы оба. */
  lengthCm: number | null;
  widthCm: number | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

/** Строка запроса → фильтры. Размер — семантика /poisk (parsePoiskDim). */
export function parseCatalogFilters(sp: SearchParams): CatalogFilters {
  const t = firstParam(sp.t).replace(",", ".");
  const tn = t ? Number(t) : NaN;
  return {
    q: firstParam(sp.q).slice(0, 80),
    rock: firstParam(sp.rock).slice(0, 80),
    color: firstParam(sp.color).slice(0, 80),
    thickness: Number.isFinite(tn) && tn > 0 ? Math.round(tn * 10) / 10 : null,
    lengthCm: parsePoiskDim(firstParam(sp.l)),
    widthCm: parsePoiskDim(firstParam(sp.w)),
  };
}

export function hasSizeFilter(
  f: Pick<CatalogFilters, "lengthCm" | "widthCm">,
): f is { lengthCm: number; widthCm: number } {
  return f.lengthCm !== null && f.widthCm !== null;
}

/** Фильтры → строка запроса (пустые поля не пишем). */
export function catalogQueryString(f: Partial<CatalogFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.rock) p.set("rock", f.rock);
  if (f.color) p.set("color", f.color);
  if (f.thickness != null) p.set("t", String(f.thickness));
  if (f.lengthCm != null) p.set("l", String(f.lengthCm));
  if (f.widthCm != null) p.set("w", String(f.widthCm));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ───────────────────────── Факты и правила ─────────────────────────

/** Факты по виду (серверные). Числа остатка уходят в разметку только партнёру/сотруднику. */
export interface CatalogFacts {
  stoneTypeId: string;
  code: string;
  name: string;
  rockType: string;
  color: string | null;
  showInCatalog: boolean;
  /** Первое фото для плитки (не фото паллеты, если есть другое). */
  photoId: string | null;
  hasPhoto: boolean;
  /** Форматы плит: со свободным остатком, а если такого нет — все известные. */
  formats: TypeFormatEntry[];
  free: StockLevel;
  freePieces: number;
  inShowroom: boolean;
}

/** Почему сотрудник видит вид, которого нет в публичном каталоге. */
export type CatalogHiddenReason = "flagOff" | "noPhoto" | null;

export function hiddenReasonOf(f: Pick<CatalogFacts, "showInCatalog" | "hasPhoto">): CatalogHiddenReason {
  if (!f.showInCatalog) return "flagOff";
  if (!f.hasPhoto) return "noPhoto";
  return null;
}

/**
 * §10.1 — вид в каталоге. Сотрудник видит все (неархивные); клиент и партнёр —
 * только с флагом «Показывать в каталоге» и хотя бы одним фото.
 */
export function isCatalogVisible(
  f: Pick<CatalogFacts, "showInCatalog" | "hasPhoto">,
  viewer: CatalogViewer,
): boolean {
  if (viewer === "staff") return true;
  return hiddenReasonOf(f) === null;
}

/** Наличие словом — та же функция, что у карточки /k (уровень «вид»). */
export function catalogAvailability(
  f: Pick<CatalogFacts, "free" | "freePieces" | "inShowroom">,
): CardAvailability {
  return availabilityOf({ ...f, kind: "STONE_TYPE", unitStatus: null });
}

const THICKNESS_EPS = 0.05;

/** Есть ли у вида плита этой толщины (см). */
export function matchesThickness(f: Pick<CatalogFacts, "formats">, t: number | null): boolean {
  if (t === null) return true;
  return f.formats.some(
    (e) => e.thicknessMm !== null && Math.abs(e.thicknessMm - t) < THICKNESS_EPS,
  );
}

/** «280 × 160» для каждого известного L×W (без повторов). */
export function formatSizes(formats: readonly TypeFormatEntry[]): string[] {
  const out: string[] = [];
  for (const e of formats) {
    if (e.lengthMm === null || e.widthMm === null) continue;
    const s = `${formatDim(e.lengthMm)} × ${formatDim(e.widthMm)}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Толщины по возрастанию: «1,8», «2». */
export function formatThicknesses(formats: readonly TypeFormatEntry[]): string[] {
  const nums = [
    ...new Set(
      formats
        .map((e) => e.thicknessMm)
        .filter((t): t is number => t !== null)
        .map((t) => Math.round(t * 10) / 10),
    ),
  ].sort((a, b) => a - b);
  return nums.map(formatThickness);
}

// ───────────────────────── Вид для разметки (по ролям) ─────────────────────────

interface CatalogItemBase {
  code: string;
  name: string;
  rockType: string;
  color: string | null;
  photoId: string | null;
  sizes: string[];
  thicknesses: string[];
  availability: CardAvailability;
  /** ТЗ №20 K — совпадение признаков с ИИ-запросом (только при ИИ-поиске). */
  traitMatch?: number;
}

export interface ClientCatalogItem extends CatalogItemBase {
  viewer: "client";
}

export interface PartnerCatalogItem extends CatalogItemBase {
  viewer: "partner";
  freeSlabs: number;
  freeAreaM2: number;
}

export interface StaffCatalogItem extends CatalogItemBase {
  viewer: "staff";
  stoneTypeId: string;
  freeSlabs: number;
  freeAreaM2: number;
  freePieces: number;
  /** Не в публичном каталоге — почему (сотруднику пометка). */
  hiddenReason: CatalogHiddenReason;
}

export type CatalogItem = ClientCatalogItem | PartnerCatalogItem | StaffCatalogItem;

/**
 * Факты + кто смотрит → плитка. Поля — явным списком (не spread): новое
 * служебное поле в фактах само к клиенту не утечёт (как buildCardView).
 */
export function buildCatalogItem(f: CatalogFacts, viewer: CatalogViewer): CatalogItem {
  const base: CatalogItemBase = {
    code: f.code,
    name: f.name,
    rockType: f.rockType,
    color: f.color,
    photoId: f.photoId,
    sizes: formatSizes(f.formats),
    thicknesses: formatThicknesses(f.formats),
    availability: catalogAvailability(f),
  };
  if (viewer === "client") return { viewer, ...base };
  const freeSlabs = Math.max(0, Math.floor(f.free.slabs));
  const freeAreaM2 = Math.max(0, f.free.areaM2);
  if (viewer === "partner") return { viewer, ...base, freeSlabs, freeAreaM2 };
  return {
    viewer,
    ...base,
    stoneTypeId: f.stoneTypeId,
    freeSlabs,
    freeAreaM2,
    freePieces: f.freePieces,
    hiddenReason: hiddenReasonOf(f),
  };
}

const AVAILABILITY_RANK: Record<CardAvailability, number> = {
  IN_STOCK: 0,
  IN_SHOWROOM: 1,
  OUT_OF_STOCK: 2,
};

const nameCollator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/**
 * §10.1 — сначала в наличии, затем по названию. «В шоу-руме» (камень можно
 * посмотреть, но со склада не свободен) — между наличием и «под заказ».
 */
export function sortCatalog<T extends { availability: CardAvailability; name: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] ||
      nameCollator.compare(a.name, b.name),
  );
}

// ───────────────────────── Похожие камни (§10.2) ─────────────────────────

export const SIMILAR_MAX = 6;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("ru");

/**
 * Ярус похожести: 1 — та же порода и тот же цвет; 2 — та же порода, другой
 * цвет; 3 — другая порода, тот же цвет; null — не похож. Сравнение без учёта
 * регистра и пробелов по краям. Пустой цвет «тем же цветом» не считается.
 *
 * TODO(ТЗ №20 K): ярус 4 — совпадение по признакам ИИ (тон, рисунок), когда
 * у вида появятся признаки (§12.1). Добавлять сюда, порядок 1–3 не трогать.
 */
export function similarTier(
  base: { rockType: string; color: string | null },
  cand: { rockType: string; color: string | null },
): 1 | 2 | 3 | null {
  const sameRock = norm(base.rockType) !== "" && norm(base.rockType) === norm(cand.rockType);
  const sameColor = norm(base.color) !== "" && norm(base.color) === norm(cand.color);
  if (sameRock && sameColor) return 1;
  if (sameRock) return 2;
  if (sameColor) return 3;
  return null;
}

/** Кандидаты → по ярусу, внутри яруса по названию. Себя и непохожих — вон. */
export function rankSimilar<
  T extends { stoneTypeId: string; name: string; rockType: string; color: string | null },
>(base: { stoneTypeId: string; rockType: string; color: string | null }, cands: readonly T[]): T[] {
  const tiered: Array<{ t: number; c: T }> = [];
  for (const c of cands) {
    if (c.stoneTypeId === base.stoneTypeId) continue;
    const t = similarTier(base, c);
    if (t !== null) tiered.push({ t, c });
  }
  tiered.sort((a, b) => a.t - b.t || nameCollator.compare(a.c.name, b.c.name));
  return tiered.map((x) => x.c);
}

/**
 * Готовый список «похожих»: только в наличии (IN_STOCK) и видимые этому
 * зрителю, не больше SIMILAR_MAX, порядок ярусов §10.2.
 */
export function pickSimilar(
  base: { stoneTypeId: string; rockType: string; color: string | null },
  facts: readonly CatalogFacts[],
  viewer: CatalogViewer,
  max: number = SIMILAR_MAX,
): CatalogFacts[] {
  return rankSimilar(
    base,
    facts.filter(
      (f) => isCatalogVisible(f, viewer) && catalogAvailability(f) === "IN_STOCK",
    ),
  ).slice(0, max);
}

// ───────────────────────── Загрузка ─────────────────────────

type DecimalLike = { toString(): string };

/** Строка вида для фактов (общая выборка каталога и «похожих»). */
export interface CatalogTypeRow {
  id: string;
  code: string;
  name: string;
  rockType: string;
  color: string | null;
  showInCatalog: boolean;
}

export const CATALOG_TYPE_SELECT = {
  id: true,
  code: true,
  name: true,
  rockType: true,
  color: true,
  showInCatalog: true,
} as const;

/**
 * Фото вида — те же источники, что карточка /k на уровне вида (public-card
 * scopeWheres → STONE_TYPE + интерьеры), сразу для многих видов.
 */
export function typePhotoWhere(
  ids: readonly string[],
  opts: { includeBatch: boolean } = { includeBatch: false },
): Prisma.PhotoWhereInput {
  const inIds = { in: [...ids] };
  // Фото партии (BATCH — паллета/контейнер при приёмке) — складское (ТЗ №16 B):
  // только сотрудникам; клиенту и партнёру — камень, не склад.
  return {
    kind: {
      in: opts.includeBatch
        ? ["INTERIOR", "INTERIOR_AI", "SAMPLE", "SLAB", "PIECE", "BATCH"]
        : ["INTERIOR", "INTERIOR_AI", "SAMPLE", "SLAB", "PIECE"],
    },
    OR: [
      // ТЗ №20 J — INTERIOR: фото «В интерьере» (готовые работы).
      { stoneTypeId: inIds, kind: { in: ["SAMPLE", "SLAB", "INTERIOR", "INTERIOR_AI"] } },
      { batchPattern: { batch: { stoneTypeId: inIds } } },
      ...(opts.includeBatch ? [{ batch: { stoneTypeId: inIds }, kind: "BATCH" as const }] : []),
    ],
  };
}

/** Приоритет обложки каталога (меньше — лучше). */
export function coverRank(kind: string): number {
  if (kind === "BATCH") return 3;
  if (kind === "INTERIOR_AI") return 2;
  if (kind === "INTERIOR") return 1;
  return 0;
}

/** Факты по видам: фото, остаток (общие помощники), форматы. Без N+1. */
export async function loadCatalogFacts(
  db: PrismaClient,
  types: readonly CatalogTypeRow[],
  now: Date = new Date(),
  viewer: CatalogViewer = "client",
): Promise<CatalogFacts[]> {
  if (types.length === 0) return [];
  const ids = types.map((t) => t.id);

  const [photos, levels, freePieceGroups, showroomSlabGroups, showroomPieceGroups, batches] =
    await Promise.all([
      db.photo.findMany({
        where: typePhotoWhere(ids, { includeBatch: viewer === "staff" }),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          stoneTypeId: true,
          batchPattern: { select: { batch: { select: { stoneTypeId: true } } } },
          batch: { select: { stoneTypeId: true } },
        },
      }),
      loadStockLevels(db, ids, now),
      db.piece.groupBy({
        by: ["stoneTypeId"],
        where: { stoneTypeId: { in: ids }, status: "AVAILABLE", needsCheck: false },
        _count: { _all: true },
      }),
      db.slab.groupBy({
        by: ["stoneTypeId"],
        where: { stoneTypeId: { in: ids }, status: "SHOWROOM" },
        _count: { _all: true },
      }),
      db.piece.groupBy({
        by: ["stoneTypeId"],
        where: { stoneTypeId: { in: ids }, status: "SHOWROOM" },
        _count: { _all: true },
      }),
      db.batch.findMany({
        where: { stoneTypeId: { in: ids } },
        orderBy: [{ arrivedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          stoneTypeId: true,
          lengthMm: true,
          widthMm: true,
          thicknessMm: true,
          patterns: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, lengthMm: true, widthMm: true, thicknessMm: true },
          },
        },
      }),
    ]);

  // Обложка: фото узора/образца → «В интерьере» (§11.1: первым, если фото
  // узора нет; готовые работы раньше AI) → фото партии (только сотрудник).
  const photoByType = new Map<string, { id: string; rank: number }>();
  for (const p of photos) {
    const typeId =
      p.stoneTypeId ?? p.batchPattern?.batch.stoneTypeId ?? p.batch?.stoneTypeId ?? null;
    if (!typeId) continue;
    const cur = photoByType.get(typeId);
    const rank = coverRank(p.kind);
    if (!cur || rank < cur.rank) photoByType.set(typeId, { id: p.id, rank });
  }

  // Форматы — сводка «Поиска» (свободно по узорам / однородным партиям).
  const withPatterns = batches.filter((b) => b.patterns.length > 0).map((b) => b.id);
  const homogeneous = batches.filter((b) => b.patterns.length === 0).map((b) => b.id);
  const [patternStock, batchLevels] = await Promise.all([
    loadPatternStock(db, withPatterns, now),
    loadStockLevelsByBatch(db, homogeneous, now),
  ]);
  const batchesByType = new Map<string, typeof batches>();
  for (const b of batches) {
    const arr = batchesByType.get(b.stoneTypeId) ?? [];
    arr.push(b);
    batchesByType.set(b.stoneTypeId, arr);
  }

  const count = (groups: Array<{ stoneTypeId: string; _count: { _all: number } }>) =>
    new Map(groups.map((g) => [g.stoneTypeId, g._count._all]));
  const freePieces = count(freePieceGroups);
  const showSlabs = count(showroomSlabGroups);
  const showPieces = count(showroomPieceGroups);

  return types.map((t) => {
    const own = batchesByType.get(t.id) ?? [];
    const ownIds = new Set(own.map((b) => b.id));
    const ownPatterns = new Map(
      [...patternStock].filter(([, p]) => ownIds.has(p.batchId)),
    );
    let formats = typeFormatSummary(
      own,
      own
        .filter((b) => b.patterns.length === 0)
        .map((b) => {
          const lvl = batchLevels.get(b.id);
          return { batchId: b.id, slabs: lvl ? lvl.slabs : null, areaM2: lvl ? lvl.areaM2 : null };
        }),
      ownPatterns,
    );
    if (formats.length === 0) formats = allFormatsOf(own);
    const photo = photoByType.get(t.id) ?? null;
    return {
      stoneTypeId: t.id,
      code: t.code,
      name: t.name,
      rockType: t.rockType,
      color: t.color,
      showInCatalog: t.showInCatalog,
      photoId: photo?.id ?? null,
      hasPhoto: photo !== null,
      formats,
      free: levels.get(t.id) ?? { slabs: 0, areaM2: 0 },
      freePieces: freePieces.get(t.id) ?? 0,
      inShowroom: (showSlabs.get(t.id) ?? 0) + (showPieces.get(t.id) ?? 0) > 0,
    };
  });
}

/** Все известные форматы вида (для «под заказ»: свободных нет, размеры — были). */
function allFormatsOf(
  batches: ReadonlyArray<{
    lengthMm: number | null;
    widthMm: number | null;
    thicknessMm: DecimalLike | number | null;
    patterns: ReadonlyArray<{
      lengthMm: number | null;
      widthMm: number | null;
      thicknessMm: DecimalLike | number | null;
    }>;
  }>,
): TypeFormatEntry[] {
  const byKey = new Map<string, TypeFormatEntry>();
  const add = (L: number | null, W: number | null, T: number | null) => {
    if (L === null && W === null && T === null) return;
    const key = `${L ?? ""}×${W ?? ""}×${T ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, { lengthMm: L, widthMm: W, thicknessMm: T, slabs: 0 });
  };
  for (const b of batches) {
    const bT = thicknessToNumber(b.thicknessMm);
    if (b.patterns.length > 0) {
      for (const p of b.patterns) {
        add(p.lengthMm ?? b.lengthMm, p.widthMm ?? b.widthMm, thicknessToNumber(p.thicknessMm) ?? bT);
      }
    } else {
      add(b.lengthMm, b.widthMm, bT);
    }
  }
  return [...byKey.values()];
}

/** Предел видов на странице каталога (склад — десятки видов, не тысячи). */
export const CATALOG_MAX_TYPES = 500;

export interface CatalogResult {
  items: CatalogItem[];
  /** Варианты фильтров «Порода» / «Цвет» / «Толщина» среди видимых видов. */
  options: { rocks: string[]; colors: string[]; thicknesses: number[] };
  /** Сколько видов прошло фильтр. */
  total: number;
  truncated: boolean;
}

/** where видов каталога: неархивные + фильтры (+ флаг для клиента/партнёра). */
export function catalogTypesWhere(
  filters: Pick<CatalogFilters, "q" | "rock" | "color">,
  viewer: CatalogViewer,
  sizeIds: ReadonlySet<string> | null,
): Prisma.StoneTypeWhereInput {
  const and: Prisma.StoneTypeWhereInput[] = [{ isArchived: false }];
  if (viewer !== "staff") and.push({ showInCatalog: true });
  const mat = materialWhere(filters.q);
  if (mat) and.push(mat);
  if (filters.rock) and.push({ rockType: { equals: filters.rock, mode: "insensitive" } });
  if (filters.color) and.push({ color: { equals: filters.color, mode: "insensitive" } });
  if (sizeIds) and.push({ id: { in: [...sizeIds] } });
  return { AND: and };
}

/** /katalog: виды под фильтры → плитки для этого зрителя, в порядке §10.1. */
export async function loadCatalog(
  db: PrismaClient,
  args: { viewer: CatalogViewer; filters: CatalogFilters; now?: Date; wanted?: WantedTraits },
): Promise<CatalogResult> {
  const { viewer, filters } = args;
  const now = args.now ?? new Date();
  const sizeIds = hasSizeFilter(filters)
    ? await loadPlateFitStoneTypeIds(db, {
        lengthCm: filters.lengthCm,
        widthCm: filters.widthCm,
      })
    : null;

  const [rows, optionRows] = await Promise.all([
    sizeIds && sizeIds.size === 0
      ? Promise.resolve([] as CatalogTypeRow[])
      : db.stoneType.findMany({
          where: catalogTypesWhere(filters, viewer, sizeIds),
          orderBy: [{ name: "asc" }],
          take: CATALOG_MAX_TYPES + 1,
          select: CATALOG_TYPE_SELECT,
        }),
    db.stoneType.findMany({
      where: catalogTypesWhere({ q: "", rock: "", color: "" }, viewer, null),
      select: { rockType: true, color: true },
      take: CATALOG_MAX_TYPES,
    }),
  ]);
  const truncated = rows.length > CATALOG_MAX_TYPES;
  const facts = await loadCatalogFacts(db, rows.slice(0, CATALOG_MAX_TYPES), now, viewer);
  const visible = facts.filter((f) => isCatalogVisible(f, viewer));
  const thicknessOptions = [
    ...new Set(
      visible.flatMap((f) =>
        f.formats
          .map((e) => e.thicknessMm)
          .filter((x): x is number => x !== null)
          .map((x) => Math.round(x * 10) / 10),
      ),
    ),
  ].sort((a, b) => a - b);
  let items = sortCatalog(
    visible.filter((f) => matchesThickness(f, filters.thickness)).map((f) => buildCatalogItem(f, viewer)),
  );
  // ТЗ №20 K — ИИ-поиск: тон/рисунок/цвет по признакам узоров ранжируют.
  if (args.wanted && hasWantedTraits(args.wanted)) {
    const wanted = args.wanted;
    const idByCode = new Map(visible.map((f) => [f.code, f.stoneTypeId]));
    const traits = await loadTraitsByType(db, [...idByCode.values()]);
    items = rankByTraits(
      items.map((it) => {
        const list = traits.get(idByCode.get(it.code) ?? "") ?? [];
        const best = list.reduce((m, t) => Math.max(m, traitScore(t, wanted)), 0);
        return { ...it, traitMatch: best };
      }),
    );
  }
  const uniq = (xs: Array<string | null>) =>
    [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))].sort(nameCollator.compare);
  return {
    items,
    options: {
      rocks: uniq(optionRows.map((r) => r.rockType)),
      colors: uniq(optionRows.map((r) => r.color)),
      thicknesses: thicknessOptions,
    },
    total: items.length,
    truncated,
  };
}

/**
 * ТЗ №20 K (§12.3) — ранжирование ИИ-поиска: совпадение признаков →
 * наличие → название (размер уже отфильтрован «Нужным размером»).
 */
export function rankByTraits<T extends { availability: CardAvailability; name: string; traitMatch?: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      (b.traitMatch ?? 0) - (a.traitMatch ?? 0) ||
      AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] ||
      nameCollator.compare(a.name, b.name),
  );
}

/** Порция кандидатов, которую проверяем на наличие за один заход. */
const SIMILAR_CHUNK = 18;

/**
 * §10.2 — до 6 похожих В НАЛИЧИИ для карточки вида. Кандидаты ранжируются
 * по ярусам заранее (дёшево — только названия), остаток считается порциями,
 * пока не набралось 6: так тяжёлый расчёт не идёт по всей породе.
 */
export async function loadSimilarStones(
  db: PrismaClient,
  stoneTypeId: string,
  opts: { viewer: CatalogViewer; now?: Date; max?: number },
): Promise<CatalogItem[]> {
  const max = opts.max ?? SIMILAR_MAX;
  const now = opts.now ?? new Date();
  const base = await db.stoneType.findUnique({
    where: { id: stoneTypeId },
    select: { id: true, rockType: true, color: true },
  });
  if (!base) return [];
  const or: Prisma.StoneTypeWhereInput[] = [
    { rockType: { equals: base.rockType, mode: "insensitive" } },
  ];
  if (base.color && base.color.trim()) {
    or.push({ color: { equals: base.color.trim(), mode: "insensitive" } });
  }
  const cands = await db.stoneType.findMany({
    where: {
      AND: [
        { isArchived: false, id: { not: base.id } },
        ...(opts.viewer !== "staff" ? [{ showInCatalog: true }] : []),
        { OR: or },
      ],
    },
    orderBy: [{ name: "asc" }],
    take: CATALOG_MAX_TYPES,
    select: CATALOG_TYPE_SELECT,
  });
  const baseKey = { stoneTypeId: base.id, rockType: base.rockType, color: base.color };
  const ranked = rankSimilar(
    baseKey,
    cands.map((c) => ({ ...c, stoneTypeId: c.id })),
  );
  const picked: CatalogFacts[] = [];
  for (let i = 0; i < ranked.length && picked.length < max; i += SIMILAR_CHUNK) {
    const facts = await loadCatalogFacts(db, ranked.slice(i, i + SIMILAR_CHUNK), now, opts.viewer);
    picked.push(...pickSimilar(baseKey, facts, opts.viewer, max - picked.length));
  }
  return picked.map((f) => buildCatalogItem(f, opts.viewer));
}
