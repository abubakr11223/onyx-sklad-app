// W3-T3 — деактивация с подтверждением + «Активировать» (reactivateAccount).
//
// Проверяем:
//  • deleteAccount БЕЗ confirm=yes → отказ (error=confirm), записи нет — серверный
//    гейт, обход UI-подтверждения невозможен.
//  • deleteAccount с confirm=yes → soft-delete (isActive=false), tokenVersion
//    НЕ трогается (сессии умирают через фильтр isActive:true в session.ts).
//  • Самодеактивация владельца → отказ (error=self) даже с confirm.
//  • reactivateAccount: тот же OWNER-gate (deny-by-default), isActive=true,
//    tokenVersion НЕ трогается (симметрично деактивации) → прежний логин/пароль
//    и прежние cookie-семантики восстанавливаются без «log out everywhere».
//  • OWNER-цель / идемпотентность / notfound.
//
// Mock-паттерн — как в accounts-session-gate.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── cookie store mock ──
const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

// ── db mock ──
const findFirst = vi.fn(); // getRealSessionUser
const findUnique = vi.fn(); // action target lookup
const userUpdate = vi.fn();
const auditCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    user: { update: userUpdate },
    auditLog: { create: auditCreate },
  }),
);
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => $transaction(fn),
  },
}));

// ── redirect: throw — asserts destination and proves mutation stopped ──
class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { SESSION_COOKIE, signSessionToken } from "@/lib/auth";
import { deleteAccount, reactivateAccount } from "@/app/accounts/actions";

const OLD_ENV = { ...process.env };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function cookieStore(map: Record<string, string>) {
  cookieGet.mockImplementation((name: string) =>
    name in map ? { value: map[name] } : undefined,
  );
}

