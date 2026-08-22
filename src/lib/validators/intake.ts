// Приёмка партии — чистая валидация формы (TZ §5.1, §6.3; ADR-002, ADR-004).
// Без БД и внешних зависимостей: принимает «сырые» строки формы,
// возвращает типизированный результат { ok, ... } с русскими сообщениями.

import { normalizeBlockLetter } from "@/lib/block-letter";
import { MAX_DECIMAL_12_3, parseBoundedDecimal } from "@/lib/decimal";
import { parseMoneyField } from "@/lib/stone-edit";
import { parseThicknessCm } from "@/lib/dimensions";

export interface IntakeLocationInput {
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
  /**
   * ТЗ №18 §3 — «Что здесь»: индекс узора в patterns ("0", "1"…) или ""
   * (= «весь приход»). Отсутствие поля (старые вызовы) == "".
   */
  pattern?: string;
}

/** ТЗ №3 — узор-подгруппа: описание + толщина + плиты + м² (сырые строки). */
export interface IntakePatternInput {
  description: string;
  thicknessMm: string;
  /** ТЗ №12: габарит плиты узора, см (если размеры в партии разные). */
  lengthMm: string;
  widthMm: string;
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
  /**
   * W6-C / TZ §5.1 — опциональные «базовые свойства» нового вида.
   * Пусто → null (не блокируют приёмку). Не спрашиваем purchasePrice/texture
   * на складе (роль/скорость — §9).
   */
  newDescription: string;
  /** Базовая цена продажи за м² (сырая); пусто = не задана. Decimal(12,2). */
  newBasePrice: string;
  /** Число плит, сырая строка («40»); пусто = не указано */
  slabsTotal: string;
  /** Площадь м², сырая строка («220» или «12,5»); пусто = не указано */
  areaTotalM2: string;
  supplierNote: string;
  /** «ГГГГ-ММ-ДД»; пусто = сегодня */
  arrivedAt: string;
  /** ТЗ №12: габарит плиты партии, см (обязателен без узоров). */
  lengthMm: string;
  widthMm: string;
  thicknessMm: string;
  locations: IntakeLocationInput[];
  /** ТЗ №3 — «в партии несколько узоров/толщин». Снят → однородная партия. */
  patternsEnabled: boolean;
  patterns: IntakePatternInput[];
}

export interface ValidIntakeLocation {
  block: string;
  landmark: string;
  /**
   * ТЗ №18 §4.1 — обязательное, когда у партии задано число плит (или узоры).
   * null возможен ТОЛЬКО в «партии без плит» (задана одна площадь) — там
   * раскладка сверяется по м².
   */
  slabsHere: number | null;
  areaHereM2: number | null;
  /** ТЗ №18 §3 — индекс узора в data.patterns; null = «весь приход». */
  patternIdx: number | null;
}

/** Проверенная узор-подгруппа: плиты И м² обязательны (ТЗ №3, §6). */
export interface ValidIntakePattern {
  description: string;
  thicknessMm: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  slabs: number;
  areaM2: number;
}

