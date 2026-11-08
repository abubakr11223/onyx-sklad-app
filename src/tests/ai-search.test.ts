// ТЗ №20 K — ИИ-поиск: разбор фразы/фото (mock-клиент), признаки, фильтры,
// ранжирование, лимит, бот. Реальный ИИ не вызывается.
import { describe, expect, it, vi } from "vitest";
import {
  aiFiltersToParams,
  EMPTY_AI_FILTERS,
  parseSizeText,
  parseThicknessText,
  parseWantedTraits,
  traitScore,
} from "@/lib/stone-traits";
import {
  AI_TIMEOUT_MS,
  AI_VISION_MODEL,
  aiAnalyzeStonePhoto,
  aiParseQuery,
  cleanAiFilters,
  cleanPhotoTraits,
} from "@/lib/ai-vision";
import { rankByTraits } from "@/lib/catalog";
import { AI_IP_LIMIT, formatBotTop, takeAiQuota } from "@/lib/ai-search";
import { parseManualTraits } from "@/lib/traits-store";
import { naitiCommandText } from "@/lib/telegram-webhook";

const vocab = { rocks: ["Оникс", "Мрамор", "Травертин"], colors: ["бежевый", "медовый", "белый"] };

describe("§12.2 размер и толщина из текста", () => {
  it("метры и сантиметры", () => {
    expect(parseSizeText("светлый оникс на столешницу 3 на 1,6")).toEqual({ lengthCm: 300, widthCm: 160 });
    expect(parseSizeText("300×160")).toEqual({ lengthCm: 300, widthCm: 160 });
    expect(parseSizeText("160 x 300 см")).toEqual({ lengthCm: 300, widthCm: 160 });
    expect(parseSizeText("2.8х1.6 м")).toEqual({ lengthCm: 280, widthCm: 160 });
    expect(parseSizeText("оникс медовый")).toBeNull();
  });
  it("толщина", () => {
    expect(parseThicknessText("толщина 2 см")).toBe(2);
    expect(parseThicknessText("18 мм")).toBe(1.8);
    expect(parseThicknessText("300 см")).toBeNull();
  });
});

describe("§12.1 признаки и ранжирование", () => {
  const t = { color: "бежевый", tone: "LIGHT" as const, pattern: "VEINS" as const, veinColor: "серый" };
  it("очки совпадения", () => {
    expect(traitScore(t, { color: "Бежевый", tone: "LIGHT", pattern: "VEINS", veinColor: "серый" })).toBe(8);
    expect(traitScore(t, { pattern: "BOLD_VEINS" })).toBe(1);
    expect(traitScore(t, { tone: "DARK" })).toBe(0);
    expect(traitScore(t, {})).toBe(0);
  });
  it("совпадение признаков → наличие → название", () => {
    const items = [
      { name: "Б", availability: "IN_STOCK" as const, traitMatch: 2 },
      { name: "А", availability: "OUT_OF_STOCK" as const, traitMatch: 5 },
      { name: "В", availability: "IN_STOCK" as const, traitMatch: 2 },
      { name: "Г", availability: "OUT_OF_STOCK" as const, traitMatch: 2 },
    ];
    expect(rankByTraits(items).map((i) => i.name)).toEqual(["А", "Б", "В", "Г"]);
  });
  it("ручная правка: только значения из списков", () => {
    expect(parseManualTraits({ color: "бежевый", tone: "LIGHT", pattern: "", veinColor: "" })).toEqual({
      color: "бежевый",
      tone: "LIGHT",
      pattern: null,
      veinColor: null,
    });
    expect(parseManualTraits({ color: "фуксия" })).toBeNull();
    expect(parseManualTraits({ tone: "VERY_DARK" })).toBeNull();
  });
});

