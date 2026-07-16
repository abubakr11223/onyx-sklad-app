// §5.5b — singan tosh DRAFT kodeki (stateless havola uchun). TZ §5.5: bot AI
// natijasini (polygon + Telegram file_id) URL'ga kodlab beradi, skladchi
// /singan sahifasida o'lchovlarni kiritadi. DB migratsiyasiz — butun draft
// URL'ning `d` parametrida yashaydi.
//
// Bu modul SOF (locations.ts uslubi): DB YO'Q, next YO'Q, SDK YO'Q — alohida
// unit-testlanadi (src/tests/singan.test.ts). Модуль чистый: только кодирование
// и СТРОГАЯ валидация — данные `d` приходят из URL и полностью подконтрольны
// пользователю, поэтому decode обязан быть параноидальным и никогда не бросать.

import { validatePolygon, type Vertex } from "@/lib/chertyoj";

// ──────────────────── Tiplar / Типы ────────────────────

/** AI-shakl chizmasi + asl rasm file_id — havola orqali tashiladigan draft. */
export interface ShapeDraft {
  vertices: Vertex[];
  fileId: string;
}

// ──────────────────── Chegaralar / Ограничения ────────────────────

/** URL parametri uchun maksimal uzunlik — DoS/urchgan URL'lardan himoya. */
const MAX_RAW_LENGTH = 2000;

/** Polygon uchlari soni chegarasi (AI 4–12 qaytaradi; 20 — zaxira bilan). */
const MAX_VERTICES = 20;

/**
 * Telegram file_id alifbosi: [A-Za-z0-9_-]. Boshqa belgi — soxta kirish
 * (file_id keyin Bot API'ga uzatiladi, shuning uchun qat'iy allowlist).
 */
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

// ──────────────────── Kodek / Кодек ────────────────────

/** Draft → base64url satr (URL-safe, encodeURIComponent talab qilmaydi). */
export function encodeShapeDraft(draft: ShapeDraft): string {
  return Buffer.from(JSON.stringify(draft), "utf8").toString("base64url");
}

/**
 * URL'dan kelgan xom qiymatni QATTIQ tekshirib draft'ga aylantiradi.
 * Har qanday og'ish → null; HECH QACHON throw qilmaydi (webhook/never-throw
 * kontraktiga hamohang). Tekshiruvlar:
 *  - satr, bo'sh emas, <= MAX_RAW_LENGTH;
 *  - base64url → JSON.parse (ikkalasi ham try/catch ichida);
 *  - vertices — validatePolygon (>=3 uch, x,y ∈ [0,1]) va <= MAX_VERTICES;
 *  - fileId — bo'sh bo'lmagan, xavfsiz alifboli, <= 200 belgi.
 */
export function decodeShapeDraft(raw: unknown): ShapeDraft | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_LENGTH) {
    return null;
  }

  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const { vertices, fileId } = parsed as Record<string, unknown>;

  if (!validatePolygon(vertices)) return null;
  if (vertices.length > MAX_VERTICES) return null;
  if (typeof fileId !== "string" || !FILE_ID_RE.test(fileId)) return null;

  // Faqat kutilgan maydonlarni qaytaramiz — begona kalitlar tashlab yuboriladi.
  return {
    vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
    fileId,
  };
}
