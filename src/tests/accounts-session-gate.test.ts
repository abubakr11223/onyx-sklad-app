// OWN-03 XAVFSIZLIK: /accounts action'lari + sahifasi FAQAT haqiqiy OWNER sessiyasi
// bilan ochiladi. `onyx_demo_role=OWNER` demo-shim'i endi bu yerga O'TA OLMAYDI.
//
// Mock: next/headers (cookies), @/lib/db, next/navigation (redirect throw),
// next/cache (revalidatePath noop). AUTH_COOKIE_SECRET real crypto uchun o'rnatiladi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── cookie store mock ──
const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

// ── db mock ──
const findFirst = vi.fn(); // getRealSessionUser
const findUnique = vi.fn(); // action target lookup
const findMany = vi.fn(); // page: список аккаунтов (только после gate)
const userUpdate = vi.fn();
const userCreate = vi.fn();
const auditCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    user: { update: userUpdate, create: userCreate },
    auditLog: { create: auditCreate },
  }),
);
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
    $transaction: (...a: unknown[]) => $transaction(...a),
  },
}));

// ── redirect: throw so we can assert the destination and prove mutation stopped ──
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
import { DEMO_ROLE_COOKIE } from "@/lib/session";
import {
  createAccount,
  deleteAccount,
  changeRole,
  resetPassword,
} from "@/app/accounts/actions";
import AccountsPage from "@/app/accounts/page";

const OLD_ENV = { ...process.env };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** cookie store: only the given map is visible; anything else → undefined. */
function cookieStore(map: Record<string, string>) {
  cookieGet.mockImplementation((name: string) =>
    name in map ? { value: map[name] } : undefined,
  );
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
  cookieGet.mockReset();
  findFirst.mockReset();
  findUnique.mockReset();
  findMany.mockReset();
  userUpdate.mockReset();
  userCreate.mockReset();
  auditCreate.mockReset();
  $transaction.mockClear();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

// ────────────────────────── (a) DENY: demo=OWNER, sessiya YO'Q ──────────────────────────
describe("actions DENY — demo-role=OWNER bo'lsa ham, haqiqiy sessiya yo'q", () => {
  beforeEach(() => {
    // Anonim tashrifchi onyx_demo_role=OWNER qo'ygan, LEKIN onyx_session yo'q.
    cookieStore({ [DEMO_ROLE_COOKIE]: "OWNER" });
  });

  it("resetPassword → denied, hech qanday yozuv yo'q, demo DB'ga umuman qaralmaydi", async () => {
    await expect(
      resetPassword(fd({ userId: "target-id", password: "password1" })),
    ).rejects.toThrow(/error=denied/);
    // getRealSessionUser sessiya cookie'siz DB'ga bormaydi → demo-shim yo'q.
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("createAccount → denied, user yaratilmaydi", async () => {
    await expect(
      createAccount(
        fd({ name: "X", email: "x@y.com", password: "password1", role: "MANAGER" }),
      ),
    ).rejects.toThrow(/error=denied/);
    expect(userCreate).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("deleteAccount → denied, deaktivatsiya yo'q", async () => {
    await expect(
      deleteAccount(fd({ userId: "target-id" })),
    ).rejects.toThrow(/error=denied/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("changeRole → denied, rol o'zgармайди", async () => {
    await expect(
      changeRole(fd({ userId: "target-id", role: "WAREHOUSE" })),
    ).rejects.toThrow(/error=denied/);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// ── DENY: haqiqiy sessiya bor, ammo rol OWNER emas (MANAGER token) ──
describe("actions DENY — haqiqiy sessiya bor, lekin rol ≠ OWNER", () => {
  it("MANAGER sessiya → resetPassword denied", async () => {
    const token = await signSessionToken("manager-id");
    cookieStore({ [SESSION_COOKIE]: token });
    // getRealSessionUser DB'dan MANAGER'ni yuklaydi.
    findFirst.mockResolvedValueOnce({
      id: "manager-id",
      name: "Manager",
      role: "MANAGER",
    });
    await expect(
      resetPassword(fd({ userId: "target-id", password: "password1" })),
    ).rejects.toThrow(/error=denied/);
    expect(findUnique).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// ────────────────────────── (b) ALLOW: haqiqiy OWNER sessiyasi ──────────────────────────
describe("actions ALLOW — haqiqiy OWNER sessiyasi", () => {
  beforeEach(async () => {
    const token = await signSessionToken("owner-id");
    cookieStore({ [SESSION_COOKIE]: token });
    // getRealSessionUser → OWNER (birinchi findFirst chaqiruvi).
    findFirst.mockResolvedValue({
      id: "owner-id",
      name: "Owner",
      role: "OWNER",
    });
  });

  it("resetPassword → MANAGER nishonga parol yangilanadi (ok=password)", async () => {
    findUnique.mockResolvedValueOnce({ id: "target-id", role: "MANAGER" });
    await expect(
      resetPassword(fd({ userId: "target-id", password: "password1" })),
    ).rejects.toThrow(/ok=password/);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    // audit actorId — haqiqiy owner id'si (demo emas).
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "owner-id" }),
      }),
    );
  });

  it("changeRole → MANAGER→WAREHOUSE bajariladi (ok=role)", async () => {
    findUnique.mockResolvedValueOnce({ id: "target-id", role: "MANAGER" });
    await expect(
      changeRole(fd({ userId: "target-id", role: "WAREHOUSE" })),
    ).rejects.toThrow(/ok=role/);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────── AccountsPage gate (sahifa darajasi) ──────────────────────────
// Ro'yxat so'rovi (findMany) FAQAT gate o'tgach yuritiladi. Demak findMany chaqirilmasa —
// sahifa <NoAccess/> qaytargan (ro'yxat qurilmagan).
describe("AccountsPage — sahifa gate'i", () => {
  const searchParams = Promise.resolve({});

  it("demo-role=OWNER, sessiya yo'q → ro'yxat qurilmaydi (NoAccess)", async () => {
    cookieStore({ [DEMO_ROLE_COOKIE]: "OWNER" });
    await AccountsPage({ searchParams });
    expect(findFirst).not.toHaveBeenCalled(); // demo-shim'ga umuman qaralmaydi
    expect(findMany).not.toHaveBeenCalled(); // ro'yxat qurilmadi
  });

  it("MANAGER sessiyasi → ro'yxat qurilmaydi (NoAccess)", async () => {
    const token = await signSessionToken("manager-id");
    cookieStore({ [SESSION_COOKIE]: token });
    findFirst.mockResolvedValueOnce({ id: "manager-id", name: "M", role: "MANAGER" });
    await AccountsPage({ searchParams });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("haqiqiy OWNER sessiyasi → ro'yxat quriladi (findMany chaqiriladi)", async () => {
    const token = await signSessionToken("owner-id");
    cookieStore({ [SESSION_COOKIE]: token });
    findFirst.mockResolvedValueOnce({ id: "owner-id", name: "Owner", role: "OWNER" });
    findMany.mockResolvedValueOnce([]);
    await AccountsPage({ searchParams });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
