// §5.5b — singan draft kodeki testlari (sof modul, DB/tarmoq YO'Q).
// `d` — foydalanuvchi nazoratidagi URL ma'lumoti: decode QATTIQ va hech qachon
// throw qilmasligi kontraktning o'zi (locations.test.ts uslubi).
import { describe, expect, it } from "vitest";
import { decodeShapeDraft, encodeShapeDraft, type ShapeDraft } from "@/lib/singan";

const DRAFT: ShapeDraft = {
  vertices: [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.4 },
    { x: 0.8, y: 1 },
    { x: 0.2, y: 1 },
    { x: 0, y: 0.4 },
  ],
  fileId: "AgACAgIAAxkBAAIB-mZ_abc-DEF_123",
};

describe("encodeShapeDraft / decodeShapeDraft — round-trip", () => {
  it("encode → decode asl draft'ni qaytaradi", () => {
    const encoded = encodeShapeDraft(DRAFT);
    expect(decodeShapeDraft(encoded)).toEqual(DRAFT);
  });

  it("encode natijasi URL-safe (base64url: +/= yo'q)", () => {
    const encoded = encodeShapeDraft(DRAFT);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("decodeShapeDraft — qattiq validatsiya (foydalanuvchi kirishi)", () => {
  it("satr bo'lmagan kirish → null (throw YO'Q)", () => {
    expect(decodeShapeDraft(undefined)).toBeNull();
    expect(decodeShapeDraft(null)).toBeNull();
    expect(decodeShapeDraft(42)).toBeNull();
    expect(decodeShapeDraft(["a"])).toBeNull();
    expect(decodeShapeDraft("")).toBeNull();
  });

  it("axlat / buzilgan base64url → null", () => {
    expect(decodeShapeDraft("!!!не-base64!!!")).toBeNull();
    expect(decodeShapeDraft("aGVsbG8")).toBeNull(); // "hello" — JSON emas
    // Buzilgan (tampered) yuk: to'g'ri encode'ning bir belgisi almashtirilgan.
    const tampered = "X" + encodeShapeDraft(DRAFT).slice(1);
    expect(decodeShapeDraft(tampered)).toBeNull();
  });

  it("JSON, lekin object emas (massiv/son) → null", () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(decodeShapeDraft(enc([1, 2, 3]))).toBeNull();
    expect(decodeShapeDraft(enc(7))).toBeNull();
    expect(decodeShapeDraft(enc(null))).toBeNull();
  });

  it("juda uzun kirish (> 2000 belgi) → null", () => {
    const huge = encodeShapeDraft(DRAFT) + "A".repeat(2001);
    expect(decodeShapeDraft(huge)).toBeNull();
  });

  it("yaroqsiz polygon (2 uch / diapazondan tashqari) → null", () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(
      decodeShapeDraft(
        enc({ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], fileId: "abc" }),
      ),
    ).toBeNull();
    expect(
      decodeShapeDraft(
        enc({
          vertices: [{ x: 0, y: 0 }, { x: 1.5, y: 0 }, { x: 1, y: 1 }],
          fileId: "abc",
        }),
      ),
    ).toBeNull();
  });

  it("20 dan ortiq uch → null", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      x: (i % 10) / 10,
      y: Math.floor(i / 10) / 10,
    }));
    const encoded = encodeShapeDraft({ vertices: many, fileId: "abc" });
    expect(decodeShapeDraft(encoded)).toBeNull();
    // Chegaraning o'zi (20) — o'tadi.
    const twenty = encodeShapeDraft({ vertices: many.slice(0, 20), fileId: "abc" });
    expect(decodeShapeDraft(twenty)).not.toBeNull();
  });

  it("fileId yomon alifbo / bo'sh / juda uzun → null", () => {
    const enc = (fileId: unknown) =>
      Buffer.from(JSON.stringify({ vertices: DRAFT.vertices, fileId })).toString(
        "base64url",
      );
    expect(decodeShapeDraft(enc("abc def"))).toBeNull(); // probel
    expect(decodeShapeDraft(enc("abc/../etc"))).toBeNull(); // path-belgi
    expect(decodeShapeDraft(enc("файл"))).toBeNull(); // kirill
    expect(decodeShapeDraft(enc(""))).toBeNull();
    expect(decodeShapeDraft(enc(123))).toBeNull(); // satr emas
    expect(decodeShapeDraft(enc("a".repeat(201)))).toBeNull(); // > 200
    expect(decodeShapeDraft(enc("a".repeat(200)))).not.toBeNull(); // chegara — o'tadi
  });

  it("begona kalitlar tashlab yuboriladi (faqat vertices + fileId qaytadi)", () => {
    const withExtra = Buffer.from(
      JSON.stringify({ ...DRAFT, evil: "<script>" }),
    ).toString("base64url");
    expect(decodeShapeDraft(withExtra)).toEqual(DRAFT);
  });
});