export interface ValidIntake {
  stoneType:
    | { kind: "existing"; id: string }
    | {
        kind: "new";
        name: string;
        rockType: string;
        color: string | null;
        description: string | null;
        basePrice: number | null;
      };
  slabsTotal: number | null;
  areaTotalM2: number | null;
  /** ТЗ №12: см. */
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
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
/** Целые (штуки, см, количества) — столбцы Int4 (макс 2 147 483 647). */
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
    // basePrice: пусто OK; мусор/переполнение → ошибка поля (parseMoneyField /
    // MAX_DECIMAL_12_2 — тот же путь, что editStoneType на /kamen).
    const bp = parseMoneyField(input.newBasePrice ?? "");
    if (!bp.ok) {
      errors.newBasePrice = "Цена — число ≥ 0, например 95 или 95,50";
    }
    if (name && rockType && bp.ok) {
      stoneType = {
        kind: "new",
        name,
        rockType,
        color: color || null,
        description: (input.newDescription ?? "").trim() || null,
        basePrice: bp.value,
      };
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

  // ── ТЗ №12: габарит плиты (см) ──
  // Однородная партия → length/width обязательны на уровне партии.
  // С узорами → length/width обязательны в каждой подгруппе; партия thickness скрыта.
  let lengthMm: number | null = null;
  let widthMm: number | null = null;
  let thicknessMm: number | null = null;
  if (!input.patternsEnabled) {
    const rawLen = parsePositiveInt(input.lengthMm);
    if (rawLen === null || rawLen === undefined) {
      errors.lengthMm = "Длина плиты, см — целое положительное число";
      lengthMm = null;
    } else {
      lengthMm = rawLen;
    }
    const rawWid = parsePositiveInt(input.widthMm);
    if (rawWid === null || rawWid === undefined) {
      errors.widthMm = "Ширина плиты, см — целое положительное число";
      widthMm = null;
    } else {
      widthMm = rawWid;
    }
    if (input.thicknessMm.trim() === "") {
      thicknessMm = null;
    } else {
      // ТЗ №12 + решение владельца 2026-08-10: толщина ДРОБНАЯ (18 мм = 1,8 см).
      const rawTh = parseThicknessCm(input.thicknessMm);
      if (rawTh === undefined) {
        errors.thicknessMm = "Толщина, см — положительное число, например 2 или 1,8";
        thicknessMm = null;
      } else {
        thicknessMm = rawTh;
      }
    }
  } else {
    // thickness on batch optional when patterns; length/width come from patterns
    thicknessMm = null;
    lengthMm = null;
    widthMm = null;
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

  // ── Узоры в партии (подгруппы) — опционально (ТЗ №3) ──
  // ТЗ №18: локации валидируются ПОСЛЕ узоров — строке локации нужен список
  // проверенных узоров («Что здесь» + расчёт м² + сверка раскладки).
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
        p.thicknessMm.trim() === "" ? null : parseThicknessCm(p.thicknessMm);
      if (thickness === undefined) {
        errors[`pattern-${i}-thickness`] =
          "Толщина, см — положительное число, например 2 или 1,8";
      }
      const pLen = parsePositiveInt(p.lengthMm ?? "");
      if (pLen === null || pLen === undefined) {
        errors[`pattern-${i}-length`] = "Длина, см — целое положительное число";
      }
      const pWid = parsePositiveInt(p.widthMm ?? "");
      if (pWid === null || pWid === undefined) {
        errors[`pattern-${i}-width`] = "Ширина, см — целое положительное число";
      }
      if (
        description &&
        typeof slabs === "number" &&
        typeof area === "number" &&
        thickness !== undefined &&
        typeof pLen === "number" &&
        typeof pWid === "number"
      ) {
        sumSlabs += slabs;
        sumArea += area;
        patterns.push({
          description,
          thicknessMm: thickness,
          lengthMm: pLen,
          widthMm: pWid,
          slabs,
          areaM2: area,
        });
      }
    });
    // Сходимость сусм — только когда ВСЕ строки валидны и тоталы заданы
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

  // ── Локации: минимум одна; блок + ориентир + «плит здесь» (TZ §5.1; ТЗ №18) ──
  // ТЗ №18 §4: «плит здесь» обязательно; раскладка должна сойтись с итогами;
  // §3 — «Что здесь» (узор) в строке; §5 — м² считается, где размеры известны.
  const locations: ValidIntakeLocation[] = [];
  if (input.locations.length === 0) {
    errors.locations = "Добавьте хотя бы одну локацию (блок + ориентир)";
  }
  // Все ли узор-строки прошли (только тогда пересчитываем м² и сверяем суммы).
  const patternsAllValid =
    !input.patternsEnabled ||
    (input.patterns.length > 0 && patterns.length === input.patterns.length);
  let allRowsValid = input.locations.length > 0;
  input.locations.forEach((loc, i) => {
    // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр буквы блока (кир/лат дубли).
    const block = normalizeBlockLetter(loc.block);
    const landmark = loc.landmark.trim();
    if (!block) errors[`loc-${i}-block`] = "Укажите блок (например «А»)";
    if (!landmark) errors[`loc-${i}-landmark`] = "Укажите ориентир (например «2» или «1–2»)";

    // ТЗ №18 §4.1 — обязательное: без количества строка локации бессмысленна.
    // Исключение — «партия без плит» (задана только площадь): там строка
    // сверяется по м², и требовать плиты не с чего.
    const slabsRequired = input.patternsEnabled || slabsTotal !== null;
    const slabsHere = parsePositiveInt(loc.slabsHere);
    if (slabsHere === null && slabsRequired) {
      errors[`loc-${i}-slabsHere`] = "Укажите, сколько плит лежит здесь";
    } else if (slabsHere === undefined) {
      errors[`loc-${i}-slabsHere`] = "Целое положительное число";
    }

    // ТЗ №18 §3 — «Что здесь»: "" = весь приход; иначе индекс узора.
    const rawPat = (loc.pattern ?? "").trim();
    let patternIdx: number | null = null;
    if (input.patternsEnabled && rawPat !== "") {
      const idx = /^\d+$/.test(rawPat) ? Number(rawPat) : NaN;
      if (!Number.isInteger(idx) || idx < 0 || idx >= input.patterns.length) {
        errors[`loc-${i}-pattern`] =
          "Выберите узор из списка (или «весь приход»)";
      } else {
        patternIdx = idx;
      }
    }

    // ТЗ №18 §5 — м² здесь: для строки с узором СЧИТАЕТСЯ из данных узора
    // (пропорционально его м², чтобы раскладка сходилась с ИТОГО копейка в
    // копейку — расчёт из габарита разошёлся бы с введённой площадью узора).
    // Для «весь приход» в партии с узорами — ручной ввод ОБЯЗАТЕЛЕН (без него
    // сверка м² невозможна). Без узоров — ручной ввод, как раньше (необязателен).
    let areaHereM2: number | null | undefined;
    if (
      input.patternsEnabled &&
      patternIdx !== null &&
      patternsAllValid &&
      typeof slabsHere === "number"
    ) {
      const p = patterns[patternIdx];
      areaHereM2 =
        Math.round(((p.areaM2 * slabsHere) / p.slabs) * 1000) / 1000;
    } else {
      areaHereM2 = parsePositiveDecimal(loc.areaHereM2);
      if (areaHereM2 === undefined) {
        errors[`loc-${i}-areaHereM2`] = "Положительное число, например 12,5";
      } else if (
        areaHereM2 === null &&
        input.patternsEnabled &&
        patternIdx === null &&
        rawPat === ""
      ) {
        errors[`loc-${i}-areaHereM2`] =
          "Для «весь приход» укажите м² здесь — без него итог не сверить";
        areaHereM2 = undefined;
      } else if (
        areaHereM2 === null &&
        !input.patternsEnabled &&
        slabsTotal === null
      ) {
        // «Партия без плит»: раскладка сверяется только по м² — поле нужно.
        errors[`loc-${i}-areaHereM2`] =
          "Укажите м² здесь — партия задана площадью";
        areaHereM2 = undefined;
      }
    }

    const slabsOk =
      typeof slabsHere === "number" || (slabsHere === null && !slabsRequired);
    if (
      block &&
      landmark &&
      slabsOk &&
      areaHereM2 !== undefined &&
      !errors[`loc-${i}-pattern`]
    ) {
      locations.push({
        block,
        landmark,
        slabsHere: slabsHere as number | null,
        areaHereM2,
        patternIdx,
      });
    } else {
      allRowsValid = false;
    }
  });

