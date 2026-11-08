// ТЗ №20 K (§12.2–12.4) — ИИ-поиск: фраза или фото → фильтры каталога.
//
// ИИ не заменяет поиск, а переводит запрос в фильтры существующего поиска
// (порода, цвет, размер, толщина — те же, что в «Поиске»/каталоге; тон,
// рисунок, прожилки — ранжирование по признакам узоров). Результат — обычная
// страница /katalog с чипами-фильтрами.
//
//   • публичный каталог: 20 ИИ-запросов в час с одного IP (сотрудникам — без
//     лимита), фото до 10 МБ;
//   • ИИ не ответил за 10 с / недоступен / лимит — обычный поиск по тексту
//     запроса, без ошибки клиенту;
//   • каждый запрос — строка в AiSearchLog (без фото): «Сводка» → топ запросов.

import type { AiSearchChannel, Prisma, PrismaClient } from "@prisma/client";
import { aiAnalyzeStonePhoto, aiParseQuery, type VisionDeps } from "./ai-vision";
import { catalogVocabulary, prepareForVision } from "./traits-store";
import { loadCatalog, parseCatalogFilters, type CatalogItem, type CatalogViewer } from "./catalog";
import {
  aiFiltersToParams,
  EMPTY_AI_FILTERS,
  parseSizeText,
  parseThicknessText,
  parseWantedTraits,
  plainTextFilters,
  type AiSearchFilters,
} from "./stone-traits";
import { decideThrottle, nextFailureState } from "./login-throttle";

export const AI_IP_SCOPE = "ai_ip";
export const AI_IP_LIMIT = 20;
export const AI_IP_WINDOW_MS = 60 * 60 * 1000;
export const AI_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const AI_QUERY_MAX = 300;

type SearchDb = Pick<PrismaClient, "stoneType" | "loginAttempt" | "aiSearchLog"> & PrismaClient;

/** Лимит публичного каталога: true — можно звать ИИ (и счётчик увеличен). */
export async function takeAiQuota(
  db: Pick<PrismaClient, "loginAttempt">,
  ip: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!ip) return true;
  const row = await db.loginAttempt.findUnique({
    where: { scope_key: { scope: AI_IP_SCOPE, key: ip } },
    select: { failures: true, firstAt: true },
  });
  const d = decideThrottle({ row, now, limit: AI_IP_LIMIT, windowMs: AI_IP_WINDOW_MS });
  if (d.blocked) return false;
  const next = nextFailureState({ row, now, windowMs: AI_IP_WINDOW_MS });
  await db.loginAttempt.upsert({
    where: { scope_key: { scope: AI_IP_SCOPE, key: ip } },
    create: { scope: AI_IP_SCOPE, key: ip, failures: next.failures, firstAt: next.firstAt, lastAt: now },
    update: { failures: next.failures, firstAt: next.firstAt, lastAt: now },
  });
  return true;
}

export interface AiSearchResult {
  /** Параметры /katalog (фильтры + ai=<запрос>). */
  params: URLSearchParams;
  filters: AiSearchFilters;
  aiOk: boolean;
  items: CatalogItem[];
}

/** Ничего не понято (все фильтры пустые)? */
function emptyFilters(f: AiSearchFilters): boolean {
  return Object.values(f).every((v) => v === null || v === undefined);
}

/** Фильтры → результат каталога для этого зрителя (для журнала и бота). */
async function runCatalog(db: PrismaClient, params: URLSearchParams, viewer: CatalogViewer) {
  const sp = Object.fromEntries(params.entries());
  const res = await loadCatalog(db, {
    viewer,
    filters: parseCatalogFilters(sp),
    wanted: parseWantedTraits(sp),
  });
  return res.items;
}

