// §5.5a — singan tosh SHAKLINI aniqlash (Anthropic / Claude vision).
// TZ §5.5: suratdan AI faqat SHAKLNI chizadi (tomonlar soni + taxminiy polygon
// konturi) — REAL o'lchamlarni odam keyin o'lchaydi. Shu tufayli AI normalizatsiya
// qilingan (unit) polygon qaytaradi, o'lcham EMAS.
//
// Bu — SDK'ni import qiladigan YAGONA fayl. chertyoj.ts SOF qoladi va biz undan
// validatePolygon/sideCount'ni import qilamiz (teskarisi emas).
//
// Deps-inyeksiya (photo-requests.ts / telegram-webhook.ts uslubida): test mock
// `deps.client` uzatadi — real API kalitisiz ishlaydi. Kalit yo'q bo'lsa — модуль
// НЕ падает: console.warn + null qaytaradi (signMagicLinkToken bo'sh-sekret uslubi).

import Anthropic from "@anthropic-ai/sdk";
import { sideCount, validatePolygon } from "@/lib/chertyoj";

// ──────────────────── Tiplar / Типы ────────────────────

/** AI natijasi: tomonlar soni + normalizatsiya qilingan polygon uchlari. */
export interface ShapeResult {
  sideCount: number;
  vertices: { x: number; y: number }[];
}

/**
 * Anthropic client'ning bizga kerakli MINIMAL shakli — test oson mock qilishi
 * uchun (Prisma'ning to'liq tipini talab qilmaganimizdek). Минимальная форма клиента.
 */
export interface MinimalAnthropicClient {
  messages: {
    parse(args: Record<string, unknown>): Promise<{ parsed_output: unknown }>;
  };
}

export interface AnalyzeShapeDeps {
  client?: MinimalAnthropicClient;
}

// ──────────────────── Structured-output sxemasi ────────────────────
// json_schema qo'lda quriladi (Zod DEPENDENCY qo'shmaymiz). Cheklovlar:
// har object'da additionalProperties:false + required; minimum/maximum/minItems
// ИШЛАТИЛМАЙДИ (structured-output qo'llamaydi) — ularni parse'dan keyin kodda
// tekshiramiz (validatePolygon).
const SHAPE_JSON_SCHEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      sideCount: { type: "integer" },
      vertices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
    },
    required: ["sideCount", "vertices"],
    additionalProperties: false,
  },
};

const PROMPT =
  "You are given a photograph of a broken / irregular stone slab. " +
  "Trace ONLY the outer outline (silhouette) of the stone as a simple closed polygon. " +
  "Return the ordered vertices of that outline in normalized [0,1] coordinates, " +
  "with the origin at the top-left corner of the image (x → right, y → down). " +
  "Also return the number of sides (edges). Approximate the shape — 4 to 12 sides " +
  "is typical. Do NOT measure real-world dimensions; a human will measure each side " +
  "later. Order the vertices consistently around the perimeter (clockwise).";

// ──────────────────── Asosiy amal / Основная операция ────────────────────

/**
 * Suratdan singan tosh shaklini polygon sifatida aniqlaydi.
 * @param imageBase64  yangi qatorlarsiz base64 rasm ma'lumoti.
 * @param mediaType    rasm turi (base64 bilan mos bo'lishi shart).
 * @param deps.client  test/DI uchun inyeksiya qilinadigan client (ixtiyoriy).
 *
 * Fail-closed kontrakt — funksiya HECH QACHON throw qilmaydi, har xatoda null:
 * (1) kalit (ANTHROPIC_API_KEY) yo'q va client inyeksiya qilinmagan → null;
 * (2) API/tarmoq xatosi (reject: 429/400/network) → console.warn + null;
 * (3) SDK'ning messages.parse'i model JSON'ini parse qilolmay THROW qilsa
 *     (masalan max_tokens kesgan — AnthropicError) → console.warn + null;
 * (4) parsed_output null yoki polygon yaroqsiz → null.
 */
export async function analyzeBrokenStoneShape(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png",
  deps: AnalyzeShapeDeps = {},
): Promise<ShapeResult | null> {
  let client = deps.client;

  // Client inyeksiya qilinmagan — real Anthropic'ni LAZY quramiz (modulni import
  // qilish build vaqtida kalit talab qilmasin uchun). Kalit yo'q bo'lsa — null.
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(
        "[ai-shape] ANTHROPIC_API_KEY o'rnatilmagan — shakl aniqlash o'tkazib yuborildi (null).",
      );
      return null;
    }
    // new Anthropic() — nol-argumentli konstruktor kalitni env'dan oladi.
    client = new Anthropic() as unknown as MinimalAnthropicClient;
  }

  // Telegram-manbali base64'da yangi qator/probellar uchrashi mumkin — API
  // ularni qabul qilmaydi, defensiv tozalaymiz.
  const data = imageBase64.replace(/\s+/g, "");

  // Butun API-chaqiruv + validatsiya try ichida: SDK parse'i tarmoq xatosida
  // reject qiladi, buzuq model-JSON'da esa AnthropicError THROW qiladi (parsed_output:
  // null QAYTARMAYDI) — ikkalasi ham fail-closed kontraktga ko'ra null bo'lishi kerak.
  try {
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: { format: SHAPE_JSON_SCHEMA },
    });

    // parsed_output null bo'lishi mumkin — himoyalaymiz.
    const parsed = response.parsed_output as { vertices?: unknown } | null;
    if (parsed == null || !validatePolygon(parsed.vertices)) {
      console.warn("[ai-shape] AI polygon yaroqsiz yoki bo'sh — null qaytarildi.");
      return null;
    }

    // Jonli sinovda model polygon'ni ba'zan birinchi uchni TAKRORLAB «yopadi»
    // (5 tomon → 6 uch). Oxirgi uch birinchisiga juda yaqin bo'lsa (ikkala o'q
    // bo'yicha ~0.02 epsilon ichida) — tashlab yuboramiz, aks holda chertyojda
    // ortiqcha «tomon» paydo bo'ladi. Модель иногда замыкает полигон, повторяя
    // первую вершину — убираем дубликат.
    const EPS = 0.02;
    const vertices = [...parsed.vertices];
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (Math.abs(last.x - first.x) <= EPS && Math.abs(last.y - first.y) <= EPS) {
      vertices.pop();
    }
    // Dedup'dan keyin ham haqiqiy polygon qolishi shart (kamida 3 uch).
    if (vertices.length < 3) {
      console.warn("[ai-shape] dedup'dan keyin polygon juda kichik — null qaytarildi.");
      return null;
    }

    // sideCount'ni uchlar sonidan hosil qilamiz (AI qaytargan raqamga ishonmasdan) —
    // determinik va polygon bilan izchil.
    return { sideCount: sideCount(vertices), vertices };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ai-shape] API/parse xatosi — null qaytarildi: ${msg}`);
    return null;
  }
}
