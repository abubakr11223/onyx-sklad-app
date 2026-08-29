// W3-T4 (a) — толщина в /poisk рисовалась как «—»: Prisma отдаёт `thicknessMm`
// как Decimal (NUMERIC(5,1)), а `formatThickness` принимает number. Здесь
// проверяется чистый хелпер страницы (page.tsx — Next server component, целиком
// не импортируется; та же политика, что в poisk-locations.test.ts) и то, что в
// разметке /poisk не осталось прямой передачи Decimal в formatThickness.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatThicknessCm } from "@/app/poisk/page";

/** Заглушка Prisma Decimal: важен только toString(). */
const decimal = (v: string) => ({ toString: () => v });

describe("formatThicknessCm — Decimal из БД доходит до экрана (W3-T4)", () => {
  it("Decimal «1.8» → «1,8» (реальные 18 мм не теряются)", () => {
    expect(formatThicknessCm(decimal("1.8"))).toBe("1,8");
  });

  it("целая толщина без хвостового нуля: Decimal «2.0» → «2»", () => {
    expect(formatThicknessCm(decimal("2.0"))).toBe("2");
  });

  it("обычный number тоже работает (плиты из других источников)", () => {
    expect(formatThicknessCm(1.8)).toBe("1,8");
    expect(formatThicknessCm(2)).toBe("2");
  });

  it("нет толщины / мусор → «—»", () => {
    expect(formatThicknessCm(null)).toBe("—");
    expect(formatThicknessCm(undefined)).toBe("—");
    expect(formatThicknessCm(decimal("не число"))).toBe("—");
  });
});

describe("/poisk page.tsx — Decimal не уходит в formatThickness напрямую", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/app/poisk/page.tsx"),
    "utf8",
  );

  it("все места вывода толщины идут через formatThicknessCm", () => {
    // Прямых вызовов formatThickness(...) в разметке быть не должно —
    // единственный остаётся внутри самого хелпера.
    const direct = src.match(/formatThickness\(/g) ?? [];
    expect(direct.length).toBe(1);
    expect(src).toContain("return formatThickness(thicknessToNumber(v));");
    // 4 места вывода (бой/остатки, именованные плиты, формат партии, узоры
    // партии) + само объявление хелпера.
    expect((src.match(/formatThicknessCm\(/g) ?? []).length).toBe(5);
  });

  it("типы строк честно допускают Decimal (не только number)", () => {
    expect(
      (src.match(/thicknessMm: \{ toString\(\): string \} \| number \| null;/g) ?? [])
        .length,
    ).toBe(4);
  });
});
