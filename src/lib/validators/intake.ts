// Приёмка партии — чистая валидация формы (TZ §5.1, §6.3; ADR-002, ADR-004).
// Без БД и внешних зависимостей: принимает «сырые» строки формы,
// возвращает типизированный результат { ok, ... } с русскими сообщениями.

import { normalizeBlockLetter } from "@/lib/block-letter";
import { MAX_DECIMAL_12_3, parseBoundedDecimal } from "@/lib/decimal";

export interface IntakeLocationInput {
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
}

/** ТЗ №3 — узор-подгруппа: описание + толщина + плиты + м² (сырые строки). */
export interface IntakePatternInput {
  description: string;
  thicknessMm: string;
  slabs: string;
  areaM2: string;
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
  /** ТЗ №3 — «в партии несколько узоров/толщин». Снят → однородная партия. */
  patternsEnabled: boolean;
  patterns: IntakePatternInput[];
}

export interface ValidIntakeLocation {
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
}

/** Проверенная узор-подгруппа: плиты И м² обязательны (ТЗ №3, §6). */
export interface ValidIntakePattern {
  description: string;
  thicknessMm: number | null;
  slabs: number;
  areaM2: number;
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
  /** Узоры партии (пусто, если однородная / галочка снята). */
  patterns: ValidIntakePattern[];
}

/** Ключ — имя поля («slabsTotal», «loc-0-block»…), значение — русское сообщение. */
export type IntakeErrors = Record<string, string>;

export type IntakeResult =
  | { ok: true; data: ValidIntake }
  | { ok: false; errors: IntakeErrors };

// A1: верхние пределы под типы столбцов Postgres. Значения выше — не 500 из-за
// переполнения Int4 / Decimal(12,3), а обычная ошибка валидации (undefined →
// «Слишком большое значение» в вызывающем слое). Общая точка для приёмки,
// продажи, брони, разбить и singan (все идут через эти парсеры).
/** Целые (штуки, мм, количества) — столбцы Int4 (макс 2 147 483 647). */
export const MAX_INT_FIELD = 1_000_000;
/** Площадь и объёмы — Decimal(12,3) (макс 999 999 999.999). Оставлен для
 *  обратной совместимости — новый код берёт MAX_DECIMAL_12_3 из lib/decimal.ts. */
export const MAX_DECIMAL_FIELD = MAX_DECIMAL_12_3;

/**
 * «12,5» → 12.5. Возвращает:
 *  - null — поле пустое (не заполнено);
 *  - undefined — не число, ноль, отрицательное ИЛИ больше MAX_DECIMAL_FIELD;
 *  - number — корректное положительное число в пределах Decimal(12,3).
 *
 * Аудит ТЗ №7 #7 — реализация делегирована parseBoundedDecimal, но контракт
 * (null | undefined | number, strogo pozitiv) СОХРАНЁН, чтобы существующие
 * вызывающие сайты (validators/intake.ts, breaking.ts, locations.ts) не менялись.
 */
export function parsePositiveDecimal(raw: string): number | null | undefined {
  const res = parseBoundedDecimal(raw, {
    max: MAX_DECIMAL_12_3,
    allowZero: false,
  });
  if (!res.ok) return undefined;
  return res.value;
}

/**
 * То же для целых («40»). Дробное, ноль, отрицательное ИЛИ больше
 * MAX_INT_FIELD → undefined (защита от переполнения Int4, A1).
 */
export function parsePositiveInt(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_INT_FIELD) return undefined;
  return n;
}

