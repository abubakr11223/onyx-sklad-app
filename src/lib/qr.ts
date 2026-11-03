// ТЗ №20 G (§8.2, §8.3) — ссылка, QR и этикетка.
//
// • QR кодирует https://<домен>/k/ONX-XXXXX. Домен берём из PUBLIC_BASE_URL
//   (после переезда на домен Onyx меняется одна переменная; старый домен
//   отдаёт 301 — напечатанные этикетки не перепечатываются, §8.2).
// • QR рисуется здесь же библиотекой `qrcode` в SVG на сервере — никаких
//   внешних сервисов (§8.3).
// • Данные этикетки (название, порода/цвет, размер, толщина, код) собираются
//   одним batch-запросом на набор кодов — пакетная печать без N+1.

import QRCode from "qrcode";
import type { PrismaClient } from "@prisma/client";
import { formatDim, formatThickness, thicknessToNumber } from "./dimensions";
import { normalizeStoneCode, type StoneCodeKind } from "./stone-code";

/** Текущий домен приложения (§8.2). Можно переопределить env PUBLIC_BASE_URL. */
export const DEFAULT_PUBLIC_BASE_URL = "https://onyx-sklad-app.vercel.app";

/** База ссылки на этикетке, без хвостового «/». */
export function publicBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = (env.PUBLIC_BASE_URL ?? "").trim();
  const base = /^https?:\/\/[^\s]+$/i.test(raw) ? raw : DEFAULT_PUBLIC_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** https://<домен>/k/ONX-XXXXX */
export function stoneCodeUrl(code: string, base: string = publicBaseUrl()): string {
  return `${base.replace(/\/+$/, "")}/k/${encodeURIComponent(code)}`;
}

/**
 * QR как inline-SVG (viewBox, без width/height — размер задаёт CSS).
 * Уровень коррекции M: этикетка на складе пачкается, но код остаётся мелким.
 * margin 2 модуля — тихая зона, без неё телефоны читают хуже.
 */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

// ───────────── параметры печати ─────────────

export type QrPrintFormat = "label" | "a4";

/** Сколько этикеток за один раз (≈ 10 листов A4). Больше — делите на части. */
export const QR_PRINT_MAX = 120;
/** Этикеток на листе A4 (3 × 4). */
export const QR_A4_PER_SHEET = 12;

export interface QrPrintParams {
  codes: string[];
  format: QrPrintFormat;
  /** Сколько значений не похожи на код (показываем, а не молчим). */
  invalid: number;
  /** Сколько отброшено сверх QR_PRINT_MAX. */
  truncated: number;
}

type SearchParamsLike = Record<string, string | string[] | undefined>;

/**
 * Разбор `?codes=ONX-..,ONX-..&code=ONX-..&format=label|a4`.
 * `codes` — через запятую (ссылки-кнопки), `code` — повторяющийся параметр
 * (форма с галочками в «Поиске»). Порядок сохраняется, дубли убираются.
 */
