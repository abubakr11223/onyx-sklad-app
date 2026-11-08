// ТЗ №20 H (§9.1) — карточка камня по скану /k/<код>: одна ссылка, три вида.
//
//   клиент (без входа) — фото, название, порода, цвет, размер, толщина, код и
//                        наличие словом: «В наличии» / «Нет в наличии» /
//                        «В шоу-руме». НИКАКИХ цифр, локаций, цен, клиентов,
//                        менеджеров.
//   партнёр            — то же + свободно плит и м².
//   сотрудник          — то же + плиты/м² по узорам, брони, локации, ориентир
//                        цены и кнопки «Продать» / «Забронировать» / «В шоу-рум».
//
// Две части:
//   • loadCardFacts  — БД: собирает факты по коду. Служебное (брони, локации,
//                      цена) грузится ТОЛЬКО для сотрудника — для клиента этих
//                      данных нет даже в памяти сервера.
//   • buildCardView  — чисто: факты + кто смотрит → то, что уходит в разметку.
//                      Поля выбираются явным списком (не spread), поэтому новое
//                      служебное поле в фактах само к клиенту не утечёт.
//
// Остатки — только общими помощниками: loadStockLevels / loadStockLevelsByBatch
// (min-stock.ts, формула §3 минус брони + выделенные AVAILABLE плиты) и
// loadPatternStock (pattern-stock.ts). Своей арифметики остатка здесь нет.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Capabilities } from "./permissions";
import type { StoneCodeHit, StoneCodeKind } from "./stone-code";
import { loadStockLevels, loadStockLevelsByBatch, type StockLevel } from "./min-stock";
import { formatLocationsShort, loadPatternStock } from "./pattern-stock";
import { formatLocation } from "./locations";
import { formatDim, formatThickness } from "./dimensions";
import { loadQrLabels } from "./qr";
import { reservationListScope } from "./reservations";
import { loadTexturesForHit } from "./texture-store";

export type CardViewer = "client" | "partner" | "staff";

/** Кто смотрит: нет сессии → клиент; PARTNER → партнёр; любой другой вход → сотрудник. */
export function viewerForRole(role: string | null | undefined): CardViewer {
  if (!role) return "client";
  if (role === "PARTNER") return "partner";
  return "staff";
}

export type CardAvailability = "IN_STOCK" | "OUT_OF_STOCK" | "IN_SHOWROOM";

/** Строка «по узорам» для сотрудника (узор или однородная партия). */
export interface StaffStockRow {
  id: string;
  batchId: string;
  /** «узор «светлый»» / «партия от 12.10.2026» */
  label: string;
  code: string | null;
  /** «280 × 160 см · 2 см» или null */
  format: string | null;
  freeSlabs: number;
  freeAreaM2: number;
  heldSlabs: number;
  heldAreaM2: number;
  location: string;
}

export interface StaffReservationRow {
  id: string;
  customerName: string;
  managerName: string;
  expiresAt: Date;
  /** «3 пл.» / «12,5 м²» / «плита» */
  what: string;
}

/** Факты по коду (серверные). Служебные поля заполняются только для staff. */
export interface CardFacts {
  code: string;
  kind: StoneCodeKind;
  stoneTypeId: string;
  ids: StoneCodeHit["ids"];
  name: string;
  rockType: string;
  color: string | null;
  description: string | null;
  /** Уточнение уровня: узор «…» / «Плита №2» / «Бой». */
  detail: string | null;
  size: string | null;
  thickness: string | null;
  photoIds: string[];
  /** ТЗ №20 J (§11.1) — «В интерьере» (готовые работы + AI). Если фото узора
   *  нет, эти же фото идут первыми в photoIds — тогда здесь пусто (без дублей). */
  interiorPhotoIds: string[];
  /** ТЗ №20 J (§11.2) — текстуры для 3D в области кода (узор/партия). */
  textures: Array<{ code: string; detail: string | null }>;
  /** Свободно в области кода (плиты и м²). */
  free: StockLevel;
  /** Свободные куски боя/остатка в области (входят в «В наличии»). */
  freePieces: number;
  /** Что-то из области стоит в шоу-руме (или сама единица там). */
  inShowroom: boolean;
  /** Для кода плиты/куска — её статус; иначе null. */
  unitStatus: string | null;
  // ── только сотрудник ──
  staff: {
    rows: StaffStockRow[];
    location: string | null;
    activeReservations: number;
    reservations: StaffReservationRow[];
    priceHintUzsM2: number | null;
    priceHintUsdM2: number | null;
    /** «партия» или «партия:узор» для «В шоу-рум» (первая со свободными плитами). */
    showroomBatchId: string | null;
  } | null;
}

