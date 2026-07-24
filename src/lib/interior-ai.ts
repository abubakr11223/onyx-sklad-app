// §6.7 «B» — AI-интерьеры камня. По ФОТО камня (image-to-image) генерируем
// его вид в интерьерах: ресепшен, ванная, гостиная. Модель — image-модель через
// Vercel AI Gateway (по умолчанию google/gemini-2.5-flash-image), вызывается
// generateText с картинкой-референсом + промптом, результат — result.files.
//
// Fail-closed (как ai-shape.ts): нет ключа/ошибка/пустой ответ → null или []
// (никогда не роняем вызывающий код). Стоит денег — генерим ТОЛЬКО по явному
// действию владельца/менеджера, не автоматически.
import { generateText } from "ai";

/** Модель можно переопределить env'ом; дефолт — Gemini image (image-to-image). */
const MODEL = process.env.INTERIOR_AI_MODEL || "google/gemini-2.5-flash-image";

/** Сцены интерьера (ТЗ §6.7): подпись → часть промпта. */
export const INTERIOR_SCENES: Array<{ key: string; label: string; ru: string }> = [
  { key: "reception", label: "Ресепшен", ru: "стойка ресепшена в лобби" },
  { key: "bathroom", label: "Ванная", ru: "современная ванная комната" },
  { key: "living", label: "Гостиная", ru: "гостиная премиум-класса" },
];

export interface GeneratedInterior {
  scene: string; // ключ сцены
  label: string; // RU-подпись
  bytes: Uint8Array;
  mediaType: string;
}

export interface RefImage {
  bytes: Uint8Array;
  mediaType: string;
}

function scenePrompt(sceneRu: string, stoneDesc: string): string {
  return [
    `Фотореалистичный интерьер: ${sceneRu}.`,
    `Используй камень с прикреплённого фото (${stoneDesc}) как основной`,
    `отделочный материал — стены, пол или столешница, крупным планом,`,
    `с сохранением реальной текстуры и цвета камня.`,
    `Тёплый дневной свет, премиум-дизайн, без людей, без текста и логотипов.`,
  ].join(" ");
}

/**
 * Одна сцена: image-to-image по референс-фото камня. Возвращает картинку или
 * null (нет ключа / ошибка / модель не вернула изображение).
 */
type OneResult =
  | { ok: true; image: GeneratedInterior }
  | { ok: false; error: string };

async function generateOne(
  ref: RefImage,
  scene: { key: string; label: string; ru: string },
  stoneDesc: string,
): Promise<OneResult> {
  try {
    const result = await generateText({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: scenePrompt(scene.ru, stoneDesc) },
            { type: "image", image: ref.bytes, mediaType: ref.mediaType },
          ],
        },
      ],
    });
    const img = result.files.find((f) => f.mediaType.startsWith("image/"));
    if (!img) {
      return {
        ok: false,
        error: `модель не вернула изображение (${MODEL})`,
      };
    }
    return {
      ok: true,
      image: {
        scene: scene.key,
        label: scene.label,
        bytes: img.uint8Array,
        mediaType: img.mediaType,
      },
    };
  } catch (err) {
    // Fail-closed: нет ключа AI Gateway / нет кредитов / сеть / отказ модели.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[interior-ai] сцена ${scene.key} — ошибка:`, err);
    return { ok: false, error: msg };
  }
}

/**
 * Генерирует интерьеры по фото камня для всех сцен. Пустой массив = ничего не
 * сгенерировалось (ключ не настроен или все вызовы упали) — вызывающий код сам
 * решит, что показать пользователю.
 */
export async function generateInteriors(
  ref: RefImage,
  stoneDesc: string,
): Promise<{ images: GeneratedInterior[]; error?: string }> {
  const results = await Promise.all(
    INTERIOR_SCENES.map((s) => generateOne(ref, s, stoneDesc)),
  );
  const images = results
    .filter((r): r is { ok: true; image: GeneratedInterior } => r.ok)
    .map((r) => r.image);
  // Первая ошибка (для диагностики: нет кредитов / ключа / модель недоступна).
  const firstErr = results.find(
    (r): r is { ok: false; error: string } => !r.ok,
  );
  return { images, error: firstErr?.error };
}
