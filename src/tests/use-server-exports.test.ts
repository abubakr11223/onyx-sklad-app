// Структурный guard (аудит 2026-08-10): в модуле с «use server» КАЖДЫЙ экспорт
// обязан быть async-функцией.
//
// Почему это отдельный тест, а не «и так все знают». Экспорт обычной константы
// из такого файла не даёт ни ошибки типов, ни падения тестов: `tsc` доволен,
// vitest доволен, и даже `next build` завершается кодом 0 — он лишь ПЕЧАТАЕТ
//
//   «The export searchClientsForSale was not found … The module has no exports at all»
//
// после чего вся форма продажи ломается в рантайме. То есть единственный сигнал
// — строчка в логе сборки, которую легко пролистать. Ровно так это и случилось
// при правке scope объектов; здесь ставим забор, чтобы не наступить снова.
//
// Разрешено: `export async function`, `export type`, `export interface`.
// Запрещено: `export const/let/var`, синхронный `export function`, `export default`,
// реэкспорт `export { … }`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Файлы, начинающиеся с директивы «use server». */
function serverActionFiles(): Array<{ path: string; source: string }> {
  return walk(APP_DIR)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => /^\s*["']use server["'];/m.test(source));
}

/** Строки-экспорты, которые НЕ являются async-функцией и не являются типом. */
export function offendingExports(source: string): string[] {
  const bad: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("export")) continue;
    if (line.startsWith("export async function")) continue;
    if (line.startsWith("export type")) continue;
    if (line.startsWith("export interface")) continue;
    bad.push(line);
  }
  return bad;
}

describe("«use server» модули экспортируют только async-функции", () => {
  it("в проекте вообще есть такие модули (иначе тест бессмысленно зелёный)", () => {
    expect(serverActionFiles().length).toBeGreaterThan(5);
  });

  it("ни один action-файл не экспортирует константу / sync-функцию / default", () => {
    const violations = serverActionFiles().flatMap(({ path, source }) =>
      offendingExports(source).map(
        (line) => `${path.replace(process.cwd() + "/", "")}: ${line}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});

describe("offendingExports — сама проверка", () => {
  it("ловит экспорт константы (случай, который сломал форму продажи)", () => {
    const src = `"use server";\nexport const SITE_PICKER_TAKE = 50;\n`;
    expect(offendingExports(src)).toEqual(["export const SITE_PICKER_TAKE = 50;"]);
  });

  it("ловит синхронную функцию и default-экспорт", () => {
    const src = `"use server";\nexport function f() {}\nexport default f;\n`;
    expect(offendingExports(src)).toHaveLength(2);
  });

  it("пропускает async-функции и типы", () => {
    const src =
      `"use server";\nexport async function act() {}\n` +
      `export type T = string;\nexport interface I { a: 1 }\n`;
    expect(offendingExports(src)).toEqual([]);
  });
});