/**
 * Наличие словом. Единица (плита/кусок): AVAILABLE без «проверить» → в наличии,
 * SHOWROOM → в шоу-руме, остальное (продана, разбита, бронь, образец) — нет.
 * Вид/партия/узор: свободный остаток > 0 или свободный кусок → в наличии;
 * иначе, если что-то стоит в шоу-руме, — в шоу-руме; иначе нет.
 */
export function availabilityOf(
  f: Pick<CardFacts, "free" | "freePieces" | "inShowroom" | "unitStatus" | "kind">,
): CardAvailability {
  if (f.kind === "SLAB" || f.kind === "PIECE") {
    if (f.unitStatus === "SHOWROOM") return "IN_SHOWROOM";
    return f.free.slabs > 0 || f.free.areaM2 > AREA_EPS || f.freePieces > 0
      ? "IN_STOCK"
      : "OUT_OF_STOCK";
  }
  if (f.free.slabs > 0 || f.free.areaM2 > AREA_EPS || f.freePieces > 0) return "IN_STOCK";
  if (f.inShowroom) return "IN_SHOWROOM";
  return "OUT_OF_STOCK";
}

const AREA_EPS = 0.0005;

// ───────────────────────── Вид для разметки ─────────────────────────

/** Общее для всех: витрина камня. */
interface CardBase {
  code: string;
  kind: StoneCodeKind;
  name: string;
  rockType: string;
  color: string | null;
  description: string | null;
  detail: string | null;
  size: string | null;
  thickness: string | null;
  photoIds: string[];
  interiorPhotoIds: string[];
  availability: CardAvailability;
  /** ТЗ №20 J (§11.3) — «Показать в интерьере»: есть текстура для 3D. */
  has3d: boolean;
}

export interface ClientCardView extends CardBase {
  viewer: "client";
}

/** ТЗ №20 J — «Скачать текстуру для 3D» (партнёр и сотрудник). */
export interface TextureDownload {
  code: string;
  label: string;
  href: string;
}

export interface PartnerCardView extends CardBase {
  viewer: "partner";
  stoneTypeId: string;
  textureDownloads: TextureDownload[];
  freeSlabs: number;
  freeAreaM2: number;
}

export interface StaffActions {
  /** null — у роли нет права (кнопку не рисуем). */
  sellHref: string | null;
  reserveHref: string | null;
  showroomHref: string | null;
  fullCardHref: string;
  reservationsHref: string | null;
  historyHref: string | null;
  /** ТЗ №20 I — «В подборку» (canManageCollections). */
  collectionHref: string | null;
}

export interface StaffCardView extends CardBase {
  viewer: "staff";
  stoneTypeId: string;
  textureDownloads: TextureDownload[];
  freeSlabs: number;
  freeAreaM2: number;
  freePieces: number;
  rows: StaffStockRow[];
  location: string | null;
  activeReservations: number;
  reservations: StaffReservationRow[];
  /** null — роли не положено (canSeePriceHint) или ориентир не задан. */
  priceHint: { uzsM2: number | null; usdM2: number | null } | null;
  actions: StaffActions;
}

export type CardView = ClientCardView | PartnerCardView | StaffCardView;

type CardCaps = Pick<
  Capabilities,
  | "canSell"
  | "canReserve"
  | "canSendToShowroom"
  | "canSeePriceHint"
  | "canSeeHistory"
  | "canManageCollections"
>;