describe("фильтры ↔ параметры каталога (чипы)", () => {
  it("порода и цвет — жёсткие, тон/рисунок — ранжирование, размер, толщина, запрос", () => {
    const p = aiFiltersToParams(
      { ...EMPTY_AI_FILTERS, rock: "Оникс", color: "бежевый", tone: "LIGHT", pattern: "VEINS", lengthCm: 300, widthCm: 160, thicknessCm: 2 },
      "светлый оникс",
    );
    expect(Object.fromEntries(p)).toEqual({
      rock: "Оникс",
      color: "бежевый",
      tone: "LIGHT",
      pat: "VEINS",
      l: "300",
      w: "160",
      t: "2",
      ai: "светлый оникс",
    });
    const w = parseWantedTraits(Object.fromEntries(p));
    expect(w).toEqual({ color: "бежевый", tone: "LIGHT", pattern: "VEINS", veinColor: null });
  });
  it("мусор в параметрах игнорируется", () => {
    expect(parseWantedTraits({ tone: "<script>", pat: "X", vein: "фуксия" })).toEqual({
      color: null,
      tone: null,
      pattern: null,
      veinColor: null,
    });
  });
});

describe("ответ модели перепроверяется", () => {
  it("порода/цвет — только из словаря склада, размер — длинная сторона первой", () => {
    expect(
      cleanAiFilters(
        { rock: "оникс", color: "розовый", tone: "LIGHT", pattern: "SPOTS", veinColor: null, lengthCm: 160, widthCm: 300, thicknessCm: 50 },
        vocab,
      ),
    ).toEqual({
      rock: "Оникс",
      color: null,
      tone: "LIGHT",
      pattern: null,
      veinColor: null,
      lengthCm: 300,
      widthCm: 160,
      thicknessCm: null,
    });
    expect(cleanAiFilters(null, vocab)).toBeNull();
  });
  it("фото: нет камня → null; порода только при уверенности", () => {
    expect(cleanPhotoTraits({ isStone: false }, vocab)).toBeNull();
    expect(
      cleanPhotoTraits(
        { isStone: true, color: "белый", tone: "LIGHT", pattern: "VEINS", veinColor: "серый", rock: "Мрамор", rockConfident: false },
        vocab,
      ),
    ).toEqual({ color: "белый", tone: "LIGHT", pattern: "VEINS", veinColor: "серый", rock: null });
    expect(
      cleanPhotoTraits(
        { isStone: true, color: "белый", tone: null, pattern: null, veinColor: null, rock: "Мрамор", rockConfident: true },
        vocab,
      )?.rock,
    ).toBe("Мрамор");
  });
});

describe("вызов ИИ (mock): модель, таймаут 10 с, отказ без ошибки", () => {
  it("фраза → фильтры; та же модель, 10 с, без повторов", async () => {
    const parse = vi.fn(async () => ({
      parsed_output: { rock: "Оникс", color: null, tone: "LIGHT", pattern: null, veinColor: null, lengthCm: null, widthCm: null, thicknessCm: null },
    }));
    const f = await aiParseQuery("светлый оникс на столешницу 3 на 1,6", vocab, { client: { messages: { parse } } });
    expect(f).toMatchObject({ rock: "Оникс", tone: "LIGHT", lengthCm: 300, widthCm: 160 });
    const [args, opts] = parse.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(args.model).toBe(AI_VISION_MODEL);
    expect(opts).toEqual({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
    expect(AI_TIMEOUT_MS).toBe(10_000);
  });
  it("таймаут/ошибка → null (вызывающий покажет обычный поиск)", async () => {
    const parse = vi.fn(async () => {
      throw new Error("Request timed out.");
    });
    expect(await aiParseQuery("оникс", vocab, { client: { messages: { parse } } })).toBeNull();
    expect(
      await aiAnalyzeStonePhoto(
        { bytes: new Uint8Array([1]), mediaType: "image/jpeg" },
        vocab,
        { forSearch: true },
        { client: { messages: { parse } } },
      ),
    ).toBeNull();
  });
  it("нет ключа и нет клиента → null", async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await aiParseQuery("оникс", vocab)).toBeNull();
    } finally {
      if (old !== undefined) process.env.ANTHROPIC_API_KEY = old;
    }
  });
});