  // ТЗ №18 §4.2–4.3 — сверка раскладки (только когда все строки валидны:
  // сначала правим поля, потом пугаем «не сходится»).
  if (allRowsValid && locations.length === input.locations.length) {
    const sumSlabsLoc = locations.reduce((s, l) => s + (l.slabsHere ?? 0), 0);
    const sumAreaLoc = locations.reduce((s, l) => s + (l.areaHereM2 ?? 0), 0);

    if (input.patternsEnabled && patternsAllValid) {
      // §4.2 — по узору нельзя разложить больше, чем пришло.
      patterns.forEach((p, pi) => {
        const placed = locations
          .filter((l) => l.patternIdx === pi)
          .reduce((s, l) => s + (l.slabsHere ?? 0), 0);
        if (placed > p.slabs) {
          errors.locationsSum = `Узор «${p.description}»: разложено ${placed} плит, а в узоре только ${p.slabs}`;
        }
      });
      // §4.3 — раскладка должна сойтись с итогами (плиты И м²).
      if (
        !errors.locationsSum &&
        typeof slabsTotal === "number" &&
        typeof areaTotalM2 === "number"
      ) {
        if (sumSlabsLoc !== slabsTotal) {
          errors.locationsSum = `Разложено ${sumSlabsLoc} из ${slabsTotal} плит — приёмка не завершена, пока не разложено всё`;
        } else if (Math.abs(sumAreaLoc - areaTotalM2) > 0.01) {
          errors.locationsSum = `По локациям ${sumAreaLoc.toFixed(2)} м², а в партии ${areaTotalM2} м² — суммы должны сойтись`;
        }
      }
    } else if (!input.patternsEnabled) {
      // Без узоров: сверяем то, что задано на партии (минимум одно есть).
      if (typeof slabsTotal === "number" && sumSlabsLoc !== slabsTotal) {
        errors.locationsSum = `Разложено ${sumSlabsLoc} из ${slabsTotal} плит — приёмка не завершена, пока не разложено всё`;
      } else if (
        slabsTotal === null &&
        typeof areaTotalM2 === "number" &&
        Math.abs(sumAreaLoc - areaTotalM2) > 0.01
      ) {
        errors.locationsSum = `По локациям ${sumAreaLoc.toFixed(2)} м², а в партии ${areaTotalM2} м² — суммы должны сойтись`;
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
      lengthMm,
      widthMm,
      thicknessMm,
      supplierNote: input.supplierNote.trim() || null,
      arrivedAt,
      locations,
      patterns,
    },
  };
}
