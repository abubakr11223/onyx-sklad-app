// Приёмка партии — чистая валидация формы (TZ §5.1, §6.3; ADR-002, ADR-004).
// Без БД и внешних зависимостей: принимает «сырые» строки формы,
// возвращает типизированный результат { ok, ... } с русскими сообщениями.

export interface IntakeLocationInput {
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
}

export interface IntakeInput {
  /** id существующего вида; игнорируется при newStoneType = true */
  stoneTypeId: string;
  /** Переключатель «Новый вид» (TZ §5.1 — вид заводится на месте) */
  newStoneType: boolean;
  newName: string;
  newRockType: string;
  newColor: string;
  /** Число плит, сырая строка («40»); пусто = не указано */
  slabsTotal: string;
  /** Площадь м², сырая строка («220» или «12,5»); пусто = не указано */
  areaTotalM2: string;
  supplierNote: string;
  /** «ГГГГ-ММ-ДД»; пусто = сегодня */
  arrivedAt: string;
  locations: IntakeLocationInput[];
}

export interface ValidIntakeLocation {
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
}

export interface ValidIntake {
  stoneType:
    | { kind: "existing"; id: string }
    | { kind: "new"; name: string; rockType: string; color: string | null };
  slabsTotal: number | null;
  areaTotalM2: number | null;
  supplierNote: string | null;
  arrivedAt: Date;
  locations: ValidIntakeLocation[];
}

/** Ключ — имя поля («slabsTotal», «loc-0-block»…), значение — русское сообщение. */
export type IntakeErrors = Record<string, string>;

export type IntakeResult =
  | { ok: true; data: ValidIntake }
  | { ok: false; errors: IntakeErrors };

/**
 * «12,5» → 12.5. Возвращает:
 *  - null — поле пустое (не заполнено);
 *  - undefined — не число, ноль или отрицательное;
 *  - number — корректное положительное число.
 */
export function parsePositiveDecimal(raw: string): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** То же для целых («40»). Дробное, ноль, отрицательное → undefined. */
export function parsePositiveInt(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateIntake(input: IntakeInput): IntakeResult {
  const errors: IntakeErrors = {};

  // ── Вид камня: существующий ИЛИ новый (TZ §5.1) ──
  let stoneType: ValidIntake["stoneType"] | null = null;
  if (input.newStoneType) {
    const name = input.newName.trim();
    const rockType = input.newRockType.trim();
    const color = input.newColor.trim();
    if (!name) errors.newName = "Укажите название нового вида";
    if (!rockType) errors.newRockType = "Укажите породу (мрамор, гранит…)";
    if (name && rockType) {
      stoneType = { kind: "new", name, rockType, color: color || null };
    }
  } else {
    const id = input.stoneTypeId.trim();
    if (!id) errors.stoneTypeId = "Выберите вид камня из списка";
    else stoneType = { kind: "existing", id };
  }

  // ── Количество: плиты и/или площадь — минимум одно (ADR-002, CHECK в БД) ──
  const slabsTotal = parsePositiveInt(input.slabsTotal);
  const areaTotalM2 = parsePositiveDecimal(input.areaTotalM2);
  if (slabsTotal === undefined) {
    errors.slabsTotal = "Число плит — целое положительное число";
  }
  if (areaTotalM2 === undefined) {
    errors.areaTotalM2 = "Площадь — положительное число, например 12,5";
  }
  if (slabsTotal === null && areaTotalM2 === null) {
    errors.quantity = "Укажите число плит и/или площадь (м²) — минимум одно";
  }

  // ── Дата прихода: пусто = сегодня ──
  let arrivedAt: Date;
  const rawDate = input.arrivedAt.trim();
  if (rawDate === "") {
    arrivedAt = new Date();
  } else if (!DATE_RE.test(rawDate) || Number.isNaN(new Date(`${rawDate}T00:00:00`).getTime())) {
    errors.arrivedAt = "Неверная дата (нужен формат ГГГГ-ММ-ДД)";
    arrivedAt = new Date();
  } else {
    arrivedAt = new Date(`${rawDate}T00:00:00`);
  }

  // ── Локации: минимум одна, у каждой блок + ориентир (TZ §5.1, §4.5) ──
  const locations: ValidIntakeLocation[] = [];
  if (input.locations.length === 0) {
    errors.locations = "Добавьте хотя бы одну локацию (блок + ориентир)";
  }
  input.locations.forEach((loc, i) => {
    const block = loc.block.trim();
    const landmark = loc.landmark.trim();
    if (!block) errors[`loc-${i}-block`] = "Укажите блок (например «А»)";
    if (!landmark) errors[`loc-${i}-landmark`] = "Укажите ориентир (например «2» или «1–2»)";
    const slabsHere = parsePositiveInt(loc.slabsHere);
    if (slabsHere === undefined) {
      errors[`loc-${i}-slabsHere`] = "Целое положительное число";
    }
    const areaHereM2 = parsePositiveDecimal(loc.areaHereM2);
    if (areaHereM2 === undefined) {
      errors[`loc-${i}-areaHereM2`] = "Положительное число, например 12,5";
    }
    if (block && landmark && slabsHere !== undefined && areaHereM2 !== undefined) {
      locations.push({ block, landmark, slabsHere, areaHereM2 });
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      stoneType: stoneType as ValidIntake["stoneType"],
      slabsTotal: slabsTotal as number | null,
      areaTotalM2: areaTotalM2 as number | null,
      supplierNote: input.supplierNote.trim() || null,
      arrivedAt,
      locations,
    },
  };
}
