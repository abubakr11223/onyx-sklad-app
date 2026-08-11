// ТЗ №16 B — фото партии при приёмке.
//
// Главный риск этой фичи не в UI, а в БД. Миграция `20260724102513` существует
// ровно потому, что `batchPatternId` добавили БЕЗ обновления CHECK
// `Photo_owner_check`: фото узора нарушало ограничение и падало на INSERT — уже
// в проде и молча (приёмка проходила, фото не сохранялось). Тесты этого не
// ловили, потому что мокают БД.
//
// Поэтому здесь проверяется не «работает ли форма», а СОГЛАСОВАННОСТЬ схемы,
// миграции и кода: новый владелец фото обязан быть и в схеме, и в CHECK.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MAX_BATCH_PHOTOS } from "@/lib/photos";

const ROOT = process.cwd();

function schema(): string {
  return readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
}

/** Последнее определение Photo_owner_check по всем миграциям (по имени папки). */
function latestOwnerCheckSql(): string {
  const dir = join(ROOT, "prisma", "migrations");
  const withCheck = readdirSync(dir)
    .filter((d) => /^\d/.test(d))
    .sort()
    .map((d) => {
      try {
        return { d, sql: readFileSync(join(dir, d, "migration.sql"), "utf8") };
      } catch {
        return { d, sql: "" };
      }
    })
    .filter((m) => m.sql.includes('ADD CONSTRAINT "Photo_owner_check"'));
  if (withCheck.length === 0) {
    throw new Error("Photo_owner_check не найден ни в одной миграции");
  }
  return withCheck[withCheck.length - 1].sql;
}

describe("Photo — владелец «фото партии» согласован между схемой и CHECK", () => {
  it("в схеме есть Photo.batchId и связь с Batch", () => {
    const s = schema();
    expect(s).toMatch(/batchId\s+String\?/);
    expect(s).toMatch(/batch\s+Batch\?\s+@relation/);
  });

  it("CHECK в последней миграции допускает batchId как владельца", () => {
    // Если этой строки нет — INSERT фото партии упадёт в проде, а не в тестах.
    expect(latestOwnerCheckSql()).toContain('"batchId" IS NOT NULL');
  });

  it("CHECK не потерял прежних владельцев (регрессия)", () => {
    const sql = latestOwnerCheckSql();
    for (const col of [
      "stoneTypeId",
      "slabId",
      "pieceId",
      "batchPatternId",
    ]) {
      expect(sql).toContain(`"${col}" IS NOT NULL`);
    }
  });

  it("PhotoKind содержит BATCH", () => {
    expect(schema()).toMatch(/enum PhotoKind \{[\s\S]*?\bBATCH\b[\s\S]*?\}/);
  });

  it("миграция добавляет и колонку, и индекс, и значение enum", () => {
    const sql = readFileSync(
      join(
        ROOT,
        "prisma",
        "migrations",
        "20260811180000_tz16_batch_photo",
        "migration.sql",
      ),
      "utf8",
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "batchId"');
    expect(sql).toContain('"Photo_batchId_idx"');
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'BATCH'");
    // Колонка и CHECK — в ОДНОЙ миграции: разносить их и есть тот самый баг.
    expect(sql).toContain('ADD CONSTRAINT "Photo_owner_check"');
  });
});

describe("Ограничение на число фото партии", () => {
  it("потолок разумный: приёмка идёт со склада по слабой сети", () => {
    expect(MAX_BATCH_PHOTOS).toBeGreaterThanOrEqual(1);
    expect(MAX_BATCH_PHOTOS).toBeLessThanOrEqual(10);
  });
});

describe("Фото партии не заменяет фото узора (ТЗ №16 §8.5)", () => {
  it("узор-фото сохраняется своим kind, партия — своим", () => {
    // Приёмка пишет узор как SAMPLE (образец рисунка), партию как BATCH.
    // Если бы kind совпали, разделить их в карточке было бы нечем.
    const actions = readFileSync(
      join(ROOT, "src", "app", "priemka", "actions.ts"),
      "utf8",
    );
    expect(actions).toContain('kind: "SAMPLE"');
    expect(actions).toContain('kind: "BATCH"');
    expect(actions).toContain("batchPhoto");
  });

  it("карточка камня тянет фото партии отдельным запросом по kind BATCH", () => {
    const page = readFileSync(
      join(ROOT, "src", "app", "kamen", "[id]", "page.tsx"),
      "utf8",
    );
    expect(page).toContain('where: { kind: "BATCH" }');
  });
});
