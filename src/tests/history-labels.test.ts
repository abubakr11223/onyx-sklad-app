// ТЗ №15 §7.9 «все действия в Истории» — структурная сверка.
//
// Требование выполнялось лишь формально: SHIPMENT_CONFIRM, SHOWROOM_SEND,
// SHOWROOM_RETURN и все SAMPLE_* писались в AuditLog, но подписи для них не
// было, и журнал показывал сырой enum. Ошибка тихая — новый член AuditAction
// ничего не ломает, просто в русском интерфейсе появляется английское слово.
//
// Этот тест сверяет ACTION_RU с enum'ом AuditAction прямо из schema.prisma:
// добавили действие в схему — обязаны добавить подпись.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_RU,
  ENTITY_RU,
  actionLabelRu,
  actionVariant,
  entityLabelRu,
} from "@/lib/history-labels";

/** Члены enum'а AuditAction из prisma/schema.prisma. */
function auditActionsFromSchema(): string[] {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const m = /enum\s+AuditAction\s*\{([\s\S]*?)\}/.exec(schema);
  if (!m) throw new Error("enum AuditAction не найден в schema.prisma");
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").replace(/\/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

describe("История — подписи действий покрывают весь AuditAction", () => {
  it("схема действительно разобрана (иначе тест зелёный впустую)", () => {
    const actions = auditActionsFromSchema();
    expect(actions.length).toBeGreaterThan(15);
    expect(actions).toContain("SALE");
    expect(actions).toContain("SHIPMENT_CONFIRM");
  });

  it("у каждого действия из схемы есть русская подпись", () => {
    const missing = auditActionsFromSchema().filter((a) => !ACTION_RU[a]);
    expect(missing).toEqual([]);
  });

  it("подписи непустые и не совпадают с самим кодом действия", () => {
    for (const [code, label] of Object.entries(ACTION_RU)) {
      expect(label.trim()).not.toBe("");
      expect(label).not.toBe(code);
    }
  });

  it("ТЗ №15 §7.9 — отгрузка и шоу-рум подписаны по-русски", () => {
    expect(actionLabelRu("SHIPMENT_CONFIRM")).toBe("Отгрузка");
    expect(actionLabelRu("SHOWROOM_SEND")).toBe("В шоу-рум");
    expect(actionLabelRu("SHOWROOM_RETURN")).toBe("Возврат из шоу-рума");
  });

  it("ТЗ №10 — действия с образцами подписаны", () => {
    expect(actionLabelRu("SAMPLE_ISSUE")).toBe("Выдача образца");
    expect(actionLabelRu("SAMPLE_RETURN")).toBe("Возврат образца");
    expect(actionLabelRu("SAMPLE_SELL")).toBe("Продажа образца");
    expect(actionLabelRu("SAMPLE_EXTEND")).toBe("Продление образца");
  });
});

describe("История — сущности", () => {
  it("сущности новых разделов подписаны", () => {
    expect(entityLabelRu("Sample")).toBe("Образец");
    expect(entityLabelRu("Shipment")).toBe("Отгрузка");
    expect(entityLabelRu("ShowroomPlacement")).toBe("Шоу-рум");
    expect(entityLabelRu("Client")).toBe("Клиент");
  });

  it("подписи непустые", () => {
    for (const label of Object.values(ENTITY_RU)) {
      expect(label.trim()).not.toBe("");
    }
  });
});

describe("Откаты — неизвестное не превращается в пустоту", () => {
  it("неизвестное действие выводится как есть, а не пустой строкой", () => {
    expect(actionLabelRu("FUTURE_ACTION")).toBe("FUTURE_ACTION");
    expect(entityLabelRu("FutureEntity")).toBe("FutureEntity");
  });

  it("вариант badge по умолчанию нейтральный", () => {
    expect(actionVariant("FUTURE_ACTION")).toBe("neutral");
    expect(actionVariant("SALE")).toBe("success");
  });
});