describe("§12.4 лимит публичного каталога: 20 в час с IP", () => {
  it("20 проходят, 21-й — нет; без IP лимита нет", async () => {
    let row: { failures: number; firstAt: Date } | null = null;
    const db = {
      loginAttempt: {
        findUnique: vi.fn(async () => row),
        upsert: vi.fn(async (a: { create: { failures: number; firstAt: Date }; update: { failures: number; firstAt: Date } }) => {
          row = row ? { failures: a.update.failures, firstAt: a.update.firstAt } : { failures: a.create.failures, firstAt: a.create.firstAt };
          return {};
        }),
      },
    };
    const now = new Date("2026-11-09T10:00:00Z");
    for (let i = 0; i < AI_IP_LIMIT; i++) expect(await takeAiQuota(db as never, "1.2.3.4", now)).toBe(true);
    expect(await takeAiQuota(db as never, "1.2.3.4", now)).toBe(false);
    expect(await takeAiQuota(db as never, "", now)).toBe(true);
    // Через час окно сбрасывается.
    expect(await takeAiQuota(db as never, "1.2.3.4", new Date(now.getTime() + 61 * 60_000))).toBe(true);
  });
});

describe("§12.4 бот /naiti", () => {
  it("команда и текст после неё", () => {
    expect(naitiCommandText("/naiti светлый оникс")).toBe("светлый оникс");
    expect(naitiCommandText("/naiti@OnyxBot 3 на 1,6")).toBe("3 на 1,6");
    expect(naitiCommandText("/naiti")).toBe("");
    expect(naitiCommandText("/naitix")).toBeNull();
    expect(naitiCommandText(undefined)).toBeNull();
  });
  it("топ-5 с наличием и ссылками", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      viewer: "staff" as const,
      code: `ONX-AAAA${i}`,
      name: `Камень ${i}`,
      rockType: "Оникс",
      color: null,
      photoId: null,
      sizes: [],
      thicknesses: [],
      availability: i === 1 ? ("OUT_OF_STOCK" as const) : ("IN_STOCK" as const),
      stoneTypeId: `st${i}`,
      freeSlabs: 4,
      freeAreaM2: 12.5,
      freePieces: 0,
      hiddenReason: null,
    }));
    const text = formatBotTop(
      { items: items as never, aiOk: true, params: new URLSearchParams({ rock: "Оникс" }) },
      "https://onyx.test/",
      "text",
    );
    expect(text.split("\n")[0]).toBe("Нашёл по запросу:");
    expect(text).toContain("1. Камень 0 — в наличии 4 пл. · 12,5 м²\nhttps://onyx.test/k/ONX-AAAA0");
    expect(text).toContain("2. Камень 1 — нет в наличии");
    expect(text).not.toContain("Камень 5");
    expect(text).toContain("https://onyx.test/katalog?rock=");
  });
  it("ничего не нашлось / ИИ не ответил", () => {
    expect(formatBotTop({ items: [], aiOk: false, params: new URLSearchParams() }, "https://x", "text")).toContain(
      "Ничего не нашлось",
    );
  });
});

describe("ИИ не ответил — обычный поиск понимает словарь склада", () => {
  it("порода и цвет по основе слова, тон, размер не мешает", async () => {
    const { plainTextFilters } = await import("@/lib/stone-traits");
    expect(plainTextFilters("светлый травертин с прожилками на столешницу 3 на 1,6", vocab)).toEqual({
      rock: "Травертин",
      color: null,
      tone: "LIGHT",
      q: null,
    });
    expect(plainTextFilters("медовый оникс", vocab)).toMatchObject({ rock: "Оникс", color: "медовый" });
    expect(plainTextFilters("что-нибудь зелёное", vocab)).toMatchObject({ rock: null, color: null, q: "зелёное" });
  });
});

describe("фото для ИИ без sharp — тип по первым байтам", () => {
  it("JPEG / PNG / WebP / мусор", async () => {
    const { sniffImageType } = await import("@/lib/traits-store");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]))).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
