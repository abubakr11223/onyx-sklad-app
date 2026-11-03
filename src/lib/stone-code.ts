// ТЗ №20 G (§8.1) — постоянный код камня «ONX-XXXXX».
//
// Код выдаёт БД (onx_new_code() в миграции 20261103100000_tz20_wave1) пяти
// таблицам: вид камня, партия, узор, плита, бой/остаток. Здесь — только чтение:
//   • normalizeStoneCode — разбор того, что человек ввёл/вставил (без БД);
//   • findByCode         — какая запись носит этот код (5 точечных запросов
//                          по unique-индексу);
//   • loadStoneCodeCard  — короткая сводка для Telegram-бота (§8.4).
//
// Этим же резолвером позже пользуются публичная /k/<код> (часть H) и каталог.

import type { PrismaClient } from "@prisma/client";
import { formatLocation } from "./locations";
// poisk-query / pattern-stock грузим лениво внутри loadStoneCodeCard: их тянет
// только бот, а poisk-search сам импортирует normalizeStoneCode отсюда —
// статический импорт дал бы цикл stone-code → poisk-query → poisk-search.

/** Алфавит кода — без похожих 0/O и 1/I (тот же, что в onx_new_code()). */
export const STONE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const STONE_CODE_PREFIX = "ONX-";

const CODE_RE = /^(ONX[-_–—]?)?([2-9A-HJ-NP-Z]{5})$/;

/**
 * Приводит ввод к каноническому «ONX-XXXXX» или null.
 *
 * Принимает: «ONX-7K3QD», «onx-7k3qd», «ONX 7K3QD», «ONX7K3QD», «7k3qd»
 * и целую ссылку «https://…/k/ONX-7K3QD» (её вставляют из сканера).
 * `requirePrefix` — голые 5 символов не считаются кодом (бот: обычное слово
 * из 5 букв не должно превращаться в поиск по коду).
 */
