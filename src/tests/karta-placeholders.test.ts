// W3-T7 — /karta-sklada tahrir rejimi placeholder'lari LOTIN misollar bilan
// (ТЗ №17 §3.1: kod faqat latinitsa — «Буква (А, Б…)» kabi kirill misollar
// validatsiya bilan zid edi va har kuni chalg'itardi).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  path.resolve(__dirname, "../app/karta-sklada/page.tsx"),
  "utf8",
);

describe("karta-sklada placeholders (ТЗ №17 — латиница)", () => {
  it("blok harfi placeholder'ida LOTIN misollar", () => {
    expect(src).toContain('placeholder="Буква (A, D…)"');
    // Eski kirill misol qaytib kelmasin.
    expect(src).not.toContain("(А, Б…)");
  });

  it("hech bir placeholder'da kirill A–Я harfli misol qavslari yo'q", () => {
    const placeholders = src.match(/placeholder="[^"]*"/g) ?? [];
    for (const p of placeholders) {
      // Qavs ichidagi misollar (harflar) — kirill bosh harflari bo'lmasin.
      const example = p.match(/\(([^)]*)\)/);
      if (example) {
        expect(example[1]).not.toMatch(/[А-Я]\s*,/);
      }
    }
  });

  it("validatsiya xabari lotin misollari bilan mos", () => {
    expect(src).toContain("только латиницей и цифрами (например A1, D3, K1)");
  });

  it("blok qo'shish formasi tagida lotin misolli izoh bor", () => {
    expect(src).toContain(
      "Код блока — только латиницей и цифрами, например A1, D3.",
    );
  });

  it("nomini o'zgartirish input'ida ham lotin misolli placeholder", () => {
    const occurrences = src.match(/placeholder="Буква \(A, D…\)"/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