async function loginAsOwner(id = "owner-id") {
  const token = await signSessionToken(id, 0);
  cookieStore({ [SESSION_COOKIE]: token });
  findFirst.mockResolvedValue({
    id,
    name: "Owner",
    role: "OWNER",
    tokenVersion: 0,
  });
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
  cookieGet.mockReset();
  findFirst.mockReset();
  findUnique.mockReset();
  userUpdate.mockReset();
  auditCreate.mockReset();
  $transaction.mockClear();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

// ────────────────── deleteAccount — серверное подтверждение ──────────────────
describe("deleteAccount — confirm обязателен (W3-T3)", () => {
  it("без confirm → error=confirm, записи нет (обход UI невозможен)", async () => {
    await loginAsOwner();
    await expect(
      deleteAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/error=confirm/);
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("confirm с любым другим значением → error=confirm", async () => {
    await loginAsOwner();
    await expect(
      deleteAccount(fd({ userId: "target-id", confirm: "true" })),
    ).rejects.toThrow(/error=confirm/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("confirm=yes → isActive=false, tokenVersion НЕ трогается, audit пишется", async () => {
    await loginAsOwner();
    findUnique.mockResolvedValueOnce({
      id: "target-id",
      role: "MANAGER",
      isActive: true,
    });
    await expect(
      deleteAccount(fd({ userId: "target-id", confirm: "yes" })),
    ).rejects.toThrow(/ok=deleted/);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const upd = userUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "target-id" });
    expect(upd.data).toEqual({ isActive: false }); // никакого tokenVersion
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "owner-id",
          entityId: "target-id",
          payload: expect.objectContaining({ kind: "account.deactivate" }),
        }),
      }),
    );
  });

  it("самодеактивация владельца → error=self (даже с confirm=yes)", async () => {
    await loginAsOwner();
    // Владелец OWNER — сначала сработает owner_protected; проверим self на
    // не-owner актёре невозможно (gate только OWNER), поэтому цель = сам owner:
    // owner_protected стоит ДО self и тоже блокирует самоблокировку.
    findUnique.mockResolvedValueOnce({
      id: "owner-id",
      role: "OWNER",
      isActive: true,
    });
    await expect(
      deleteAccount(fd({ userId: "owner-id", confirm: "yes" })),
    ).rejects.toThrow(/error=(owner_protected|self)/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("гипотетический не-OWNER-таргет с id актёра → error=self", async () => {
    await loginAsOwner();
    // Прямая проверка ветки self: цель НЕ OWNER, но id совпадает с актёром.
    findUnique.mockResolvedValueOnce({
      id: "owner-id",
      role: "MANAGER",
      isActive: true,
    });
    await expect(
      deleteAccount(fd({ userId: "owner-id", confirm: "yes" })),
    ).rejects.toThrow(/error=self/);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// ────────────────── reactivateAccount ──────────────────
describe("reactivateAccount — гейт и симметрия с деактивацией", () => {
  it("без сессии → denied, записи нет (deny-by-default)", async () => {
    cookieStore({});
    await expect(
      reactivateAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/error=denied/);
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("MANAGER-сессия → denied", async () => {
    const token = await signSessionToken("manager-id", 0);
    cookieStore({ [SESSION_COOKIE]: token });
    findFirst.mockResolvedValueOnce({
      id: "manager-id",
      name: "M",
      role: "MANAGER",
      tokenVersion: 0,
    });
    await expect(
      reactivateAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/error=denied/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("OWNER: неактивный MANAGER → isActive=true, tokenVersion НЕ трогается + audit", async () => {
    await loginAsOwner();
    findUnique.mockResolvedValueOnce({
      id: "target-id",
      role: "MANAGER",
      isActive: false,
    });
    await expect(
      reactivateAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/ok=reactivated/);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const upd = userUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "target-id" });
    // Симметрия: как и деактивация, реактивация НЕ инкрементит tokenVersion —
    // логин восстанавливается по прежнему паролю, «log out everywhere» не нужен
    // (сессии при деактивации умирали через фильтр isActive:true в session.ts).
    expect(upd.data).toEqual({ isActive: true });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "owner-id",
          entityId: "target-id",
          payload: expect.objectContaining({ kind: "account.reactivate" }),
        }),
      }),
    );
  });

  it("цель OWNER → owner_protected (корень не трогаем)", async () => {
    await loginAsOwner();
    findUnique.mockResolvedValueOnce({
      id: "other-owner",
      role: "OWNER",
      isActive: false,
    });
    await expect(
      reactivateAccount(fd({ userId: "other-owner" })),
    ).rejects.toThrow(/error=owner_protected/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("уже активен → ok=reactivated (идемпотентно), записи нет", async () => {
    await loginAsOwner();
    findUnique.mockResolvedValueOnce({
      id: "target-id",
      role: "MANAGER",
      isActive: true,
    });
    await expect(
      reactivateAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/ok=reactivated/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("userId пуст / не найден → notfound", async () => {
    await loginAsOwner();
    await expect(reactivateAccount(fd({}))).rejects.toThrow(/error=notfound/);
    findUnique.mockResolvedValueOnce(null);
    await expect(
      reactivateAccount(fd({ userId: "ghost" })),
    ).rejects.toThrow(/error=notfound/);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// ────────────────── полный цикл: деактивация → реактивация ──────────────────
describe("цикл деактивация → реактивация восстанавливает вход", () => {
  it("после reactivate состояние снова isActive=true, пароль/tokenVersion нетронуты", async () => {
    await loginAsOwner();
    // 1) деактивация
    findUnique.mockResolvedValueOnce({
      id: "emp-1",
      role: "WAREHOUSE",
      isActive: true,
    });
    await expect(
      deleteAccount(fd({ userId: "emp-1", confirm: "yes" })),
    ).rejects.toThrow(/ok=deleted/);
    // 2) реактивация
    findUnique.mockResolvedValueOnce({
      id: "emp-1",
      role: "WAREHOUSE",
      isActive: false,
    });
    await expect(
      reactivateAccount(fd({ userId: "emp-1" })),
    ).rejects.toThrow(/ok=reactivated/);

    // Оба апдейта трогали ТОЛЬКО isActive — passwordHash и tokenVersion целы,
    // значит логин по прежнему паролю снова работает (session.ts фильтрует
    // isActive:true, других ворот нет).
    expect(userUpdate).toHaveBeenCalledTimes(2);
    expect(userUpdate.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(userUpdate.mock.calls[1][0].data).toEqual({ isActive: true });
  });
});
