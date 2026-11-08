// ТЗ №20 K (§12) — ИИ-поиск камня: Claude (vision) переводит фразу или
// картинку в фильтры обычного поиска и выставляет признаки фото узора.
//
// Модель и провайдер — те же, что у ИИ-чертежа «Разбить» (ai-shape.ts, ТЗ
// №13): Anthropic, AI_VISION_MODEL. Ключ только на сервере. Fail-closed: нет
// ключа / ошибка / не уложились в 10 с → null (вызывающий показывает обычный
// поиск по тексту, клиенту ошибку не показываем). Ничего не бросает.
//
// Ответ — structured output (json_schema): цвет/тон/рисунок — enum из
// stone-traits.ts, порода и цвет каталога — enum из значений, что реально есть
// в базе. Так фильтр гарантированно совпадает с каталогом, без «почти тех»
// слов.

import Anthropic from "@anthropic-ai/sdk";
import {
  STONE_PATTERNS,
  STONE_TONES,
  TRAIT_COLORS,
  isPattern,
  isTone,
  isTraitColor,
  parseSizeText,
  parseThicknessText,
  type AiSearchFilters,
  type StoneTraitsValue,
} from "./stone-traits";

/** Та же vision-модель, что у ИИ-чертежа (ТЗ №20 §12.4). */
export const AI_VISION_MODEL = process.env.AI_VISION_MODEL || "claude-opus-4-8";
/** Ответ ИИ ждём до 10 секунд (§12.4). */
export const AI_TIMEOUT_MS = 10_000;

/** Минимальная форма клиента — тесты подсовывают mock. */
export interface VisionClient {
  messages: {
    parse(
      args: Record<string, unknown>,
      options?: { timeout?: number; maxRetries?: number },
    ): Promise<{ parsed_output: unknown }>;
  };
}

export interface VisionDeps {
  client?: VisionClient;
}

function clientOrNull(deps: VisionDeps): VisionClient | null {
  if (deps.client) return deps.client;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[ai-vision] ANTHROPIC_API_KEY не задан — ИИ-поиск выключен, обычный поиск.");
    return null;
  }
  return new Anthropic() as unknown as VisionClient;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const enumOf = (values: readonly string[]) => nullable({ type: "string", enum: [...values] });

/** Каталожные варианты (порода / цвет вида) — что реально есть на складе. */
export interface CatalogVocabulary {
  rocks: string[];
  colors: string[];
}

function filtersSchema(vocab: CatalogVocabulary) {
  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties: {
        rock: vocab.rocks.length > 0 ? enumOf(vocab.rocks) : { type: "null" },
        color: vocab.colors.length > 0 ? enumOf(vocab.colors) : { type: "null" },
        tone: enumOf(STONE_TONES),
        pattern: enumOf(STONE_PATTERNS),
        veinColor: enumOf(TRAIT_COLORS),
        lengthCm: nullable({ type: "number" }),
        widthCm: nullable({ type: "number" }),
        thicknessCm: nullable({ type: "number" }),
      },
      required: ["rock", "color", "tone", "pattern", "veinColor", "lengthCm", "widthCm", "thicknessCm"],
      additionalProperties: false,
    },
  };
}

function textPrompt(text: string, vocab: CatalogVocabulary): string {
  return [
    "You convert a natural-stone warehouse search phrase (Russian or Uzbek) into search filters.",
    "Return only what the phrase actually asks for; use null for everything not mentioned.",
    `rock: one of the warehouse rock types ${JSON.stringify(vocab.rocks)} if the phrase names it (synonyms and Uzbek words count), else null.`,
    `color: one of the warehouse color values ${JSON.stringify(vocab.colors)} that best matches the requested main color, else null.`,
    "tone: LIGHT / MEDIUM / DARK if the phrase says light/medium/dark (светлый/средний/тёмный, och/to'q).",
    "pattern: UNIFORM (однородный), CLOUDY (облачный), VEINS (прожилки), BOLD_VEINS (крупные прожилки), BRECCIA (брекчия).",
    "veinColor: the vein color if mentioned.",
    "lengthCm / widthCm: the needed piece size in centimetres; numbers up to 10 without units are metres (\"3 на 1,6\" = 300 x 160). lengthCm is the longer side.",
    "thicknessCm: thickness in centimetres if mentioned (18 мм = 1.8).",
    "Words like столешница/countertop, пол/floor only describe use; do not turn them into filters.",
    "",
    `Phrase: ${text}`,
  ].join("\n");
}

function cleanNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
}

/** Ответ модели → фильтры (с повторной проверкой: модель не источник правды). */
export function cleanAiFilters(raw: unknown, vocab: CatalogVocabulary): AiSearchFilters | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pick = (v: unknown, list: string[]) =>
    typeof v === "string" ? (list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? null) : null;
  let L = cleanNumber(r.lengthCm, 10, 2000);
  let W = cleanNumber(r.widthCm, 10, 2000);
  if (L === null || W === null) {
    L = null;
    W = null;
  } else if (W > L) {
    [L, W] = [W, L];
  }
  return {
    rock: pick(r.rock, vocab.rocks),
    color: pick(r.color, vocab.colors),
    tone: isTone(r.tone) ? r.tone : null,
    pattern: isPattern(r.pattern) ? r.pattern : null,
    veinColor: isTraitColor(r.veinColor) ? r.veinColor : null,
    lengthCm: L,
    widthCm: W,
    thicknessCm: cleanNumber(r.thicknessCm, 0.8, 10),
  };
}

