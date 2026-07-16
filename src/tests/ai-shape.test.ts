// §5.5a — AI shakl-aniqlash testlari MOCK client bilan (real kalit KERAK EMAS,
// tarmoqqa CHIQMAYDI). Normativ manba: TZ §5.5.
import { describe, expect, it, vi } from "vitest";
import {
  analyzeBrokenStoneShape,
  type MinimalAnthropicClient,
} from "@/lib/ai-shape";

const QUAD_VERTICES = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** parsed_output'ni oldindan tayyorlab qaytaruvchi soxta client quradi. */
function makeClient(parsedOutput: unknown): {
  client: MinimalAnthropicClient;
  parse: ReturnType<typeof vi.fn>;
} {
  const parse = vi.fn().mockResolvedValue({ parsed_output: parsedOutput });
  return { client: { messages: { parse } }, parse };
}

describe("analyzeBrokenStoneShape — §5.5a", () => {
  it("to'g'ri parse → ShapeResult (validatsiyadan o'tgan polygon)", async () => {
    const { client, parse } = makeClient({
      sideCount: 4,
      vertices: QUAD_VERTICES,
    });

    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", {
      client,
    });

    expect(result).toEqual({ sideCount: 4, vertices: QUAD_VERTICES });
    expect(parse).toHaveBeenCalledTimes(1);

    // Vision-blok + structured-output sxemasi to'g'ri uzatilganini tekshiramiz.
    const args = parse.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-4-8");
    expect(args.output_config.format.type).toBe("json_schema");
    const content = args.messages[0].content;
    expect(content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
    });
    expect(content[1].type).toBe("text");
  });

  it("parsed_output null → null", async () => {
    const { client } = makeClient(null);
    const result = await analyzeBrokenStoneShape("QUJD", "image/png", { client });
    expect(result).toBeNull();
  });

  it("yaroqsiz polygon (2 nuqta) → null", async () => {
    const { client } = makeClient({
      sideCount: 2,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", { client });
    expect(result).toBeNull();
  });

  it("diapazondan tashqari koordinata → null", async () => {
    const { client } = makeClient({
      sideCount: 4,
      vertices: [
        { x: 0, y: 0 },
        { x: 1.4, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    });
    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", { client });
    expect(result).toBeNull();
  });

  it("parse reject qilsa (tarmoq/429) → null, reject EMAS (fail-closed)", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("network down"));
    const client: MinimalAnthropicClient = { messages: { parse } };

    // resolves — funksiya throw/reject qilmasligi kontraktning o'zi.
    await expect(
      analyzeBrokenStoneShape("QUJD", "image/jpeg", { client }),
    ).resolves.toBeNull();
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("ANTHROPIC_API_KEY yo'q + client inyeksiya qilinmagan → null", async () => {
    // auth.test.ts uslubi: env'ni saqlab, o'chirib, oxirida tiklaymiz.
    const OLD_KEY = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg");
      expect(result).toBeNull();
    } finally {
      if (OLD_KEY !== undefined) process.env.ANTHROPIC_API_KEY = OLD_KEY;
    }
  });

  it("yopuvchi dublikat uch (oxirgisi ≈ birinchisi) tashlanadi: 6 uch → 5 tomon", async () => {
    // Jonli sinov: model polygon'ni birinchi uchni takrorlab «yopadi».
    const pentagon = [
      { x: 0.5, y: 0 },
      { x: 1, y: 0.4 },
      { x: 0.8, y: 1 },
      { x: 0.2, y: 1 },
      { x: 0, y: 0.4 },
      { x: 0.51, y: 0.01 }, // birinchisiga ~0.01 masofada — dublikat
    ];
    const { client } = makeClient({ sideCount: 6, vertices: pentagon });

    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", { client });

    expect(result).not.toBeNull();
    expect(result!.sideCount).toBe(5);
    expect(result!.vertices).toEqual(pentagon.slice(0, 5));
  });

  it("oxirgi uch birinchisidan uzoq bo'lsa — dedup QILINMAYDI", async () => {
    // QUAD_VERTICES: oxirgi {0,1} birinchi {0,0}dan y bo'yicha 1 uzoqda.
    const { client } = makeClient({ sideCount: 4, vertices: QUAD_VERTICES });
    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", { client });
    expect(result).toEqual({ sideCount: 4, vertices: QUAD_VERTICES });
  });

  it("dedup'dan keyin 3 uchdan kam qolsa → null", async () => {
    const { client } = makeClient({
      sideCount: 3,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0.01, y: 0.01 }, // birinchisining dublikati → 2 uch qoladi
      ],
    });
    const result = await analyzeBrokenStoneShape("QUJD", "image/jpeg", { client });
    expect(result).toBeNull();
  });

  it("base64 ichidagi probel/yangi qatorlar yuborishdan oldin tozalanadi", async () => {
    const { client, parse } = makeClient({
      sideCount: 4,
      vertices: QUAD_VERTICES,
    });
    await analyzeBrokenStoneShape("QU\nJD ==", "image/jpeg", { client });
    const args = parse.mock.calls[0][0];
    expect(args.messages[0].content[0].source.data).toBe("QUJD==");
  });
});
