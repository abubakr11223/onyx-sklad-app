// Структурный guard: доменный модуль не должен существовать «в вакууме».
//
// ПОВОД. `shipment-telegram-notify.ts` (438 строк) и `shipment-photo.ts`
// (295 строк) были написаны полностью, с тестами, и НЕ вызывались ниоткуда.
// ТЗ №15 §8.1–8.2 («фото при отгрузке» и «уведомление складчику», помеченные
// «рекомендую сразу») считались сделанными: код есть, тесты зелёные, сборка
// зелёная. Складчик при этом не получал ни одного сообщения.
//
// Это ровно тот класс отказа, который аудит проекта назвал своим главным:
// «код прошёл тесты и не работал на складе». Юнит-тест модуля проверяет, что
// функция правильна, — но не то, что её кто-то зовёт. Здесь проверяем второе.
//
// Правило: у каждого модуля из списка есть хотя бы один импорт вне src/tests
// и вне самого себя. Список — те модули, чья «неподключённость» тиха и дорога.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Модули, которые обязаны быть подключены к продуктовому коду.
 * Добавляя сюда новый — добавляйте и причину, почему его молчание дорого.
 */
const MUST_BE_WIRED = [
  // ТЗ №15 §8.2 — складчик узнаёт о задаче на отгрузку.
  "shipment-telegram-notify",
  // …и сама обёртка тоже должна быть позвана: иначе цепочка «подключена»
  // формально (hook → notify), но ни одно действие её не вызывает.
  "shipment-notify-hook",
  // ТЗ №15 §3.3/§8.1 — фото факта выдачи (сверка при спорах с клиентом).
  "shipment-photo",
  // ТЗ №15 §5 — раздел «Шоу-рум».
  "showroom",
  // ТЗ №15 §3 — очередь и архив отгрузок.
  "shipments",
  // ТЗ №10 — образцы.
  "samples",
  // ТЗ №9 — долги.
  "debts",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Файлы продуктового кода: всё в src, кроме тестов и самого модуля. */
function productionFiles(selfBasename: string): string[] {
  return walk(SRC).filter((p) => {
    if (p.includes(`${join("src", "tests")}`)) return false;
    if (p.endsWith(join("lib", `${selfBasename}.ts`))) return false;
    return true;
  });
}

/** Есть ли хоть один импорт `@/lib/<name>` (или относительный) вне тестов. */
export function hasProductionImporter(name: string): boolean {
  const needle = new RegExp(
    `from\\s+["'](?:@/lib/${name}|\\.{1,2}(?:/[\\w.-]+)*/${name})["']`,
  );
  return productionFiles(name).some((p) => needle.test(readFileSync(p, "utf8")));
}

describe("доменные модули подключены к продуктовому коду", () => {
  it("проверка вообще находит файлы (иначе тест зелёный впустую)", () => {
    expect(productionFiles("shipments").length).toBeGreaterThan(50);
  });

  for (const name of MUST_BE_WIRED) {
    it(`${name} — импортируется вне тестов`, () => {
      expect(hasProductionImporter(name)).toBe(true);
    });
  }

  it("детектор не «всегда true»: несуществующий модуль не находится", () => {
    expect(hasProductionImporter("этого-модуля-нет-12345")).toBe(false);
  });
});