/**
 * Фраза → фильтры. null — ИИ недоступен/не уложился (вызывающий делает
 * обычный поиск по тексту). Размер и толщину, если модель их пропустила,
 * добираем простым разбором текста.
 */
export async function aiParseQuery(
  text: string,
  vocab: CatalogVocabulary,
  deps: VisionDeps = {},
): Promise<AiSearchFilters | null> {
  const client = clientOrNull(deps);
  if (!client) return null;
  try {
    const res = await client.messages.parse(
      {
        model: AI_VISION_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: [{ type: "text", text: textPrompt(text, vocab) }] }],
        output_config: { format: filtersSchema(vocab) },
      },
      { timeout: AI_TIMEOUT_MS, maxRetries: 0 },
    );
    const f = cleanAiFilters(res.parsed_output, vocab);
    if (!f) return null;
    if (f.lengthCm === null) {
      const size = parseSizeText(text);
      if (size) {
        f.lengthCm = size.lengthCm;
        f.widthCm = size.widthCm;
      }
    }
    if (f.thicknessCm === null) f.thicknessCm = parseThicknessText(text);
    return f;
  } catch (err) {
    console.warn("[ai-vision] разбор фразы не удался:", (err as Error).message);
    return null;
  }
}

// ───────────────────────── Фото ─────────────────────────

export interface PhotoTraits extends StoneTraitsValue {
  /** Порода — только если ИИ уверен (иначе null). */
  rock: string | null;
}

function photoSchema(vocab: CatalogVocabulary) {
  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties: {
        isStone: { type: "boolean" },
        color: enumOf(TRAIT_COLORS),
        tone: enumOf(STONE_TONES),
        pattern: enumOf(STONE_PATTERNS),
        veinColor: enumOf(TRAIT_COLORS),
        rock: vocab.rocks.length > 0 ? enumOf(vocab.rocks) : { type: "null" },
        rockConfident: { type: "boolean" },
      },
      required: ["isStone", "color", "tone", "pattern", "veinColor", "rock", "rockConfident"],
      additionalProperties: false,
    },
  };
}

function photoPrompt(vocab: CatalogVocabulary, forSearch: boolean): string {
  return [
    forSearch
      ? "The image may be an interior photo, a Pinterest screenshot or a stone sample. Find the most prominent natural-stone surface (countertop, wall, floor, slab) and describe ONLY that surface."
      : "The image is a photo of a natural-stone slab or sample in a warehouse. Describe the stone surface.",
    "isStone: false if there is no natural stone surface in the image.",
    "color: the main (background) color of the stone from the allowed list.",
    "tone: LIGHT / MEDIUM / DARK overall lightness.",
    "pattern: UNIFORM (almost no pattern), CLOUDY (soft clouds), VEINS (thin veins), BOLD_VEINS (thick, high-contrast veins), BRECCIA (angular fragments).",
    "veinColor: color of veins, or null if there are none.",
    `rock: one of ${JSON.stringify(vocab.rocks)} only if you are confident (onyx, marble, travertine, granite look distinct); set rockConfident accordingly, else null and false.`,
  ].join("\n");
}

/** Ответ модели по фото → признаки (null — на фото нет камня). */
export function cleanPhotoTraits(raw: unknown, vocab: CatalogVocabulary): PhotoTraits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.isStone === false) return null;
  const rock =
    r.rockConfident === true && typeof r.rock === "string"
      ? (vocab.rocks.find((x) => x.toLowerCase() === String(r.rock).toLowerCase()) ?? null)
      : null;
  const out: PhotoTraits = {
    color: isTraitColor(r.color) ? r.color : null,
    tone: isTone(r.tone) ? r.tone : null,
    pattern: isPattern(r.pattern) ? r.pattern : null,
    veinColor: isTraitColor(r.veinColor) ? r.veinColor : null,
    rock,
  };
  return out.color || out.tone || out.pattern ? out : null;
}

/**
 * Признаки по фото. forSearch — фото клиента (интерьер/скриншот): берём самую
 * заметную каменную поверхность. null — ИИ недоступен или камня нет.
 */
export async function aiAnalyzeStonePhoto(
  image: { bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  vocab: CatalogVocabulary,
  opts: { forSearch: boolean; timeoutMs?: number },
  deps: VisionDeps = {},
): Promise<PhotoTraits | null> {
  const client = clientOrNull(deps);
  if (!client) return null;
  try {
    const res = await client.messages.parse(
      {
        model: AI_VISION_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: Buffer.from(image.bytes).toString("base64"),
                },
              },
              { type: "text", text: photoPrompt(vocab, opts.forSearch) },
            ],
          },
        ],
        output_config: { format: photoSchema(vocab) },
      },
      { timeout: opts.timeoutMs ?? AI_TIMEOUT_MS, maxRetries: 0 },
    );
    return cleanPhotoTraits(res.parsed_output, vocab);
  } catch (err) {
    console.warn("[ai-vision] разбор фото не удался:", (err as Error).message);
    return null;
  }
}