async function logSafe(
  db: Pick<PrismaClient, "aiSearchLog">,
  row: {
    channel: AiSearchChannel;
    kind: "TEXT" | "PHOTO";
    query: string | null;
    filters: AiSearchFilters;
    aiOk: boolean;
    items: CatalogItem[];
  },
) {
  try {
    await db.aiSearchLog.create({
      data: {
        channel: row.channel,
        kind: row.kind,
        query: row.query ? row.query.slice(0, AI_QUERY_MAX) : null,
        filters: row.filters as unknown as Prisma.InputJsonValue,
        aiOk: row.aiOk,
        resultCount: row.items.length,
        inStockCount: row.items.filter((i) => i.availability === "IN_STOCK").length,
      },
    });
  } catch (err) {
    console.warn("[ai-search] журнал не записан:", (err as Error).message);
  }
}

/**
 * Поиск по фразе. Не бросает: при любой беде — обычный поиск по тексту
 * (фильтр «Название/порода/цвет» + размер/толщина, если их видно в тексте).
 */
export async function aiTextSearch(
  db: SearchDb,
  args: { text: string; viewer: CatalogViewer; channel: AiSearchChannel; ip?: string; deps?: VisionDeps },
): Promise<AiSearchResult> {
  const text = args.text.trim().slice(0, AI_QUERY_MAX);
  let filters: AiSearchFilters | null = null;
  if (text) {
    const allowed = args.channel !== "CATALOG" || (await takeAiQuota(db, args.ip ?? ""));
    if (allowed) {
      const vocab = await catalogVocabulary(db);
      filters = await aiParseQuery(text, vocab, args.deps);
    }
  }
  const aiOk = filters !== null && !emptyFilters(filters);
  let params: URLSearchParams;
  if (aiOk) {
    params = aiFiltersToParams(filters!, text);
  } else {
    // Обычный поиск по тексту запроса: размер/толщину, породу и цвет из
    // словаря склада понимаем и без ИИ.
    const size = parseSizeText(text);
    const thick = parseThicknessText(text);
    const plain = plainTextFilters(text, await catalogVocabulary(db));
    filters = {
      ...EMPTY_AI_FILTERS,
      rock: plain.rock,
      color: plain.color,
      tone: plain.tone,
      lengthCm: size?.lengthCm ?? null,
      widthCm: size?.widthCm ?? null,
      thicknessCm: thick,
    };
    params = aiFiltersToParams(filters, text);
    if (plain.q) params.set("q", plain.q.slice(0, 80));
    // Каталог покажет «ИИ не ответил — обычный поиск».
    if (text) params.set("aiFail", "1");
  }
  const used: AiSearchFilters = filters ?? EMPTY_AI_FILTERS;
  const items = await runCatalog(db, params, args.viewer);
  await logSafe(db, { channel: args.channel, kind: "TEXT", query: text, filters: used, aiOk, items });
  return { params, filters: used, aiOk, items };
}

/**
 * Поиск по фото: признаки самой заметной каменной поверхности → обычный
 * поиск, ранжирование «совпадение признаков → наличие». Порода — только если
 * ИИ уверен. ИИ недоступен — весь каталог по наличию (aiOk = false).
 */
export async function aiPhotoSearch(
  db: SearchDb,
  args: {
    bytes: Buffer;
    viewer: CatalogViewer;
    channel: AiSearchChannel;
    ip?: string;
    deps?: VisionDeps;
  },
): Promise<AiSearchResult> {
  let filters: AiSearchFilters = { ...EMPTY_AI_FILTERS };
  let aiOk = false;
  const allowed = args.channel !== "CATALOG" || (await takeAiQuota(db, args.ip ?? ""));
  if (allowed && args.bytes.length > 0 && args.bytes.length <= AI_PHOTO_MAX_BYTES) {
    const img = await prepareForVision(args.bytes);
    if (img) {
      const vocab = await catalogVocabulary(db);
      const traits = await aiAnalyzeStonePhoto(img, vocab, { forSearch: true }, args.deps);
      if (traits) {
        aiOk = true;
        filters = {
          ...EMPTY_AI_FILTERS,
          rock: traits.rock,
          traitColor: traits.color,
          tone: traits.tone,
          pattern: traits.pattern,
          veinColor: traits.veinColor,
        };
      }
    }
  }
  const params = aiFiltersToParams(filters, null);
  params.set("aiPhoto", aiOk ? "1" : "0");
  const items = await runCatalog(db, params, args.viewer);
  await logSafe(db, { channel: args.channel, kind: "PHOTO", query: null, filters, aiOk, items });
  return { params, filters, aiOk, items };
}

