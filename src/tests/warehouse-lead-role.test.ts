// Роль «Зав. складом» (WAREHOUSE_LEAD) — согласовано с владельцем 2026-08-12.
//
// Два уровня складского персонала:
//   складчик      — размеры, дата, поставщик, узоры, локации;
//   зав. складом  — то же + КОЛИЧЕСТВО (плиты / м²).
//
// Главный риск этой роли — не в правах, а в ТИШИНЕ. Если где-то остался
// `role === "WAREHOUSE"`, зав. складом просто перестаёт получать фото-задания,
// подтверждать отгрузки или работать с витриной. Ничего не падает, тесты
// зелёные, человек молча теряет функции. Поэтому здесь сверяется вся матрица
// целиком, а не отдельные флаги.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  capabilitiesFor,
  isWarehouseRole,
  type Capabilities,
} from "@/lib/permissions";
import { roleLabel } from "@/lib/role-labels";
import { CREATABLE_ROLES, TOGGLEABLE_ROLES } from "@/lib/accounts";

const OPTS = { canSeePurchasePrice: false };
const lead = () => capabilitiesFor("WAREHOUSE_LEAD", OPTS);
const worker = () => capabilitiesFor("WAREHOUSE", OPTS);

describe("Зав. складом = складчик во всём, кроме количества", () => {
  it("матрицы совпадают по КАЖДОМУ праву, кроме canEditBatchQuantity", () => {
    const a = worker();
    const b = lead();
    const differing = (Object.keys(a) as Array<keyof Capabilities>).filter(
      (k) => a[k] !== b[k],
    );
    expect(differing).toEqual(["canEditBatchQuantity"]);
  });

  it("складчик количество НЕ меняет, зав. складом — меняет", () => {
    expect(worker().canEditBatchQuantity).toBe(false);
    expect(lead().canEditBatchQuantity).toBe(true);
  });

  it("зав. складом сохраняет все складские функции", () => {
    const c = lead();
    expect(c.canManageWarehouse).toBe(true); // приёмка / разбить / перемещение
    expect(c.canViewPhotoTasks).toBe(true); // фото-задания
    expect(c.canSeeShipments).toBe(true); // отгрузки
    expect(c.canConfirmShipment).toBe(true); // подтверждение выдачи
    expect(c.canSeeShowroom).toBe(true); // витрина
    expect(c.canSendToShowroom).toBe(true);
    expect(c.canSeeExactRemainder).toBe(true);
  });

  it("зав. складом НЕ получает лишнего: ни продаж, ни цен, ни журнала", () => {
    const c = lead();
    expect(c.canSell).toBe(false);
    expect(c.canSeePrices).toBe(false);
    expect(c.canSeePurchasePrice).toBe(false);
    expect(c.canSeeHistory).toBe(false); // журнал действий — только владелец
    expect(c.canManageAccounts).toBe(false);
    expect(c.canSeeDebts).toBe(false);
    expect(c.canSeeClients).toBe(false);
  });
});

describe("Право на количество — только владелец и зав. складом", () => {
  it("матрица по всем ролям", () => {
    expect(capabilitiesFor("OWNER", OPTS).canEditBatchQuantity).toBe(true);
    expect(capabilitiesFor("WAREHOUSE_LEAD", OPTS).canEditBatchQuantity).toBe(true);
    expect(capabilitiesFor("WAREHOUSE", OPTS).canEditBatchQuantity).toBe(false);
    expect(capabilitiesFor("MANAGER", OPTS).canEditBatchQuantity).toBe(false);
    expect(capabilitiesFor("PARTNER", OPTS).canEditBatchQuantity).toBe(false);
  });

  it("право больше не выводится из canSeeHistory (старый обходной признак)", () => {
    // Раньше страница считала «может менять количество» = «видит Историю».
    // Зав. складом ломает эту связь: количество — да, журнал — нет.
    const c = lead();
    expect(c.canEditBatchQuantity).toBe(true);
    expect(c.canSeeHistory).toBe(false);
  });
});

describe("isWarehouseRole — общий признак склада", () => {
  it("обе складские роли — склад", () => {
    expect(isWarehouseRole("WAREHOUSE")).toBe(true);
    expect(isWarehouseRole("WAREHOUSE_LEAD")).toBe(true);
  });

  it("остальные — нет", () => {
    for (const r of ["OWNER", "MANAGER", "PARTNER", "ЧТО-ТО"]) {
      expect(isWarehouseRole(r)).toBe(false);
    }
  });
});

describe("Роль видна и назначается владельцем", () => {
  it("есть русский ярлык", () => {
    expect(roleLabel("WAREHOUSE_LEAD")).toBe("Зав. складом");
  });

  it("можно создать и можно переключить", () => {
    expect([...CREATABLE_ROLES]).toContain("WAREHOUSE_LEAD");
    expect([...TOGGLEABLE_ROLES]).toContain("WAREHOUSE_LEAD");
    // Складчик и зав. складом переключаются друг в друга.
    expect([...TOGGLEABLE_ROLES]).toContain("WAREHOUSE");
  });
});

describe("Роль заведена в схеме и миграции", () => {
  it("enum Role содержит WAREHOUSE_LEAD", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );
    expect(schema).toMatch(/enum Role \{[\s\S]*?WAREHOUSE_LEAD[\s\S]*?\}/);
  });

  it("миграция добавляет значение enum в БД", () => {
    const dir = join(process.cwd(), "prisma", "migrations");
    const found = readdirSync(dir)
      .filter((d) => /^\d/.test(d))
      .some((d) => {
        try {
          return readFileSync(join(dir, d, "migration.sql"), "utf8").includes(
            "'WAREHOUSE_LEAD'",
          );
        } catch {
          return false;
        }
      });
    expect(found).toBe(true);
  });
});

describe("Складские выборки не забыли зав. складом", () => {
  const read = (...p: string[]) =>
    readFileSync(join(process.cwd(), ...p), "utf8");

  it("фото-задания идут обеим складским ролям", () => {
    const s = read("src", "lib", "photo-requests.ts");
    // Прямая сверка с "WAREHOUSE" здесь означала бы, что зав. складом
    // не получает заданий вовсе.
    expect(s).not.toMatch(/role: "WAREHOUSE",/);
    expect(s).toContain('role: { in: ["WAREHOUSE", "WAREHOUSE_LEAD"] }');
  });

  it("задачи на отгрузку идут обеим складским ролям", () => {
    const s = read("src", "lib", "shipment-telegram-notify.ts");
    expect(s).not.toMatch(/role: "WAREHOUSE",/);
    expect(s).toContain('role: { in: ["WAREHOUSE", "WAREHOUSE_LEAD"] }');
  });

  it("панель здоровья Telegram считает обе роли", () => {
    const s = read("src", "app", "accounts", "page.tsx");
    expect(s).not.toMatch(/u\.role === "WAREHOUSE"/);
    expect(s).toContain("isWarehouseRole(u.role)");
  });

  it("телефон обязателен для обеих складских ролей", () => {
    const s = read("src", "lib", "accounts.ts");
    expect(s).toContain("isWarehouseRole(input.role)");
  });
});
