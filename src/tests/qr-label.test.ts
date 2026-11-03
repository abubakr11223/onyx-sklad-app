// ТЗ №20 G — QR (SVG), ссылка, данные этикетки, параметры печати.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUBLIC_BASE_URL,
  QR_PRINT_MAX,
  formatQrLabel,
  loadQrLabels,
  parseQrPrintParams,
  publicBaseUrl,
  qrPrintHref,
  qrSvg,
  stoneCodeUrl,
  type QrLabelDb,
} from "@/lib/qr";
import { capabilitiesFor } from "@/lib/permissions";

describe("ссылка на карточку", () => {
  it("по умолчанию — текущий домен", () => {
    expect(publicBaseUrl({})).toBe(DEFAULT_PUBLIC_BASE_URL);
    expect(stoneCodeUrl("ONX-7K3QD", publicBaseUrl({}))).toBe(
      "https://onyx-sklad-app.vercel.app/k/ONX-7K3QD",
    );
  });
  it("PUBLIC_BASE_URL переопределяет, хвостовой / убирается", () => {
    expect(publicBaseUrl({ PUBLIC_BASE_URL: "https://onyx.uz/" })).toBe("https://onyx.uz");
  });
  it("мусор в env — откат на домен по умолчанию", () => {
    expect(publicBaseUrl({ PUBLIC_BASE_URL: "onyx.uz" })).toBe(DEFAULT_PUBLIC_BASE_URL);
  });
});

describe("qrSvg", () => {
  it("inline SVG без внешних ссылок, с тёмными модулями", async () => {
    const svg = await qrSvg("https://onyx-sklad-app.vercel.app/k/ONX-7K3QD");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain('stroke="#000000"');
    expect(svg).not.toMatch(/href=|<script/i);
  });
  it("разные ссылки — разные QR", async () => {
    expect(await qrSvg("https://a/k/ONX-AAAAA")).not.toBe(await qrSvg("https://a/k/ONX-BBBBB"));
  });
});

describe("formatQrLabel", () => {
  it("все поля", () => {
    expect(
      formatQrLabel({
        code: "ONX-7K3QD",
        kind: "PATTERN",
        name: "Травертин Классик",
        rockType: "Травертин",
        color: "бежевый",
        detail: " светлый ",
        lengthCm: 280,
        widthCm: 160,
        thicknessCm: 1.8,
      }),
    ).toEqual({
      code: "ONX-7K3QD",
      kind: "PATTERN",
      name: "Травертин Классик",
      rockColor: "Травертин · бежевый",
      detail: "светлый",
      size: "280 × 160 см",
      thickness: "1,8 см",
    });
  });
  it("пустое не печатаем", () => {
    const l = formatQrLabel({
      code: "ONX-AAAAA",
      kind: "STONE_TYPE",
      name: "Оникс",
      rockType: "Оникс",
      color: null,
      detail: null,
      lengthCm: null,
      widthCm: 100,
      thicknessCm: null,
    });
    expect(l.rockColor).toBe("Оникс");
    expect(l.size).toBeNull();
    expect(l.thickness).toBeNull();
    expect(l.detail).toBeNull();
  });
});

describe("parseQrPrintParams", () => {
  it("codes через запятую + повторяющийся code, дубли и регистр", () => {
    const p = parseQrPrintParams({
      codes: "onx-aaaaa,ONX-BBBBB",
      code: ["ONX-AAAAA", "ccccc", "мусор"],
      format: "a4",
    });
    expect(p.codes).toEqual(["ONX-AAAAA", "ONX-BBBBB", "ONX-CCCCC"]);
    expect(p.invalid).toBe(1);
    expect(p.format).toBe("a4");
  });
  it("формат по умолчанию — одна этикетка", () => {
    expect(parseQrPrintParams({}).format).toBe("label");
    expect(parseQrPrintParams({ format: "zzz" }).format).toBe("label");
    expect(parseQrPrintParams({}).codes).toEqual([]);
  });
  it("лимит на одну печать", () => {
    const alphabet = "ABCDEFGH";
    const many: string[] = [];
    for (const a of alphabet) for (const b of alphabet) for (const c of "AB") many.push(`ONX-${a}${b}${c}22`);
    const p = parseQrPrintParams({ codes: many.join(",") });
    expect(p.codes).toHaveLength(QR_PRINT_MAX);
    expect(p.truncated).toBe(many.length - QR_PRINT_MAX);
  });
  it("qrPrintHref ↔ parse", () => {
    const href = qrPrintHref(["ONX-AAAAA", "ONX-BBBBB"], "a4");
    const sp = Object.fromEntries(new URL(href, "https://x").searchParams);
    expect(parseQrPrintParams(sp)).toMatchObject({ codes: ["ONX-AAAAA", "ONX-BBBBB"], format: "a4" });
  });
});

describe("loadQrLabels", () => {
  it("размер — от самого точного уровня, порядок как в запросе", async () => {
    const st = { name: "Оникс Белый", rockType: "Оникс", color: "белый" };
    const db = {
      stoneType: { findMany: vi.fn().mockResolvedValue([]) },
      batch: { findMany: vi.fn().mockResolvedValue([]) },
      batchPattern: { findMany: vi.fn().mockResolvedValue([]) },
      slab: {
        findMany: vi.fn().mockResolvedValue([
          {
            code: "ONX-SSSSS",
            label: "Плита №2",
            lengthMm: null,
            widthMm: null,
            thicknessMm: null,
            stoneType: st,
            batchPattern: { description: "светлый", lengthMm: 270, widthMm: 150, thicknessMm: null },
            batch: { lengthMm: 300, widthMm: 180, thicknessMm: 2 },
          },
        ]),
      },
      piece: {
        findMany: vi.fn().mockResolvedValue([
          {
            code: "ONX-PPPPP",
            kind: "BROKEN",
            boundingLengthMm: 118,
            boundingWidthMm: 64,
            thicknessMm: null,
            stoneType: st,
            batchPattern: null,
            batch: { thicknessMm: 1.8 },
          },
        ]),
      },
    };
    const labels = await loadQrLabels(db as unknown as QrLabelDb, ["ONX-PPPPP", "ONX-NOTFD", "ONX-SSSSS"]);
    expect(labels.map((l) => l.code)).toEqual(["ONX-PPPPP", "ONX-SSSSS"]);
    expect(labels[0]).toMatchObject({ detail: "Бой", size: "118 × 64 см", thickness: "1,8 см" });
    expect(labels[1]).toMatchObject({
      detail: "Плита №2 · светлый",
      size: "270 × 150 см",
      thickness: "2 см",
      rockColor: "Оникс · белый",
    });
  });
});

describe("Печать QR — доступ (§15)", () => {
  it("весь персонал да, партнёр нет", () => {
    const o = { canSeePurchasePrice: false };
    expect(capabilitiesFor("OWNER", o).canPrintQr).toBe(true);
    expect(capabilitiesFor("MANAGER", o).canPrintQr).toBe(true);
    expect(capabilitiesFor("WAREHOUSE", o).canPrintQr).toBe(true);
    expect(capabilitiesFor("WAREHOUSE_LEAD", o).canPrintQr).toBe(true);
    expect(capabilitiesFor("PARTNER", o).canPrintQr).toBe(false);
  });
});