/**
 * Поле «количество» именно для ПРИЁМКИ (slabsTotal, areaTotalM2): ноль
 * трактуется КАК ПУСТО («не заполнено») — TZ §5.1, правило «минимум одно из
 * двух». Партия принимается, если задано хотя бы одно реальное положительное
 * значение (плиты ИЛИ м²); ноль в любом из полей не мешает.
 *
 * ВАЖНО: отдельный хелпер, а НЕ правка parsePositiveInt/parsePositiveDecimal —
 * те общие и используются в продаже/броне/разбить/singan/локациях, где 0 обязан
 * оставаться ошибкой. Здесь же 0 == пусто только для двух полей приёмки.
 *
 * Возвращает:
 *  - null      — пусто, пробелы ИЛИ ноль в любой записи («0», «00», «0,0», «0.0»);
 *  - undefined — отрицательное, не число, дробь в целом поле или переполнение;
 *  - number    — корректное положительное число (в пределах Int4 / Decimal(12,3)).
 */
export function parseQuantityField(
  raw: string,
  kind: "int" | "decimal",
): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  // Ноль в любой форме = не заполнено (0 ⇔ пусто).
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) === 0) return null;
  // Ненулевое значение — обычные правила (целое/дробь, знак, предел).
  return kind === "int" ? parsePositiveInt(raw) : parsePositiveDecimal(raw);
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
  // BUG-02: для приёмки 0 == пусто (parseQuantityField). Отрицательное/текст
  // по-прежнему ошибка поля; правило «минимум одно» срабатывает, когда ОБА
  // пусты-или-ноль.
  const slabsTotal = parseQuantityField(input.slabsTotal, "int");
  const areaTotalM2 = parseQuantityField(input.areaTotalM2, "decimal");
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
    // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр буквы блока (кир/лат дубли).
    const block = normalizeBlockLetter(loc.block);
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

  // ── Узоры в партии (подгруппы) — опционально (ТЗ №3) ──
  // Галочка снята → пропускаем (быстрый путь для однородной партии).
  const patterns: ValidIntakePattern[] = [];
  if (input.patternsEnabled) {
    if (input.patterns.length === 0) {
      errors.patterns = "Добавьте хотя бы один узор или снимите галочку";
    }
    // Суммы сходятся И по плитам, И по м² → нужны ОБА тотала партии.
    if (slabsTotal === null || areaTotalM2 === null) {
      errors.patternsTotals =
        "Для узоров укажите в «Количестве» и плиты, и площадь партии";
    }
    let sumSlabs = 0;
    let sumArea = 0;
    input.patterns.forEach((p, i) => {
      const description = p.description.trim();
      if (!description) errors[`pattern-${i}-description`] = "Опишите узор";
      const slabs = parsePositiveInt(p.slabs);
      if (typeof slabs !== "number") {
        errors[`pattern-${i}-slabs`] = "Плиты — целое положительное число";
      }
      const area = parsePositiveDecimal(p.areaM2);
      if (typeof area !== "number") {
        errors[`pattern-${i}-area`] = "Площадь — положительное число, например 12,5";
      }
      const thickness =
        p.thicknessMm.trim() === "" ? null : parsePositiveInt(p.thicknessMm);
      if (thickness === undefined) {
        errors[`pattern-${i}-thickness`] = "Толщина — целое число (мм)";
      }
      if (
        description &&
        typeof slabs === "number" &&
        typeof area === "number" &&
        thickness !== undefined
      ) {
        sumSlabs += slabs;
        sumArea += area;
        patterns.push({ description, thicknessMm: thickness, slabs, areaM2: area });
      }
    });
    // Сходимость сумм — только когда ВСЕ строки валидны и тоталы заданы
    // (иначе сначала правим поля, а не пугаем «не сходится»).
    const allValid =
      input.patterns.length > 0 && patterns.length === input.patterns.length;
    if (allValid && typeof slabsTotal === "number" && typeof areaTotalM2 === "number") {
      if (sumSlabs !== slabsTotal) {
        errors.patternsSum = `Сумма плит по узорам (${sumSlabs}) не сходится с количеством партии (${slabsTotal})`;
      } else if (Math.abs(sumArea - areaTotalM2) > 0.001) {
        errors.patternsSum = `Сумма м² по узорам (${sumArea.toFixed(1)}) не сходится с площадью партии (${areaTotalM2})`;
      }
    }
  }

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
      patterns,
    },
  };
}
