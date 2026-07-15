// §5.5a — AI-chertyoj (broken-stone shape) SVG renderer / отрисовщик чертежа.
// TZ §5.5: singan toshni suratga olamiz → AI shaklni chizadi → skladchi har
// tomon uzunligini o'lchab kiritadi. Bu MODUL — SOF (без DB, без next, без
// @anthropic-ai/sdk, без new Date()): polygon validatsiyasi + SVG string qurish.
// Chizilgan SVG keyinchalik Piece.drawingUrl'ga (data-URI yoki inline) saqlanadi.
//
// Bu fayl AI'ga bog'liq EMAS — ai-shape.ts shu yerdan import qiladi (teskarisi emas),
// shu tufayli chertyoj mustaqil unit-testlanadi. Barcha funksiyalar deterministik.

// ──────────────────── Tiplar / Типы ────────────────────

/**
 * Polygon uchi: normalizatsiya qilingan [0..1] koordinatalar (origin — yuqori-chap).
 * Вершина полигона в нормализованных координатах [0..1] (начало — верх-лево).
 */
export interface Vertex {
  x: number;
  y: number;
}

/** SVG chizish opsiyalari / опции отрисовки SVG. */
export interface ChertyojOptions {
  /** Har tomon uchun yozuv (masalan o'lchangan uzunlik "1180"). Йо'q bo'lsa — raqam. */
  sideLabels?: string[];
  /** Piksel eni (default 320) / ширина в пикселях. */
  width?: number;
  /** Piksel bo'yi (default 320) / высота в пикселях. */
  height?: number;
}

// ──────────────────── Validatsiya / Валидация ────────────────────

/**
 * Berilgan qiymat haqiqiy polygon (>= 3 uchi, har biri chekli sonli x,y ∈ [0,1])
 * ekanini tekshiradi. Type-guard: true bo'lsa `Vertex[]` deb tanadi.
 * Проверяет, что значение — массив из >= 3 точек с конечными числовыми x,y в [0,1].
 */
export function validatePolygon(vertices: unknown): vertices is Vertex[] {
  if (!Array.isArray(vertices)) return false;
  if (vertices.length < 3) return false;
  return vertices.every((v) => {
    if (v == null || typeof v !== "object") return false;
    const { x, y } = v as Record<string, unknown>;
    return (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      x <= 1 &&
      y >= 0 &&
      y <= 1
    );
  });
}

/**
 * Yopiq polygon tomonlari soni = uchlari soni. Число сторон замкнутого полигона
 * равно числу вершин.
 */
export function sideCount(vertices: Vertex[]): number {
  return vertices.length;
}

// ──────────────────── SVG qurish / Построение SVG ────────────────────

/** Determinik son formati: butunlar toza, kasrlar 2 xonagacha. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * XML/SVG uchun ekranlash: & < > " ' (ampersand BIRINCHI, aks holda qolgan
 * entity'lar ikki marta ekranlanadi). sideLabels §5.5b'da FOYDALANUVCHI kiritgan
 * o'lchov satrlaridan keladi va SVG Piece.drawingUrl'ga saqlanadi — ekranlamasa
 * bu stored-XSS manbai bo'lardi. Экранирование пользовательских подписей перед
 * вставкой в SVG (защита от stored-XSS). Sof, deterministik.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Polygonni piksel qutisiga masshtablab, yopiq ko'pburchak sifatida chizadi.
 * Har TOMON o'rta nuqtasiga raqam (1,2,3…) yoki `sideLabels` yozuvi qo'yiladi.
 * Отрисовывает полигон в SVG: замкнутый контур в пиксельном боксе, номер (или
 * подпись) каждой стороны в её середине. Чистое построение строки — без DOM.
 *
 * SVG o'zi-yetarli (inline, tashqi havolasiz) — Piece.drawingUrl'ga saqlash uchun.
 */
export function renderChertyoj(vertices: Vertex[], opts: ChertyojOptions = {}): string {
  const width = opts.width ?? 320;
  const height = opts.height ?? 320;
  const padding = 24;

  // [0,1] → piksel: chizma maydoni padding bilan kichraytiriladi. width/height
  // 2×padding'dan kichik bo'lsa ham maydon manfiy bo'lmasin (clamp).
  const innerW = Math.max(1, width - 2 * padding);
  const innerH = Math.max(1, height - 2 * padding);
  const sx = (x: number) => padding + x * innerW;
  const sy = (y: number) => padding + y * innerH;

  const pts = vertices.map((v) => ({ x: sx(v.x), y: sy(v.y) }));

  const pointsAttr = pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

  // Uchlarga kichik belgilar / маркеры вершин.
  const dots = pts
    .map((p) => `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="3" fill="#1d4ed8"/>`)
    .join("");

  // Har tomonning o'rta nuqtasidagi raqam yoki yozuv.
  const labels = pts
    .map((p, i) => {
      const next = pts[(i + 1) % pts.length];
      const mx = (p.x + next.x) / 2;
      const my = (p.y + next.y) / 2;
      // Yozuv HAR DOIM ekranlanadi — sideLabels tashqi (foydalanuvchi) kirishi.
      const text = escapeXml(opts.sideLabels?.[i] ?? String(i + 1));
      return (
        `<text x="${fmt(mx)}" y="${fmt(my)}" text-anchor="middle" ` +
        `dominant-baseline="middle" font-family="sans-serif" font-size="13" ` +
        `fill="#111827">${text}</text>`
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<polygon points="${pointsAttr}" fill="rgba(37,99,235,0.08)" ` +
    `stroke="#1d4ed8" stroke-width="2" stroke-linejoin="round"/>` +
    dots +
    labels +
    `</svg>`
  );
}