// ───────────────────────── «Сводка» → топ запросов ─────────────────────────

export interface TopAiQueryRow {
  query: string;
  count: number;
  /** Последний раз ничего в наличии не нашлось — «чего нет на складе». */
  lastInStock: number;
  lastAt: Date;
}

/** Топ текстовых запросов за период (одинаковые без учёта регистра). */
export async function loadTopAiQueries(
  db: Pick<PrismaClient, "aiSearchLog">,
  range: { from: Date | null; to: Date | null },
  limit = 15,
): Promise<{ rows: TopAiQueryRow[]; photoCount: number; total: number }> {
  const createdAt: Prisma.DateTimeFilter = {};
  if (range.from) createdAt.gte = range.from;
  if (range.to) createdAt.lt = range.to;
  const where: Prisma.AiSearchLogWhereInput = range.from || range.to ? { createdAt } : {};
  const rows = await db.aiSearchLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { kind: true, query: true, inStockCount: true, createdAt: true },
  });
  const map = new Map<string, TopAiQueryRow>();
  let photoCount = 0;
  for (const r of rows) {
    if (r.kind === "PHOTO") {
      photoCount++;
      continue;
    }
    const key = (r.query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { query: r.query!.trim(), count: 1, lastInStock: r.inStockCount, lastAt: r.createdAt });
  }
  const top = [...map.values()]
    .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, limit);
  return { rows: top, photoCount, total: rows.length };
}

// ───────────────────────── Telegram /naiti ─────────────────────────

const m2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Топ-5 для бота: название, наличие (сотруднику — плиты и м²), ссылка. */
export function formatBotTop(
  res: Pick<AiSearchResult, "items" | "aiOk" | "params">,
  baseUrl: string,
  kind: "text" | "photo",
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const top = res.items.slice(0, 5);
  const head =
    kind === "photo"
      ? res.aiOk
        ? "Похожие по фото:"
        : "Фото разобрать не удалось — камни в наличии:"
      : res.aiOk
        ? "Нашёл по запросу:"
        : "ИИ не ответил — обычный поиск по тексту:";
  if (top.length === 0) return `${head}\nНичего не нашлось. Каталог: ${base}/katalog`;
  const lines = top.map((it, i) => {
    const stock =
      it.availability === "IN_STOCK"
        ? "viewer" in it && it.viewer !== "client" && "freeSlabs" in it
          ? `в наличии ${it.freeSlabs} пл. · ${m2.format(it.freeAreaM2)} м²`
          : "в наличии"
        : it.availability === "IN_SHOWROOM"
          ? "в шоу-руме"
          : "нет в наличии";
    return `${i + 1}. ${it.name} — ${stock}\n${base}/k/${it.code}`;
  });
  return [head, ...lines, `Все результаты: ${base}/katalog?${res.params.toString()}`].join("\n");
}

/** Ответ бота на /naiti (текст или file_id фото). Никогда не бросает. */
export async function botAiSearchReply(
  db: SearchDb,
  input: { text: string } | { photoFileId: string },
  baseUrl: string,
  io: { downloadPhoto: (fileId: string) => Promise<Buffer | null> },
): Promise<string> {
  try {
    if ("text" in input) {
      const res = await aiTextSearch(db, { text: input.text, viewer: "staff", channel: "BOT" });
      return formatBotTop(res, baseUrl, "text");
    }
    const bytes = await io.downloadPhoto(input.photoFileId);
    const res = await aiPhotoSearch(db, { bytes: bytes ?? Buffer.alloc(0), viewer: "staff", channel: "BOT" });
    return formatBotTop(res, baseUrl, "photo");
  } catch (err) {
    console.warn("[ai-search] bot:", (err as Error).message);
    return `Поиск сейчас недоступен. Каталог: ${baseUrl.replace(/\/+$/, "")}/katalog`;
  }
}
