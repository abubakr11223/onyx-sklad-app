// ТЗ №20 K (§12) — признаки камня и фильтры ИИ-поиска. Чистый модуль (без БД,
// без node:) — его используют сервер, бот и разметка.
//
//   • признаки узора/партии: основной цвет, тон, рисунок, цвет прожилок;
//   • фильтры поиска: порода, цвет, тон, рисунок, размер (см), толщина;
//   • размер из текста — и метры, и сантиметры («3 на 1,6», «300×160»);
//   • ранжирование: совпадение признаков → наличие → размер.

import type { StonePattern, StoneTone } from "@prisma/client";

export const STONE_TONES: readonly StoneTone[] = ["LIGHT", "MEDIUM", "DARK"] as const;
export const STONE_PATTERNS: readonly StonePattern[] = [
  "UNIFORM",
  "CLOUDY",
  "VEINS",
  "BOLD_VEINS",
  "BRECCIA",
] as const;

export const TONE_RU: Record<StoneTone, string> = {
  LIGHT: "светлый",
  MEDIUM: "средний",
  DARK: "тёмный",
};
export const TONE_UZ: Record<StoneTone, string> = {
  LIGHT: "och",
  MEDIUM: "o‘rta",
  DARK: "to‘q",
};
export const PATTERN_RU: Record<StonePattern, string> = {
  UNIFORM: "однородный",
  CLOUDY: "облачный",
  VEINS: "прожилки",
  BOLD_VEINS: "крупные прожилки",
  BRECCIA: "брекчия",
};
export const PATTERN_UZ: Record<StonePattern, string> = {
  UNIFORM: "bir xil",
  CLOUDY: "bulutsimon",
  VEINS: "tomirli",
  BOLD_VEINS: "yirik tomirli",
  BRECCIA: "brekchiya",
};

/**
 * Палитра основного цвета и цвета прожилок. ИИ выбирает ТОЛЬКО из неё
 * (enum в схеме ответа) — так признаки разных фото сравнимы между собой.
 */
export const TRAIT_COLORS = [
  "белый",
  "кремовый",
  "бежевый",
  "серый",
  "чёрный",
  "коричневый",
  "медовый",
  "жёлтый",
  "золотистый",
  "зелёный",
  "голубой",
  "синий",
  "розовый",
  "красный",
  "оранжевый",
  "фиолетовый",
  "многоцветный",
] as const;
export type TraitColor = (typeof TRAIT_COLORS)[number];

export function isTone(v: unknown): v is StoneTone {
  return typeof v === "string" && (STONE_TONES as readonly string[]).includes(v);
}
export function isPattern(v: unknown): v is StonePattern {
  return typeof v === "string" && (STONE_PATTERNS as readonly string[]).includes(v);
}
export function isTraitColor(v: unknown): v is TraitColor {
  return typeof v === "string" && (TRAIT_COLORS as readonly string[]).includes(v);
}

/** Сравнение цветов без «ё/е» и регистра. */
export function normColor(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

export interface StoneTraitsValue {
  color: string | null;
  tone: StoneTone | null;
  pattern: StonePattern | null;
  veinColor: string | null;
}

/** Признаки, которые просили (из фразы или с фото). */
export interface WantedTraits {
  color?: string | null;
  tone?: StoneTone | null;
  pattern?: StonePattern | null;
  veinColor?: string | null;
}

/**
 * Насколько признаки камня совпадают с искомыми: +3 цвет, +2 тон, +2 рисунок,
 * +1 прожилки. «Прожилки» и «крупные прожилки» — соседи (+1). 0 — ничего.
 */
export function traitScore(t: StoneTraitsValue, w: WantedTraits): number {
  let s = 0;
  if (w.color && t.color && normColor(w.color) === normColor(t.color)) s += 3;
  if (w.tone && t.tone) {
    if (w.tone === t.tone) s += 2;
    else if (w.tone === "MEDIUM" || t.tone === "MEDIUM") s += 0.5;
  }
  if (w.pattern && t.pattern) {
    if (w.pattern === t.pattern) s += 2;
    else if (
      (w.pattern === "VEINS" && t.pattern === "BOLD_VEINS") ||
      (w.pattern === "BOLD_VEINS" && t.pattern === "VEINS")
    ) {
      s += 1;
    }
  }
  if (w.veinColor && t.veinColor && normColor(w.veinColor) === normColor(t.veinColor)) s += 1;
  return s;
}

export function hasWantedTraits(w: WantedTraits): boolean {
  return Boolean(w.color || w.tone || w.pattern || w.veinColor);
}

// ───────────────────────── Размер из текста ─────────────────────────

/**
 * «3 на 1,6» / «3х1.6 м» / «300×160» / «300 на 160 см» → [300, 160] в см.
 * Числа до 10 без «см» считаются метрами (плиты не бывают 3 × 1,6 см).
 * Нет размера — null.
 */
export function parseSizeText(text: string): { lengthCm: number; widthCm: number } | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(м|см|m|cm)?\s*(?:на|x|х|×|\*|\/|by)\s*(\d+(?:[.,]\d+)?)\s*(м|см|m|cm)?/i.exec(
    text,
  );
  if (!m) return null;
  const unitAfter = (m[4] ?? m[2] ?? "").toLowerCase();
  const toCm = (raw: string): number | null => {
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unitAfter === "см" || unitAfter === "cm") return n;
    if (unitAfter === "м" || unitAfter === "m") return n * 100;
    return n <= 10 ? n * 100 : n;
  };
  const a = toCm(m[1]);
  const b = toCm(m[3]);
  if (a === null || b === null) return null;
  const L = Math.round(Math.max(a, b));
  const W = Math.round(Math.min(a, b));
  if (L < 10 || L > 2000 || W < 10) return null;
  return { lengthCm: L, widthCm: W };
}

