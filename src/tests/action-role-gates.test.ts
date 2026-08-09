// Аудит ТЗ №7 #5 — capability-гейты на write-действиях были untested.
// Только accounts-session-gate.test.ts гейт-тест раньше существовал. Здесь:
// с моком getCapabilities возвращающим все false — submitSale / submitIntake /
// submitBreak / createReservation ДОЛЖНЫ вернуть form-ошибку и не сделать НИ
// одного db.create / db.update. Регрессия к удалению гейта провалит тест.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getCurrentUser: vi.fn(),
  getRealSessionUser: vi.fn(),
  // Все возможные db-мутаторы — если гейт пропущен, хоть один из них
  // вызовется, и мы это увидим.
  dbCalls: {
    batchCreate: vi.fn(),
    slabUpdateMany: vi.fn(),
    pieceUpdateMany: vi.fn(),
    reservationCreate: vi.fn(),
    saleCreate: vi.fn(),
    auditCreate: vi.fn(),
  },
}));

vi.mock("@/lib/session", () => ({
  getCapabilities: M.getCapabilities,
  getCurrentUser: M.getCurrentUser,
  getRealSessionUser: M.getRealSessionUser,
}));

// db — модуль, мокаем на минимум методов, которые могли бы вызваться. Каждый —
// vi.fn(); если гейт пустил — увидим `mock.calls.length > 0`.
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (
      cbOrArgs:
        | ((tx: unknown) => Promise<unknown>)
        | Array<unknown>,
    ) => {
      // Если гейт правильно вернул до этого — мы сюда даже не попадём. Если
      // попали (гейт пропущен) — тестам всё равно нужен успешный вызов, чтобы
      // тест мог утверждать «был вызов». Возвращаем пустой ok.
      if (typeof cbOrArgs === "function") {
        return cbOrArgs({
          batch: { create: M.dbCalls.batchCreate },
          slab: { updateMany: M.dbCalls.slabUpdateMany, findUnique: vi.fn() },
          piece: { updateMany: M.dbCalls.pieceUpdateMany, findUnique: vi.fn() },
          reservation: { create: M.dbCalls.reservationCreate, updateMany: vi.fn() },
          saleRecord: { create: M.dbCalls.saleCreate, findUnique: vi.fn() },
          auditLog: { create: M.dbCalls.auditCreate },
          user: { findUnique: vi.fn() },
          appConfig: { findUnique: vi.fn() },
          batchPattern: { findUnique: vi.fn() },
          $queryRaw: vi.fn(),
        });
      }
      return Promise.all(cbOrArgs);
    },
    batch: { create: M.dbCalls.batchCreate },
    reservation: { create: M.dbCalls.reservationCreate, findMany: vi.fn(async () => []) },
  },
}));