export function normalizeStoneCode(
  raw: string | null | undefined,
  opts: { requirePrefix?: boolean } = {},
): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toUpperCase();
  if (s === "" || s.length > 300) return null;
  // Ссылка с этикетки: берём хвост после последнего «/K/».
  const k = s.lastIndexOf("/K/");
  if (k >= 0) {
    s = s.slice(k + 3).split(/[/?#]/)[0] ?? "";
  }
  s = s.replace(/\s+/g, "");
  const m = CODE_RE.exec(s);
  if (!m) return null;
  if (opts.requirePrefix && !m[1]) return null;
  return STONE_CODE_PREFIX + m[2];
}

export type StoneCodeKind = "STONE_TYPE" | "BATCH" | "PATTERN" | "SLAB" | "PIECE";

export const STONE_CODE_KIND_RU: Record<StoneCodeKind, string> = {
  STONE_TYPE: "Вид камня",
  BATCH: "Партия",
  PATTERN: "Узор",
  SLAB: "Плита",
  PIECE: "Бой / остаток",
};

/** Что нашлось по коду. ids — всё, что нужно, чтобы открыть место в карточке. */
export interface StoneCodeHit {
  kind: StoneCodeKind;
  code: string;
  stoneTypeId: string;
  ids: {
    stoneTypeId: string;
    batchId: string | null;
    batchPatternId: string | null;
    slabId: string | null;
    pieceId: string | null;
  };
}

export type StoneCodeDb = Pick<
  PrismaClient,
  "stoneType" | "batch" | "batchPattern" | "slab" | "piece"
>;

/**
 * Ищет код во всех пяти таблицах. Код уникален по всей системе (§8.1), так что
 * совпадение максимум одно; порядок проверки — от общего к частному.
 */
export async function findByCode(
  database: StoneCodeDb,
  raw: string | null | undefined,
): Promise<StoneCodeHit | null> {
  const code = normalizeStoneCode(raw);
  if (!code) return null;
  const where = { code };
  const [st, batch, pattern, slab, piece] = await Promise.all([
    database.stoneType.findUnique({ where, select: { id: true } }),
    database.batch.findUnique({ where, select: { id: true, stoneTypeId: true } }),
    database.batchPattern.findUnique({
      where,
      select: { id: true, batchId: true, batch: { select: { stoneTypeId: true } } },
    }),
    database.slab.findUnique({
      where,
      select: { id: true, batchId: true, batchPatternId: true, stoneTypeId: true },
    }),
    database.piece.findUnique({
      where,
      select: { id: true, batchId: true, batchPatternId: true, stoneTypeId: true },
    }),
  ]);
  const ids = (p: Partial<StoneCodeHit["ids"]> & { stoneTypeId: string }) => ({
    batchId: null,
    batchPatternId: null,
    slabId: null,
    pieceId: null,
    ...p,
  });
  if (st) {
    return { kind: "STONE_TYPE", code, stoneTypeId: st.id, ids: ids({ stoneTypeId: st.id }) };
  }
  if (batch) {
    return {
      kind: "BATCH",
      code,
      stoneTypeId: batch.stoneTypeId,
      ids: ids({ stoneTypeId: batch.stoneTypeId, batchId: batch.id }),
    };
  }
  if (pattern) {
    const stoneTypeId = pattern.batch.stoneTypeId;
    return {
      kind: "PATTERN",
      code,
      stoneTypeId,
      ids: ids({ stoneTypeId, batchId: pattern.batchId, batchPatternId: pattern.id }),
    };
  }
  if (slab) {
    return {
      kind: "SLAB",
      code,
      stoneTypeId: slab.stoneTypeId,
      ids: ids({
        stoneTypeId: slab.stoneTypeId,
        batchId: slab.batchId,
        batchPatternId: slab.batchPatternId,
        slabId: slab.id,
      }),
    };
  }
  if (piece) {
    return {
      kind: "PIECE",
      code,
      stoneTypeId: piece.stoneTypeId,
      ids: ids({
        stoneTypeId: piece.stoneTypeId,
        batchId: piece.batchId,
        batchPatternId: piece.batchPatternId,
        pieceId: piece.id,
      }),
    };
  }
  return null;
}

/** Ссылка на карточку для сотрудника. Пока /kamen/<вид>; позже — /k/<код>. */
export function staffCardHref(hit: Pick<StoneCodeHit, "stoneTypeId">): string {
  return `/kamen/${hit.stoneTypeId}`;
}

// ───────────── §8.4 — сводка для Telegram ─────────────

const UNIT_STATUS_RU: Record<string, string> = {
  AVAILABLE: "в наличии",
  RESERVED: "забронирована",
  SOLD: "продана",
  BROKEN_OFFCUT: "разбита",
  RETURNED: "возврат",
  SAMPLE: "выдана как образец",
  SHOWROOM: "в шоу-руме",
};

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** «свободно 3 пл. / 13,4 м²» или «нет в наличии». Числа — из общих помощников. */
export function formatFreeQty(slabs: number | null, areaM2: number | null): string {
  const parts: string[] = [];
  if (slabs !== null && slabs > 0) parts.push(`${slabs} пл.`);
  if (areaM2 !== null && areaM2 > 0.001) parts.push(`${m2Fmt.format(areaM2)} м²`);
  return parts.length > 0 ? `свободно ${parts.join(" / ")}` : "нет в наличии";
}

export interface StoneCodeCard {
  code: string;
  kind: StoneCodeKind;
  kindLabel: string;
  stoneTypeId: string;
  /** «Травертин Классик» (+ «· узор …» / «· Плита №2»). */
  title: string;
  availability: string;
  location: string;
}

/**
 * Сводка по коду для бота: название, наличие, локация. Наличие считается теми
 * же помощниками, что «Поиск» и карточка (loadBatchAvailability /
 * loadPatternStock) — своей арифметики остатка здесь нет.
 */
export async function loadStoneCodeCard(
  database: PrismaClient,
  raw: string,
): Promise<StoneCodeCard | null> {
  const hit = await findByCode(database, raw);
  if (!hit) return null;
  const [{ loadBatchAvailability }, { formatLocationsShort, loadPatternStock }] =
    await Promise.all([import("./poisk-query"), import("./pattern-stock")]);
  const st = await database.stoneType.findUnique({
    where: { id: hit.stoneTypeId },
    select: { name: true },
  });
  const name = st?.name ?? "Камень";
  const base = {
    code: hit.code,
    kind: hit.kind,
    kindLabel: STONE_CODE_KIND_RU[hit.kind],
    stoneTypeId: hit.stoneTypeId,
  };

  if (hit.kind === "SLAB" && hit.ids.slabId) {
    const s = await database.slab.findUnique({
      where: { id: hit.ids.slabId },
      select: { label: true, status: true, block: true, landmark: true },
    });
    return {
      ...base,
      title: s ? `${name} · ${s.label}` : name,
      availability: s ? (UNIT_STATUS_RU[s.status] ?? s.status) : "—",
      location: s ? formatLocation(s.block, s.landmark) : "—",
    };
  }
  if (hit.kind === "PIECE" && hit.ids.pieceId) {
    const p = await database.piece.findUnique({
      where: { id: hit.ids.pieceId },
      select: { kind: true, status: true, block: true, landmark: true },
    });
    const what = p?.kind === "BROKEN" ? "бой" : "остаток";
    return {
      ...base,
      title: `${name} · ${what}`,
      availability: p ? (UNIT_STATUS_RU[p.status] ?? p.status) : "—",
      location: p ? formatLocation(p.block, p.landmark) : "—",
    };
  }
  if (hit.kind === "PATTERN" && hit.ids.batchId && hit.ids.batchPatternId) {
    const stock = (await loadPatternStock(database, [hit.ids.batchId])).get(
      hit.ids.batchPatternId,
    );
    return {
      ...base,
      title: stock ? `${name} · узор «${stock.description}»` : name,
      availability: stock
        ? formatFreeQty(stock.availableSlabs, stock.availableAreaM2)
        : "—",
      location: stock ? formatLocationsShort(stock.locations) : "—",
    };
  }

  // Партия или вид целиком: остаток партий по формуле §3 минус брони.
  const batches = await database.batch.findMany({
    where:
      hit.kind === "BATCH" && hit.ids.batchId
        ? { id: hit.ids.batchId }
        : { stoneTypeId: hit.stoneTypeId },
    select: {
      id: true,
      slabsTotal: true,
      areaTotalM2: true,
      slabsAdjusted: true,
      areaAdjustedM2: true,
      slabsSoldDirect: true,
      areaSoldDirectM2: true,
      locations: { select: { block: true, landmark: true, slabsHere: true } },
    },
    take: 200,
  });
  const avail = await loadBatchAvailability(database, batches);
  let slabs: number | null = null;
  let area: number | null = null;
  for (const a of avail.values()) {
    if (a.slabs !== null) slabs = (slabs ?? 0) + a.slabs;
    if (a.areaM2 !== null) area = (area ?? 0) + a.areaM2;
  }
  const locs = batches.flatMap((b) => b.locations);
  return {
    ...base,
    title: hit.kind === "BATCH" ? `${name} · партия` : name,
    availability: formatFreeQty(slabs, area),
    location: formatLocationsShort(locs),
  };
}
