// ТЗ №17 §6 — локация выбирается ИЗ СПРАВОЧНИКА, а не набирается текстом.
//
// Проблема, которую это закрывает: пока приёмка принимала свободный ввод, из
// опечаток рос второй справочник — «б2», «B2», «Б2», «блок б» становились
// четырьмя разными блоками, и камень «терялся» между ними. Выпадающий список в
// форме — половина решения; вторая половина здесь: сервер обязан отказать в
// локации, которой нет в сетке. Клиентский select обходится прямым POST'ом, а
// значит без серверной проверки дыра остаётся открытой.
//
// Создавать новый блок может только владелец / зав. склада — из раздела
// «Карта склада». Складчик выбирает из готового.

import { db } from "@/lib/db";
import { normalizeBlockLetter } from "@/lib/block-letter";

export interface GridLocationRef {
  block: string;
  landmark: string;
}

export interface UnknownLocation {
  /** Индекс локации в форме — для адресации ошибки в конкретную строку. */
  index: number;
  /** Что именно не найдено: сам блок или ориентир внутри него. */
  reason: "block" | "landmark";
  block: string;
  landmark: string;
}

/**
 * Проверяет, что каждая пара (блок, ориентир) есть в сетке склада.
 * Возвращает список НЕизвестных локаций (пустой = всё в порядке).
 *
 * Один запрос на все блоки формы: локаций в приёмке обычно 1–3, но N+1 здесь
 * всё равно ни к чему.
 */
export async function findUnknownLocations(
  locations: GridLocationRef[],
): Promise<UnknownLocation[]> {
  if (locations.length === 0) return [];

  const codes = [
    ...new Set(locations.map((l) => normalizeBlockLetter(l.block)).filter(Boolean)),
  ];
  const rows = await db.warehouseBlock.findMany({
    where: { letter: { in: codes } },
    select: { letter: true, landmarks: { select: { number: true } } },
  });

  const grid = new Map<string, Set<string>>();
  for (const row of rows) {
    grid.set(row.letter, new Set(row.landmarks.map((l) => l.number.trim())));
  }

  const unknown: UnknownLocation[] = [];
  locations.forEach((loc, index) => {
    const block = normalizeBlockLetter(loc.block);
    const landmark = loc.landmark.trim();
    const landmarks = grid.get(block);
    if (!landmarks) {
      unknown.push({ index, reason: "block", block, landmark });
      return;
    }
    // ТЗ №18 §2 — пустой ориентир законен: адрес до уровня блока. Сверять с
    // справочником нечего, блок уже найден выше.
    if (landmark !== "" && !landmarks.has(landmark)) {
      unknown.push({ index, reason: "landmark", block, landmark });
    }
  });
  return unknown;
}

/**
 * Те же проверки, но сразу в формате ошибок формы: ключ «loc-{i}-block» /
 * «loc-{i}-landmark» — совпадает с ключами validateIntake, поэтому сообщение
 * встаёт под нужным полем без дополнительной раскладки.
 */
export async function validateLocationsAgainstGrid(
  locations: GridLocationRef[],
): Promise<Record<string, string>> {
  const unknown = await findUnknownLocations(locations);
  const errors: Record<string, string> = {};
  for (const u of unknown) {
    if (u.reason === "block") {
      errors[`loc-${u.index}-block`] =
        `Блока «${u.block}» нет в карте склада. Выберите из списка — новый блок заводит владелец или зав. складом.`;
    } else {
      errors[`loc-${u.index}-landmark`] =
        `В блоке «${u.block}» нет ориентира «${u.landmark}». Выберите из списка.`;
    }
  }
  return errors;
}

/**
 * Сетка для формы: коды блоков + их ориентиры. Порядок — как на экране карты
 * (sortOrder), ориентиры — по числовому значению, чтобы «10» не оказался между
 * «1» и «2» (строковая сортировка именно так и делает).
 */
export async function loadWarehouseGrid(): Promise<
  { letter: string; landmarks: string[] }[]
> {
  const rows = await db.warehouseBlock.findMany({
    select: { letter: true, landmarks: { select: { number: true } } },
  });
  return sortBlockOptions(
    rows.map((r) => ({
      letter: r.letter,
      landmarks: sortLandmarks(r.landmarks.map((l) => l.number)),
    })),
  );
}

// ──────────────── ТЗ №18 §6 — порядок блоков по коду ─────────────────
//
// Было: порядок создания (sortOrder). На экране это выглядело как
// «A, B, C, D1, G1, H1, F1, S1, K1, A1, A2…» — ряды одного блока
// разбросаны по списку, F стоит после H. Складчик искал нужный код
// глазами вместо того, чтобы взять его сразу.
//
// Сортировка ЕСТЕСТВЕННАЯ, а не посимвольная: обычное строковое
// сравнение даёт «A1, A10, A11, A2» — цифры сравниваются как текст.
// Разбираем код на буквенную и числовую часть и сравниваем число как
// число. Сейчас все номера однозначные и разницы не видно, но как
// только у ряда появится позиция за десяток, порядок поедет.
//
// Ручной сортировки не предусмотрено: порядок один и тот же на карте
// склада и во всех выпадающих списках (приёмка, правка партии, разбить).

const blockCollator = new Intl.Collator("ru-RU", { sensitivity: "base" });

/** «A12» → [«A», 12]; «A» → [«A», -1] (голая буква идёт перед «A1»). */
function splitBlockCode(code: string): [string, number] {
  const m = code.trim().match(/^(\D*)(\d*)/);
  const letters = (m?.[1] ?? code).trim();
  const digits = m?.[2] ?? "";
  return [letters, digits === "" ? -1 : Number(digits)];
}

/** Сравнение кодов блоков: сначала буква, потом номер КАК ЧИСЛО. */
export function compareBlockCodes(a: string, b: string): number {
  const [la, na] = splitBlockCode(a);
  const [lb, nb] = splitBlockCode(b);
  return blockCollator.compare(la, lb) || na - nb || blockCollator.compare(a, b);
}

/** Тот же порядок для списка блоков формы (letter + ориентиры). */
export function sortBlockOptions<T extends { letter: string }>(
  blocks: T[],
): T[] {
  return [...blocks].sort((a, b) => compareBlockCodes(a.letter, b.letter));
}

/**
 * Ориентиры — строки («1», «10», «1–2»), но читаются как номера. Сортируем по
 * первому числу в строке, остальное — по алфавиту. Чистая функция (unit-тест).
 */
export function sortLandmarks(numbers: string[]): string[] {
  const num = (s: string): number => {
    const m = s.match(/\d+/);
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
  };
  return [...numbers].sort((a, b) => num(a) - num(b) || a.localeCompare(b, "ru"));
}
