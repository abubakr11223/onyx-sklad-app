// Аудит ТЗ №7 #15 — generateInteriors (пул из INTERIOR_SCENES = 3 сцены) не был
// покрыт: агрегация partial-fail и fail-closed при полном провале не проверялись.
// Регрессия к «одна сцена бросит → падает вся генерация» или «всё упало → images
// возвращается без error» ловятся здесь. Мокаем `ai.generateText` — фактического
// вызова Gateway не происходит (не требуется ни ключ, ни сеть).

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted чтобы моки существовали до vi.mock.
const M = vi.hoisted(() => ({
  generateText: vi.fn(),
}));
vi.mock("ai", () => ({ generateText: M.generateText }));

// Импорт ПОСЛЕ мока.
import {
  generateInteriors,
  INTERIOR_SCENES,
  type RefImage,
} from "@/lib/interior-ai";

const REF: RefImage = {
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "image/jpeg",
};

/** Успешный результат generateText: возвращает файл image/png с указанными байтами. */
function mkOk(bytes: number[] = [10, 20, 30]) {
  return {
    files: [
      {
        mediaType: "image/png",
        uint8Array: new Uint8Array(bytes),
      },
    ],
  };
}

/** Успешный вызов, НО без image-файла (агрегатор должен считать сцену ok:false). */
function mkNoImage() {
  return { files: [{ mediaType: "text/plain", uint8Array: new Uint8Array() }] };
}

beforeEach(() => {
  M.generateText.mockReset();
});

// ═══════════════ (1) Hammasi ok ═══════════════

describe("generateInteriors — все сцены успешны (ТЗ №7 #15)", () => {
  it("images = INTERIOR_SCENES.length, error отсутствует, generateText вызван 1× на сцену", async () => {
    M.generateText.mockImplementation(async () => mkOk());

    const res = await generateInteriors(REF, "Оникс Медовый, оникс, жёлтый");

    expect(res.images).toHaveLength(INTERIOR_SCENES.length);
    expect(res.error).toBeUndefined();
    // Порядок и метаданные каждой сцены сохранены.
    for (const scene of INTERIOR_SCENES) {
      const img = res.images.find((i) => i.scene === scene.key);
      expect(img).toBeDefined();
      expect(img!.label).toBe(scene.label);
      expect(img!.mediaType).toBe("image/png");
      expect(img!.bytes.byteLength).toBeGreaterThan(0);
    }
    expect(M.generateText).toHaveBeenCalledTimes(INTERIOR_SCENES.length);
  });
});

// ═══════════════ (2) Qisman fail — muvaffaqiyatlilar qайtadi + error bor ═══════════════

describe("generateInteriors — partial fail (ТЗ №7 #15)", () => {
  it("одна сцена throws → успешные возвращаются, error string проставлен", async () => {
    // Первая сцена — throws (нет кредитов), остальные — ok.
    M.generateText
      .mockRejectedValueOnce(new Error("no credits"))
      .mockResolvedValueOnce(mkOk())
      .mockResolvedValueOnce(mkOk());

    const res = await generateInteriors(REF, "Оникс");

    // Агрегация: 3 − 1 = 2 успеха; error ставится, но НЕ throw.
    expect(res.images).toHaveLength(INTERIOR_SCENES.length - 1);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("no credits");
    // Ключи выживших сцен — из INTERIOR_SCENES (не reception, потому что первая упала).
    const survivedKeys = res.images.map((i) => i.scene).sort();
    expect(survivedKeys).toEqual(
      INTERIOR_SCENES.slice(1)
        .map((s) => s.key)
        .sort(),
    );
  });

  it("одна сцена без image-файла (files:[text]) → тоже считается fail; остальные проходят", async () => {
    M.generateText
      .mockResolvedValueOnce(mkOk())
      .mockResolvedValueOnce(mkNoImage())
      .mockResolvedValueOnce(mkOk());

    const res = await generateInteriors(REF, "Оникс");

    expect(res.images).toHaveLength(2);
    // Error сообщает о причине — «модель не вернула изображение».
    expect(res.error).toMatch(/изображени|модель/i);
  });
});

// ═══════════════ (3) Hammasi fail — images=[] + error aniq ═══════════════

describe("generateInteriors — все сцены упали (ТЗ №7 #15)", () => {
  it("throws на всех → images=[], error = ПЕРВАЯ причина", async () => {
    // Первая — специфичная ошибка (для проверки, что мы берём именно первую).
    M.generateText
      .mockRejectedValueOnce(new Error("first: no api key"))
      .mockRejectedValueOnce(new Error("second: rate limit"))
      .mockRejectedValueOnce(new Error("third: model down"));

    const res = await generateInteriors(REF, "Оникс");

    expect(res.images).toEqual([]);
    expect(res.error).toBeDefined();
    // Первая ошибка — та, что зафиксирована.
    expect(res.error).toContain("first: no api key");
    // Функция НЕ throws (fail-closed контракт сохранён — вызывающий имеет
    // возможность красиво отредиректить с ?aiErr= вместо 500).
    expect(res).toBeTruthy();
  });

  it("все сцены вернули файл БЕЗ image/* → images=[], error про отсутствие изображения", async () => {
    M.generateText.mockImplementation(async () => mkNoImage());

    const res = await generateInteriors(REF, "Оникс");

    expect(res.images).toEqual([]);
    expect(res.error).toMatch(/изображени|модель/i);
  });
});