// next/navigation.redirect бросает — некоторые gate возвращают error, а не
// redirect'ят; но на всякий случай не даём redirect выйти unhandled.
class NextRedirect extends Error {
  constructor(public location: string) {
    super("NEXT_REDIRECT");
    this.name = "NEXT_REDIRECT";
  }
}
vi.mock("next/navigation", () => ({
  redirect: (loc: string) => {
    throw new NextRedirect(loc);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── Импорт actions ПОСЛЕ моков ──
import { submitIntake } from "@/app/priemka/actions";
import { submitBreak } from "@/app/razbit/actions";
import { submitSale } from "@/app/prodazha/actions";
import { createReservation } from "@/app/bron/actions";

/** Возвращает пустой FormData — action-у не важен body, гейт должен отсечь до него. */
const emptyForm = (): FormData => new FormData();

/** Все capabilities выключены — стандартный «нет доступа» контекст. */
const denyAll = () => ({
  canSell: false,
  canReserve: false,
  canManageWarehouse: false,
  canSeeExactRemainder: false,
  canSeeLeads: false,
  canRequestPhoto: false,
  requestsRouteToManager: false,
});

/** Все capabilities включены — на всякий случай регрессия «а если разрешено, то action НЕ падает на гейте» тоже проверим. */
const allowAll = () => ({
  canSell: true,
  canReserve: true,
  canManageWarehouse: true,
  canSeeExactRemainder: true,
  canSeeLeads: true,
  canRequestPhoto: true,
  requestsRouteToManager: true,
});

beforeEach(() => {
  M.getCapabilities.mockReset();
  M.getCurrentUser.mockReset();
  M.getRealSessionUser.mockReset();
  Object.values(M.dbCalls).forEach((f) => f.mockReset());
  M.getCurrentUser.mockResolvedValue({ id: "u1", role: "MANAGER" });
  M.getRealSessionUser.mockResolvedValue({ id: "u1", role: "MANAGER", isActive: true });
});

function expectNoDbWrites() {
  expect(M.dbCalls.batchCreate).not.toHaveBeenCalled();
  expect(M.dbCalls.slabUpdateMany).not.toHaveBeenCalled();
  expect(M.dbCalls.pieceUpdateMany).not.toHaveBeenCalled();
  expect(M.dbCalls.reservationCreate).not.toHaveBeenCalled();
  expect(M.dbCalls.saleCreate).not.toHaveBeenCalled();
  expect(M.dbCalls.auditCreate).not.toHaveBeenCalled();
}

// ═══════════════ submitIntake — canManageWarehouse ═══════════════

describe("submitIntake — capability gate canManageWarehouse (ТЗ №7 #5)", () => {
  it("нет canManageWarehouse → form-ошибка «нет доступа», НИ ОДНОЙ db-записи", async () => {
    M.getCapabilities.mockResolvedValue(denyAll());

    const res = await submitIntake({ errors: {} }, emptyForm());

    expect(res.errors.form).toMatch(/нет доступа|приёмку/i);
    expectNoDbWrites();
  });

  it("есть canManageWarehouse → гейт пропускает (падает уже на валидации, но НЕ на form=«нет доступа»)", async () => {
    M.getCapabilities.mockResolvedValue(allowAll());

    const res = await submitIntake({ errors: {} }, emptyForm());

    // Пустая форма → валидация вернёт ошибки полей, НО не form=«нет доступа».
    expect(res.errors.form ?? "").not.toMatch(/нет доступа/i);
    // batch.create всё равно не должен быть вызван (валидация не прошла).
    expect(M.dbCalls.batchCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════ submitBreak — canManageWarehouse ═══════════════

describe("submitBreak — capability gate canManageWarehouse (ТЗ №7 #5)", () => {
  it("нет canManageWarehouse → form-ошибка, НИ ОДНОЙ db-записи", async () => {
    M.getCapabilities.mockResolvedValue(denyAll());

    const res = await submitBreak({ errors: {} }, emptyForm());

    expect(res.errors.form).toMatch(/нет доступа|разбить/i);
    expectNoDbWrites();
  });
});

// ═══════════════ submitSale — canSell ═══════════════

describe("submitSale — capability gate canSell (ТЗ №7 #5)", () => {
  it("нет canSell (склад/партнёр) → form-ошибка, НИ SaleRecord ни updateMany", async () => {
    M.getCapabilities.mockResolvedValue(denyAll());

    const res = await submitSale(
      { errors: {}, conflict: null },
      emptyForm(),
    );

    expect(res.errors.form).toMatch(/нет доступа|продажа/i);
    expect(res.conflict).toBeNull();
    expectNoDbWrites();
  });
});

// ═══════════════ createReservation — canReserve ═══════════════

describe("createReservation — capability gate canReserve (ТЗ №7 #5)", () => {
  it("нет canReserve (склад/партнёр) → form-ошибка, Reservation НЕ создаётся", async () => {
    M.getCapabilities.mockResolvedValue(denyAll());

    const res = await createReservation(
      { errors: {}, alternatives: [] },
      emptyForm(),
    );

    expect(res.errors?.form).toMatch(/нет доступа|бронь/i);
    expectNoDbWrites();
  });
});
