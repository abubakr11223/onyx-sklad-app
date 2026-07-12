// SK-1 — Локация партии (BatchLocation) правка/перемещение: TZ §5.7
// «отметить/изменить локацию». Складчик меняет block/landmark (и note) у уже
// существующей локации — это записывается как аудит MOVE. Здесь — ЧИСТЫЕ (без DB,
// без next, без new Date()) хелперы: валидация ввода и сборка delta-payload'а
// для MOVE. UI ga bog'liq narsa yo'q — bu funksiyalar server action'dan ham,
// kelajakdagi Telegram botdan ham chaqirilishi mumkin va alohida unit-testlanadi.
//
// SK-1b (ОТЛОЖЕНО, НЕ здесь): добавление НОВОЙ локации, перенос количества между
// локациями, локация на уровне плиты. Этот модуль — только правка существующей.

// ──────────────────── Sof helperlar (DB YO'Q — unit-test) ────────────────────

/** Локация после нормализации: block/landmark непусты, note → строка или null. */
export interface NormalizedLocation {
  block: string;
  landmark: string;
  note: string | null;
}

export interface LocationEditInput {
  block: string;
  landmark: string;
  note?: string | null;
}

export type ValidateLocationResult =
  | { ok: true; data: NormalizedLocation }
  | { ok: false; error: string };

/**
 * Правка локации: block и landmark — обязательны (после trim непусты), note —
 * необязателен (пустой/пробельный → null). Сообщения — русские (язык UI),
 * согласованы с остальными валидаторами. Сама строка НЕ мутируется — возвращаем
 * тримленные значения в data.
 */
export function validateLocationEdit(
  input: LocationEditInput,
): ValidateLocationResult {
  const block = input.block.trim();
  if (!block) return { ok: false, error: "Укажите блок" };

  const landmark = input.landmark.trim();
  if (!landmark) return { ok: false, error: "Укажите ориентир" };

  const note = input.note?.trim() || null;

  return { ok: true, data: { block, landmark, note } };
}

/**
 * Delta-payload для аудита MOVE: сравниваем before/after и складываем в
 * self-описывающую структуру `{ from: {...}, to: {...} }`, где показаны ТОЛЬКО
 * изменённые поля (block/landmark/note). Если ничего не поменялось — обе стороны
 * пустые ({}), что тоже честно фиксирует «MOVE без фактических изменений».
 * Чистая функция: никакого DB/времени внутри.
 */
export function buildMovePayload(
  before: NormalizedLocation,
  after: NormalizedLocation,
): Record<string, unknown> {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};

  (["block", "landmark", "note"] as const).forEach((field) => {
    if (before[field] !== after[field]) {
      from[field] = before[field];
      to[field] = after[field];
    }
  });

  return { from, to };
}

/**
 * MOVE-payload'да реальных изменений НЕТ? (пустая дельта `{from:{},to:{}}`).
 * Server action использует это, чтобы не писать бессмысленный аудит MOVE и не
 * трогать строку, когда «Сохранить» нажали без правок. Читаемо и тестируемо.
 */
export function isNoopMove(payload: Record<string, unknown>): boolean {
  const from = payload.from;
  return (
    from == null ||
    typeof from !== "object" ||
    Object.keys(from as Record<string, unknown>).length === 0
  );
}
