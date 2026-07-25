// БАГ-27: currentActorId() — единый helper (src/lib/session.ts) вместо 4
// одноимённых-по-логике локальных функций (bron/poisk/razbit/prodazha
// currentManagerId/currentWarehouseUserId/getActingManagerId) и 7 инлайн-копий
// `(await getCurrentUser())?.id ?? null` (kamen ×5, priemka ×1, singan ×1).
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

import { SESSION_COOKIE, signSessionToken } from "@/lib/auth";
import { currentActorId } from "@/lib/session";

function cookieStore(map: Record<string, string>) {
  cookieGet.mockImplementation((name: string) =>
    name in map ? { value: map[name] } : undefined,
  );
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
  cookieGet.mockReset();
  findFirst.mockReset();
});

describe("currentActorId", () => {
  it("сессия валидна + активный пользователь → id", async () => {
    // ТЗ №7 #9 follow-up — signSessionToken v2: (userId, tokenVersion).
    // Mock findFirst также возвращает tokenVersion (session.ts сверяет с БД).
    const token = await signSessionToken("user-42", 0);
    cookieStore({ [SESSION_COOKIE]: token });
    findFirst.mockResolvedValue({
      id: "user-42",
      name: "Али",
      role: "MANAGER",
      canSeePurchasePrice: false,
      tokenVersion: 0,
    });

    expect(await currentActorId()).toBe("user-42");
  });

  it("нет сессии → null", async () => {
    cookieStore({});
    expect(await currentActorId()).toBeNull();
  });

  it("сессия есть, но пользователь неактивен/удалён → null", async () => {
    const token = await signSessionToken("user-gone", 0);
    cookieStore({ [SESSION_COOKIE]: token });
    findFirst.mockResolvedValue(null);

    expect(await currentActorId()).toBeNull();
  });
});