/** Ссылки «открыть существующую форму с выбранным камнем». */
export function staffActionsFor(f: CardFacts, caps: CardCaps): StaffActions {
  const byName = encodeURIComponent(f.name);
  let sell = `/prodazha?catalogQ=${byName}`;
  let showroom = "/shourum";
  if (f.kind === "SLAB" && f.ids.slabId) {
    sell = `/prodazha?slab=${encodeURIComponent(f.ids.slabId)}`;
    showroom = `/shourum?unit=${encodeURIComponent(`SLAB:${f.ids.slabId}`)}`;
  } else if (f.kind === "PIECE" && f.ids.pieceId) {
    sell = `/prodazha?piece=${encodeURIComponent(f.ids.pieceId)}`;
    showroom = `/shourum?unit=${encodeURIComponent(`PIECE:${f.ids.pieceId}`)}`;
  } else {
    // Форма шоу-рума выбирает «партия» или «партия:узор» (id строки списка).
    const pick =
      f.kind === "PATTERN" && f.ids.batchId && f.ids.batchPatternId
        ? `${f.ids.batchId}:${f.ids.batchPatternId}`
        : (f.ids.batchId ?? f.staff?.showroomBatchId ?? null);
    if (pick) showroom = `/shourum?batch=${encodeURIComponent(pick)}`;
  }
  return {
    sellHref: caps.canSell ? sell : null,
    reserveHref: caps.canReserve ? `/bron?catalogQ=${byName}` : null,
    showroomHref: caps.canSendToShowroom ? showroom : null,
    fullCardHref: `/kamen/${f.stoneTypeId}`,
    reservationsHref: caps.canReserve ? "/bron" : null,
    historyHref: caps.canSeeHistory ? "/istoriya" : null,
    collectionHref: caps.canManageCollections
      ? `/podborki/dobavit?code=${encodeURIComponent(f.code)}`
      : null,
  };
}

/** Факты + кто смотрит → ровно то, что можно показать (таблица 9.1). */
export function buildCardView(
  f: CardFacts,
  viewer: CardViewer,
  caps: CardCaps,
): CardView {
  const base: CardBase = {
    code: f.code,
    kind: f.kind,
    name: f.name,
    rockType: f.rockType,
    color: f.color,
    description: f.description,
    detail: f.detail,
    size: f.size,
    thickness: f.thickness,
    photoIds: [...f.photoIds],
    interiorPhotoIds: [...f.interiorPhotoIds],
    availability: availabilityOf(f),
    has3d: f.textures.length > 0,
  };
  if (viewer === "client") return { viewer, ...base };
  const textureDownloads: TextureDownload[] = f.textures.map((t) => ({
    code: t.code,
    label: t.detail ? `узор «${t.detail}»` : t.code,
    href: `/api/texture/${encodeURIComponent(t.code)}`,
  }));
  const freeSlabs = Math.max(0, Math.floor(f.free.slabs));
  const freeAreaM2 = Math.max(0, f.free.areaM2);
  if (viewer === "partner") {
    return { viewer, ...base, stoneTypeId: f.stoneTypeId, textureDownloads, freeSlabs, freeAreaM2 };
  }
  const s = f.staff;
  const hint =
    caps.canSeePriceHint &&
    s &&
    (s.priceHintUzsM2 !== null || s.priceHintUsdM2 !== null)
      ? { uzsM2: s.priceHintUzsM2, usdM2: s.priceHintUsdM2 }
      : null;
  return {
    viewer,
    ...base,
    stoneTypeId: f.stoneTypeId,
    textureDownloads,
    freeSlabs,
    freeAreaM2,
    freePieces: f.freePieces,
    rows: s?.rows ?? [],
    location: s?.location ?? null,
    activeReservations: s?.activeReservations ?? 0,
    reservations: s?.reservations ?? [],
    priceHint: hint,
    actions: staffActionsFor(f, caps),
  };
}

// ───────────────────────── Загрузка фактов ─────────────────────────

type DecimalLike = { toString(): string };
const toNum = (d: DecimalLike | number | null | undefined): number | null =>
  d === null || d === undefined ? null : typeof d === "number" ? d : Number(d.toString());

