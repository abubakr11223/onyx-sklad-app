// S2-conc — batch-level pessimistic lock, детерминированный unit-тест (БД НЕ нужна).
// Проверяем ФОРМУ SQL: lockBatchForUpdate вызывает $queryRaw tagged-template
// вида `SELECT id FROM "Batch" WHERE id = ${batchId} FOR UPDATE`, где batchId
// передаётся как BIND-параметр (значение шаблона), а не конкатенацией строки —
// это гарантия против SQL-инъекции. Поведенческое доказательство сериализации
// (реальный FOR UPDATE против гонки) — в scratchpad/race-proof.ts (см. отчёт).
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { lockBatchForUpdate } from "@/lib/batch-lock";

describe("lockBatchForUpdate — форма SQL (data-model §3, ADR-005)", () => {
  it("вызывает $queryRaw tagged-template с id партии как bind-параметром", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "batch-1" }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await lockBatchForUpdate(tx, "batch-1");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[]
    ];
    // Первый аргумент tagged-template — массив статических кусков SQL.
    expect(Array.isArray(strings)).toBe(true);
    const sql = strings.join("?");
    expect(sql).toContain('FROM "Batch"');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("WHERE id =");
    // batchId — именно значение шаблона (bind-параметр), НЕ вшит в текст SQL.
    expect(values).toEqual(["batch-1"]);
    expect(sql).not.toContain("batch-1");
  });

  it("прокидывает разные id как отдельные параметры", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await lockBatchForUpdate(tx, "another-batch-id");

    const values = (queryRaw.mock.calls[0] as unknown[]).slice(1);
    expect(values).toEqual(["another-batch-id"]);
  });
});