export function parseQrPrintParams(sp: SearchParamsLike): QrPrintParams {
  const list = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const raw = [
    ...list(sp.codes).flatMap((s) => s.split(/[,\s]+/)),
    ...list(sp.code),
  ].filter((s) => s.trim() !== "");

  const seen = new Set<string>();
  const codes: string[] = [];
  let invalid = 0;
  for (const r of raw) {
    const c = normalizeStoneCode(r);
    if (!c) {
      invalid += 1;
      continue;
    }
    if (seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
  }
  const fmtRaw = list(sp.format)[0];
  const format: QrPrintFormat = fmtRaw === "a4" ? "a4" : "label";
  return {
    codes: codes.slice(0, QR_PRINT_MAX),
    format,
    invalid,
    truncated: Math.max(0, codes.length - QR_PRINT_MAX),
  };
}

/** Ссылка на страницу печати — для кнопок «QR». */
export function qrPrintHref(
  codes: readonly string[],
  format: QrPrintFormat = "label",
): string {
  const q = new URLSearchParams({ codes: codes.join(","), format });
  return `/qr/print?${q.toString()}`;
}

// ───────────── данные этикетки ─────────────

export interface QrLabelInput {
  code: string;
  kind: StoneCodeKind;
  name: string;
  rockType: string;
  color: string | null;
  /** Уточнение: узор / «Плита №2» / «бой». */
  detail: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
}

export interface QrLabel {
  code: string;
  kind: StoneCodeKind;
  name: string;
  /** «Оникс · белый» */
  rockColor: string;
  detail: string | null;
  /** «275 × 185 см» или null */
  size: string | null;
  /** «2 см» / «1,8 см» или null */
  thickness: string | null;
}

/** Строки этикетки из сырых полей. Пустое не печатаем (никаких «—» на бумаге). */
export function formatQrLabel(input: QrLabelInput): QrLabel {
  const rock = input.rockType.trim();
  const color = (input.color ?? "").trim();
  const size =
    input.lengthCm != null && input.widthCm != null
      ? `${formatDim(input.lengthCm)} × ${formatDim(input.widthCm)} см`
      : null;
  const thickness =
    input.thicknessCm != null ? `${formatThickness(input.thicknessCm)} см` : null;
  const detail = (input.detail ?? "").trim();
  return {
    code: input.code,
    kind: input.kind,
    name: input.name,
    rockColor: [rock, color].filter(Boolean).join(" · "),
    detail: detail || null,
    size,
    thickness,
  };
}

type Dec = { toString(): string } | number | null | undefined;
const th = (...vals: Dec[]): number | null => {
  for (const v of vals) {
    const n = thicknessToNumber(v ?? null);
    if (n !== null) return n;
  }
  return null;
};
const first = (...vals: (number | null | undefined)[]): number | null => {
  for (const v of vals) if (v != null) return v;
  return null;
};

export type QrLabelDb = Pick<
  PrismaClient,
  "stoneType" | "batch" | "batchPattern" | "slab" | "piece"
>;

/**
 * Этикетки для набора кодов: 5 запросов `code IN (…)` на весь набор.
 * Размер берётся от самого точного уровня: плита → узор → партия.
 * Возвращает в порядке `codes`; ненайденные коды пропускаются.
 */
export async function loadQrLabels(
  database: QrLabelDb,
  codes: readonly string[],
): Promise<QrLabel[]> {
  if (codes.length === 0) return [];
  const where = { code: { in: [...codes] } };
  const stSel = { name: true, rockType: true, color: true } as const;
  const dims = { lengthMm: true, widthMm: true, thicknessMm: true } as const;
  const [types, batches, patterns, slabs, pieces] = await Promise.all([
    database.stoneType.findMany({ where, select: { code: true, ...stSel } }),
    database.batch.findMany({
      where,
      select: { code: true, ...dims, stoneType: { select: stSel } },
    }),
    database.batchPattern.findMany({
      where,
      select: {
        code: true,
        description: true,
        ...dims,
        batch: { select: { ...dims, stoneType: { select: stSel } } },
      },
    }),
    database.slab.findMany({
      where,
      select: {
        code: true,
        label: true,
        ...dims,
        stoneType: { select: stSel },
        batchPattern: { select: { description: true, ...dims } },
        batch: { select: dims },
      },
    }),
    database.piece.findMany({
      where,
      select: {
        code: true,
        kind: true,
        boundingLengthMm: true,
        boundingWidthMm: true,
        thicknessMm: true,
        stoneType: { select: stSel },
        batchPattern: { select: { thicknessMm: true } },
        batch: { select: { thicknessMm: true } },
      },
    }),
  ]);

  const byCode = new Map<string, QrLabelInput>();
  for (const t of types) {
    byCode.set(t.code, {
      kind: "STONE_TYPE",
      ...t,
      detail: null,
      lengthCm: null,
      widthCm: null,
      thicknessCm: null,
    });
  }
  for (const b of batches) {
    byCode.set(b.code, {
      code: b.code,
      kind: "BATCH",
      ...b.stoneType,
      detail: null,
      lengthCm: b.lengthMm,
      widthCm: b.widthMm,
      thicknessCm: th(b.thicknessMm),
    });
  }
  for (const p of patterns) {
    byCode.set(p.code, {
      code: p.code,
      kind: "PATTERN",
      ...p.batch.stoneType,
      detail: p.description,
      lengthCm: first(p.lengthMm, p.batch.lengthMm),
      widthCm: first(p.widthMm, p.batch.widthMm),
      thicknessCm: th(p.thicknessMm, p.batch.thicknessMm),
    });
  }
  for (const s of slabs) {
    byCode.set(s.code, {
      code: s.code,
      kind: "SLAB",
      ...s.stoneType,
      detail: s.batchPattern ? `${s.label} · ${s.batchPattern.description}` : s.label,
      lengthCm: first(s.lengthMm, s.batchPattern?.lengthMm, s.batch.lengthMm),
      widthCm: first(s.widthMm, s.batchPattern?.widthMm, s.batch.widthMm),
      thicknessCm: th(s.thicknessMm, s.batchPattern?.thicknessMm, s.batch.thicknessMm),
    });
  }
  for (const p of pieces) {
    byCode.set(p.code, {
      code: p.code,
      kind: "PIECE",
      ...p.stoneType,
      detail: p.kind === "BROKEN" ? "Бой" : "Остаток",
      lengthCm: p.boundingLengthMm,
      widthCm: p.boundingWidthMm,
      thicknessCm: th(p.thicknessMm, p.batchPattern?.thicknessMm, p.batch?.thicknessMm),
    });
  }
  const out: QrLabel[] = [];
  for (const c of codes) {
    const input = byCode.get(c);
    if (input) out.push(formatQrLabel(input));
  }
  return out;
}