/** Фото камня, которые можно показать на карточке (не чертежи боя). */
/** ТЗ №20 I — тот же список решает «есть фото» в каталоге (catalog.ts). */
export const CARD_PHOTO_KINDS = ["INTERIOR_AI", "INTERIOR", "SAMPLE", "SLAB", "PIECE", "BATCH"] as const;
/** ТЗ №20 J — интерьеры (готовые работы и AI): у вида целиком, на любом уровне кода. */
export const INTERIOR_PHOTO_KINDS = ["INTERIOR", "INTERIOR_AI"] as const;
const INTERIOR_LIMIT = 10;
const CARD_PHOTO_LIMIT = 12;
const STAFF_RESERVATIONS_LIMIT = 10;

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tashkent",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatOf(
  lengthCm: number | null,
  widthCm: number | null,
  thicknessCm: number | null,
): string | null {
  const parts: string[] = [];
  if (lengthCm != null && widthCm != null) {
    parts.push(`${formatDim(lengthCm)} × ${formatDim(widthCm)} см`);
  }
  if (thicknessCm != null) parts.push(`${formatThickness(thicknessCm)} см`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Плиты/куски в области вида, партии или узора (одинаковые колонки у обеих таблиц). */
type UnitScope = { stoneTypeId: string } | { batchId: string } | { batchPatternId: string };

/** Область кода — фильтры Prisma «что принадлежит этому коду». */
function scopeWheres(hit: StoneCodeHit) {
  const { stoneTypeId, batchId, batchPatternId, slabId, pieceId } = hit.ids;
  switch (hit.kind) {
    case "SLAB":
      return {
        unit: null,
        reservation: { slabId: slabId! } as Prisma.ReservationWhereInput,
        photo: [
          { slabId: slabId! },
          ...(batchPatternId ? [{ batchPatternId }] : []),
        ] as Prisma.PhotoWhereInput[],
      };
    case "PIECE":
      return {
        unit: null,
        reservation: { pieceId: pieceId! } as Prisma.ReservationWhereInput,
        photo: [
          { pieceId: pieceId! },
          ...(batchPatternId ? [{ batchPatternId }] : []),
        ] as Prisma.PhotoWhereInput[],
      };
    case "PATTERN":
      return {
        unit: { batchPatternId: batchPatternId! } as UnitScope,
        reservation: {
          OR: [
            { batchPatternId: batchPatternId! },
            { slab: { batchPatternId: batchPatternId! } },
            { piece: { batchPatternId: batchPatternId! } },
          ],
        } as Prisma.ReservationWhereInput,
        photo: [{ batchPatternId: batchPatternId! }] as Prisma.PhotoWhereInput[],
      };
    case "BATCH":
      return {
        unit: { batchId: batchId! } as UnitScope,
        reservation: {
          OR: [
            { batchId: batchId! },
            { slab: { batchId: batchId! } },
            { piece: { batchId: batchId! } },
          ],
        } as Prisma.ReservationWhereInput,
        photo: [
          { batchId: batchId!, kind: "BATCH" },
          { batchPattern: { batchId: batchId! } },
        ] as Prisma.PhotoWhereInput[],
      };
    default:
      return {
        unit: { stoneTypeId } as UnitScope,
        reservation: {
          OR: [
            { batch: { stoneTypeId } },
            { slab: { stoneTypeId } },
            { piece: { stoneTypeId } },
          ],
        } as Prisma.ReservationWhereInput,
        photo: [
          { stoneTypeId, kind: { in: ["SAMPLE", "SLAB"] } },
          { batchPattern: { batch: { stoneTypeId } } },
          { batch: { stoneTypeId }, kind: "BATCH" },
        ] as Prisma.PhotoWhereInput[],
      };
  }
}

/**
 * Факты по найденному коду. viewer решает, что вообще грузить: для клиента и
 * партнёра служебные запросы (брони, локации, цена, узоры) не выполняются.
 */
export async function loadCardFacts(
  db: PrismaClient,
  hit: StoneCodeHit,
  opts: {
    viewer: CardViewer;
    caps: Pick<Capabilities, "canSeeAllReservations">;
    actorId: string | null;
    now?: Date;
  },
): Promise<CardFacts | null> {
  const now = opts.now ?? new Date();
  const isStaff = opts.viewer === "staff";
  const { stoneTypeId, batchId, batchPatternId, slabId, pieceId } = hit.ids;
  const scope = scopeWheres(hit);

  const [st, labels, ownPhotos, interiors, textures] = await Promise.all([
    db.stoneType.findUnique({
      where: { id: stoneTypeId },
      select: {
        name: true,
        rockType: true,
        color: true,
        description: true,
        // Ориентир цены — только в служебную часть (ниже), не в витрину.
        priceHintUzsM2: isStaff,
        priceHintUsdM2: isStaff,
      },
    }),
    loadQrLabels(db, [hit.code]),
    db.photo.findMany({
      where: {
        // Фото партии (BATCH, паллета при приёмке) — складское, только сотрудникам.
        kind: {
          in: isStaff
            ? ["SAMPLE", "SLAB", "PIECE", "BATCH"]
            : ["SAMPLE", "SLAB", "PIECE"],
        },
        OR: scope.photo,
      },
      orderBy: { createdAt: "desc" },
      take: CARD_PHOTO_LIMIT,
      select: { id: true },
    }),
    // ТЗ №20 J (§11.1) — «В интерьере»: у вида целиком, сначала готовые работы.
    db.photo.findMany({
      where: { stoneTypeId, kind: { in: [...INTERIOR_PHOTO_KINDS] } },
      // В БД INTERIOR — последний член enum (ADD VALUE), desc ставит его первым.
      orderBy: [{ kind: "desc" }, { createdAt: "asc" }],
      take: INTERIOR_LIMIT,
      select: { id: true, kind: true },
    }),
    loadTexturesForHit(db, hit),
  ]);
  // «Первым фото, если фото узора нет» (§11.1): без фото узора интерьеры
  // становятся основными фото, отдельной галереи тогда нет (без дублей).
  const interiorIds = [
    ...interiors.filter((p) => p.kind === "INTERIOR"),
    ...interiors.filter((p) => p.kind !== "INTERIOR"),
  ].map((p) => p.id);
  const photoIds = ownPhotos.length > 0 ? ownPhotos.map((p) => p.id) : interiorIds;
  const interiorPhotoIds = ownPhotos.length > 0 ? interiorIds : [];
  if (!st) return null;
  const label = labels[0] ?? null;

  // ── Наличие ──
  let free: StockLevel = { slabs: 0, areaM2: 0 };
  let freePieces = 0;
  let inShowroom = false;
  let unitStatus: string | null = null;
  let unitLocation: string | null = null;

  if (hit.kind === "SLAB" && slabId) {
    const s = await db.slab.findUnique({
      where: { id: slabId },
      select: { status: true, needsCheck: true, areaM2: true, block: true, landmark: true },
    });
    unitStatus = s?.status ?? null;
    if (s && s.status === "AVAILABLE" && !s.needsCheck) {
      free = { slabs: 1, areaM2: toNum(s.areaM2) ?? 0 };
    }
    inShowroom = s?.status === "SHOWROOM";
    unitLocation = s ? formatLocation(s.block, s.landmark) : null;
  } else if (hit.kind === "PIECE" && pieceId) {
    const p = await db.piece.findUnique({
      where: { id: pieceId },
      select: { status: true, needsCheck: true, areaM2: true, block: true, landmark: true },
    });
    unitStatus = p?.status ?? null;
    if (p && p.status === "AVAILABLE" && !p.needsCheck) {
      freePieces = 1;
      free = { slabs: 0, areaM2: toNum(p.areaM2) ?? 0 };
    }
    inShowroom = p?.status === "SHOWROOM";
    unitLocation = p ? formatLocation(p.block, p.landmark) : null;
  } else {
    const unitWhere: UnitScope = scope.unit ?? { stoneTypeId };
    const [levelSum, pieceCount, showroomSlabs, showroomPieces, sepSlabs] =
      await Promise.all([
        hit.kind === "PATTERN"
          ? null
          : hit.kind === "BATCH" && batchId
            ? loadStockLevelsByBatch(db, [batchId], now).then((m) => m.get(batchId)!)
            : loadStockLevels(db, [stoneTypeId], now).then((m) => m.get(stoneTypeId)!),
        db.piece.count({ where: { ...unitWhere, status: "AVAILABLE", needsCheck: false } }),
        db.slab.count({ where: { ...unitWhere, status: "SHOWROOM" } }),
        db.piece.count({ where: { ...unitWhere, status: "SHOWROOM" } }),
        // Узор: loadPatternStock не включает уже выделенные плиты — их
        // AVAILABLE-часть добавляем так же, как min-stock добавляет к партии.
        hit.kind === "PATTERN" && batchPatternId
          ? db.slab.aggregate({
              where: { batchPatternId, status: "AVAILABLE" },
              _count: { _all: true },
              _sum: { areaM2: true },
            })
          : null,
      ]);
    if (hit.kind === "PATTERN" && batchId && batchPatternId) {
      const ps = (await loadPatternStock(db, [batchId], now)).get(batchPatternId);
      free = {
        slabs: (ps?.availableSlabs ?? 0) + (sepSlabs?._count._all ?? 0),
        areaM2: (ps?.availableAreaM2 ?? 0) + (toNum(sepSlabs?._sum.areaM2) ?? 0),
      };
    } else if (levelSum) {
      free = levelSum;
    }
    freePieces = pieceCount;
    inShowroom = showroomSlabs + showroomPieces > 0;
  }

  const facts: CardFacts = {
    code: hit.code,
    kind: hit.kind,
    stoneTypeId,
    ids: hit.ids,
    name: st.name,
    rockType: st.rockType,
    color: st.color,
    description: st.description,
    detail: label?.detail ?? null,
    size: label?.size ?? null,
    thickness: label?.thickness ?? null,
    photoIds,
    interiorPhotoIds,
    textures: textures.map((t) => ({ code: t.code, detail: t.detail })),
    free,
    freePieces,
    inShowroom,
    unitStatus,
    staff: null,
  };
  if (!isStaff) return facts;

  // ── Служебное: только сотрудник ──
  const batchScope =
    hit.kind === "STONE_TYPE"
      ? { stoneTypeId }
      : { id: batchId ?? "__none__" };
  const batches = await db.batch.findMany({
    where: batchScope,
    orderBy: { arrivedAt: "asc" },
    take: 100,
    select: {
      id: true,
      code: true,
      arrivedAt: true,
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      locations: { select: { block: true, landmark: true, slabsHere: true } },
      _count: { select: { patterns: true } },
    },
  });
  const batchIds = batches.map((b) => b.id);
  const listScope = reservationListScope({
    canSeeAllReservations: opts.caps.canSeeAllReservations,
    actorId: opts.actorId,
  });
  const activeRes: Prisma.ReservationWhereInput = {
    AND: [{ status: "ACTIVE", expiresAt: { gt: now } }, scope.reservation],
  };
  const [patternStock, batchLevels, activeCount, visibleRes] = await Promise.all([
    loadPatternStock(db, batchIds, now),
    loadStockLevelsByBatch(
      db,
      batches.filter((b) => b._count.patterns === 0).map((b) => b.id),
      now,
    ),
    db.reservation.count({ where: activeRes }),
    db.reservation.findMany({
      where: { AND: [activeRes, listScope] },
      orderBy: { expiresAt: "asc" },
      take: STAFF_RESERVATIONS_LIMIT,
      select: {
        id: true,
        customerName: true,
        expiresAt: true,
        targetType: true,
        qtySlabs: true,
        qtyAreaM2: true,
        manager: { select: { name: true } },
      },
    }),
  ]);

  const rows: StaffStockRow[] = [];
  for (const b of batches) {
    if (b._count.patterns === 0) {
      const lvl = batchLevels.get(b.id) ?? { slabs: 0, areaM2: 0 };
      rows.push({
        id: b.id,
        batchId: b.id,
        label: `партия от ${dateFmt.format(b.arrivedAt)}`,
        code: b.code,
        format: formatOf(b.lengthMm, b.widthMm, toNum(b.thicknessMm)),
        freeSlabs: lvl.slabs,
        freeAreaM2: lvl.areaM2,
        heldSlabs: 0,
        heldAreaM2: 0,
        location: formatLocationsShort(b.locations),
      });
      continue;
    }
    for (const p of patternStock.values()) {
      if (p.batchId !== b.id) continue;
      if (batchPatternId && p.id !== batchPatternId) continue;
      rows.push({
        id: p.id,
        batchId: b.id,
        label: `узор «${p.description}»`,
        code: null,
        format: formatOf(
          p.lengthMm ?? b.lengthMm,
          p.widthMm ?? b.widthMm,
          p.thicknessMm ?? toNum(b.thicknessMm),
        ),
        freeSlabs: p.availableSlabs,
        freeAreaM2: p.availableAreaM2,
        heldSlabs: p.hold.slabs,
        heldAreaM2: p.hold.areaM2,
        location: formatLocationsShort(p.locations),
      });
    }
  }

  // «В шоу-рум» с карточки вида — первая партия, где есть свободные плиты.
  const freeRow = rows.find((r) => r.freeSlabs > 0);
  const showroomBatchId = freeRow
    ? freeRow.id === freeRow.batchId
      ? freeRow.batchId
      : `${freeRow.batchId}:${freeRow.id}`
    : null;

  facts.staff = {
    rows,
    location:
      unitLocation ??
      (rows.length === 1 ? rows[0].location : null),
    activeReservations: activeCount,
    reservations: visibleRes.map((r) => {
      const qa = toNum(r.qtyAreaM2);
      const what =
        r.targetType === "SLAB"
          ? "плита"
          : r.targetType === "PIECE"
            ? "кусок"
            : [
                r.qtySlabs ? `${r.qtySlabs} пл.` : null,
                qa ? `${m2Fmt.format(qa)} м²` : null,
              ]
                .filter(Boolean)
                .join(" / ") || "объём";
      return {
        id: r.id,
        customerName: r.customerName,
        managerName: r.manager.name,
        expiresAt: r.expiresAt,
        what,
      };
    }),
    priceHintUzsM2: toNum(st.priceHintUzsM2 ?? null),
    priceHintUsdM2: toNum(st.priceHintUsdM2 ?? null),
    showroomBatchId,
  };
  return facts;
}
