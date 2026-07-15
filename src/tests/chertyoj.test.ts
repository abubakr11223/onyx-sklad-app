// §5.5a — sof chertyoj helperlari testlari (SDK/DB YO'Q).
// Normativ manba: TZ §5.5 «AI singan tosh shaklini chizadi».
import { describe, expect, it } from "vitest";
import {
  escapeXml,
  renderChertyoj,
  sideCount,
  validatePolygon,
  type Vertex,
} from "@/lib/chertyoj";

const TRIANGLE: Vertex[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const SQUARE: Vertex[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("validatePolygon — §5.5a", () => {
  it("validli uchburchak/to'rtburchak → true", () => {
    expect(validatePolygon(TRIANGLE)).toBe(true);
    expect(validatePolygon(SQUARE)).toBe(true);
  });

  it("< 3 nuqta → false", () => {
    expect(validatePolygon([{ x: 0, y: 0 }])).toBe(false);
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it("non-array → false", () => {
    expect(validatePolygon(null)).toBe(false);
    expect(validatePolygon(undefined)).toBe(false);
    expect(validatePolygon("polygon")).toBe(false);
    expect(validatePolygon({ x: 0, y: 0 })).toBe(false);
  });

  it("son bo'lmagan koordinata → false", () => {
    expect(validatePolygon([{ x: "0", y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(
      false,
    );
    expect(
      validatePolygon([{ x: NaN, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]),
    ).toBe(false);
    expect(validatePolygon([{ y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(false);
  });

  it("diapazondan tashqari (>1 yoki <0) → false", () => {
    expect(
      validatePolygon([{ x: 1.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]),
    ).toBe(false);
    expect(
      validatePolygon([{ x: 0, y: -0.1 }, { x: 1, y: 1 }, { x: 0, y: 1 }]),
    ).toBe(false);
  });
});

describe("sideCount — §5.5a", () => {
  it("uchburchak → 3, to'rtburchak → 4", () => {
    expect(sideCount(TRIANGLE)).toBe(3);
    expect(sideCount(SQUARE)).toBe(4);
  });
});

describe("renderChertyoj — §5.5a", () => {
  it("<svg va <polygon o'z ichiga oladi", () => {
    const svg = renderChertyoj(SQUARE);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("</svg>");
  });

  it("har tomon raqami (1..4) chiqadi", () => {
    const svg = renderChertyoj(SQUARE);
    expect(svg).toContain(">1</text>");
    expect(svg).toContain(">2</text>");
    expect(svg).toContain(">3</text>");
    expect(svg).toContain(">4</text>");
  });

  it("qat'iy kvadrat uchun determinik points (default 320x320, padding 24)", () => {
    const svg = renderChertyoj(SQUARE);
    // [0,1] → [24, 296]
    expect(svg).toContain('points="24,24 296,24 296,296 24,296"');
  });

  it("sideLabels berilsa — raqam o'rniga yozuv chiqadi", () => {
    const svg = renderChertyoj(SQUARE, {
      sideLabels: ["1180", "640", "950", "610"],
    });
    expect(svg).toContain(">1180</text>");
    expect(svg).toContain(">640</text>");
    expect(svg).not.toContain(">1</text>");
  });

  it("sideLabels ekranlanadi — XSS-yozuv SVG'ga xom kirmaydi", () => {
    const svg = renderChertyoj(SQUARE, {
      sideLabels: ['"><script>alert(1)</script>', "a & b", '5" x 3'],
    });
    // Xom in'ektsiya YO'Q:
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("</script>");
    // Entity'lar bor:
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&quot;&gt;");
    expect(svg).toContain(">a &amp; b</text>");
    expect(svg).toContain(">5&quot; x 3</text>");
  });
});

describe("escapeXml — §5.5a (stored-XSS himoyasi)", () => {
  it("& < > \" ' → entity'lar; ampersand ikki marta ekranlanmaydi", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
    expect(escapeXml("1180")).toBe("1180");
  });
});