/** «толщина 2 см» / «2см» / «18 мм» → см. */
export function parseThicknessText(text: string): number | null {
  // `\b` не работает после кириллицы — граница слова явно.
  const m = /(?:толщин[а-яё]*\s*)?(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm)(?![a-zа-яё])/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cm = /мм|mm/i.test(m[2]) ? n / 10 : n;
  // Толщина плиты — 1–10 см; «300 см» — это размер, не толщина.
  return cm >= 0.8 && cm <= 10 ? Math.round(cm * 10) / 10 : null;
}

// ───────────────────────── Фильтры поиска ─────────────────────────

/** Что ИИ понял из фразы/фото — то, что уходит в каталог и в журнал. */
export interface AiSearchFilters {
  rock: string | null;
  /** Цвет вида из каталога — жёсткий фильтр (как поле «Цвет»). */
  color: string | null;
  /** Цвет камня по признакам (палитра) — ранжирование (поиск по фото). */
  traitColor?: string | null;
  tone: StoneTone | null;
  pattern: StonePattern | null;
  veinColor: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
}

export const EMPTY_AI_FILTERS: AiSearchFilters = {
  rock: null,
  color: null,
  tone: null,
  pattern: null,
  veinColor: null,
  lengthCm: null,
  widthCm: null,
  thicknessCm: null,
};

/**
 * Фильтры → параметры /katalog. Порода и цвет — точные значения каталога
 * (жёсткий фильтр), тон/рисунок/прожилки — ранжирование, размер и толщина —
 * те же фильтры, что «Поиск».
 */
export function aiFiltersToParams(f: AiSearchFilters, query: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (f.rock) p.set("rock", f.rock);
  if (f.color) p.set("color", f.color);
  if (f.traitColor) p.set("tcolor", f.traitColor);
  if (f.tone) p.set("tone", f.tone);
  if (f.pattern) p.set("pat", f.pattern);
  if (f.veinColor) p.set("vein", f.veinColor);
  if (f.lengthCm && f.widthCm) {
    p.set("l", String(f.lengthCm));
    p.set("w", String(f.widthCm));
  }
  if (f.thicknessCm) p.set("t", String(f.thicknessCm));
  if (query) p.set("ai", query.slice(0, 200));
  return p;
}

/** Мягкие признаки из параметров /katalog (для ранжирования и чипов). */
export function parseWantedTraits(sp: Record<string, string | string[] | undefined>): WantedTraits {
  const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  const tone = one(sp.tone);
  const pat = one(sp.pat);
  const vein = one(sp.vein);
  // Цвет для ранжирования: явный признак с фото (tcolor) или цвет каталога,
  // если это слово из палитры признаков («бежевый» и т.п.).
  const tcolor = one(sp.tcolor);
  const catColor = TRAIT_COLORS.find((c) => normColor(c) === normColor(one(sp.color))) ?? null;
  return {
    color: isTraitColor(tcolor) ? tcolor : catColor,
    tone: isTone(tone) ? tone : null,
    pattern: isPattern(pat) ? pat : null,
    veinColor: isTraitColor(vein) ? vein : null,
  };
}

// ───────────────────────── Обычный поиск (ИИ не ответил) ─────────────────────────

const STOP_WORDS = new Set([
  "на", "для", "под", "и", "с", "со", "в", "во", "из", "по", "или", "мне", "нужен", "нужна",
  "нужно", "камень", "камня", "плита", "плиты", "столешница", "столешницу", "пол", "стена",
  "стену", "кухня", "кухню", "ванная", "ванную", "метра", "метров", "м", "см", "мм", "uchun",
  "kerak", "tosh",
]);

/** Основа слова для сравнения: без регистра и ё, первые 5 букв. */
function stem(w: string): string {
  return normColor(w).replace(/[^a-zа-я0-9]/g, "").slice(0, 5);
}

/**
 * Фраза без ИИ → лучшее, что можно понять простым сравнением: порода и цвет
 * из словаря склада по основе слова («травертина» → «Травертин»,
 * «бежевую» → «бежевый»), тон по словам светлый/тёмный. Что не узнали — одно
 * самое длинное слово в текстовый фильтр (целиком фраза ничего не найдёт).
 */
export function plainTextFilters(
  text: string,
  vocab: { rocks: string[]; colors: string[] },
): { rock: string | null; color: string | null; tone: StoneTone | null; q: string | null } {
  const words = text
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .split(/[^a-zа-яёʼ‘’']+/i)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const used = new Set<string>();
  const find = (list: string[]) => {
    for (const v of list) {
      const sv = stem(v);
      if (sv.length < 4) continue;
      const hit = words.find((w) => stem(w).length >= 4 && (stem(w) === sv || sv.startsWith(stem(w)) || stem(w).startsWith(sv)));
      if (hit) {
        used.add(hit);
        return v;
      }
    }
    return null;
  };
  const rock = find(vocab.rocks);
  const color = find(vocab.colors);
  let tone: StoneTone | null = null;
  for (const w of words) {
    const n = normColor(w);
    if (/^светл|^och/.test(n)) tone = "LIGHT";
    else if (/^темн|^to.?q/.test(n)) tone = "DARK";
    else continue;
    used.add(w);
  }
  const rest = words.filter((w) => !used.has(w));
  const q = rock || color || tone ? null : (rest.sort((a, b) => b.length - a.length)[0] ?? null);
  return { rock, color, tone, q };
}
