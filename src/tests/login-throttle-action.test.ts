// Аудит 2026-08-10 — троттлинг в САМОМ действии входа (не только в чистом модуле).
//
// Ключевое требование: при блокировке PBKDF2 НЕ вызывается. Иначе троттлинг
// защищал бы только от подбора, но не от главного побочного эффекта — каждая
// попытка стоила серверу 100k итераций, то есть перебор был ещё и способом
// сжечь CPU функции.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyUserPassword = vi.fn();
vi.mock("@/lib/password", () => ({
  verifyUserPassword: (...a: unknown[]) => verifyUserPassword(...a),
}));

const userFindFirst = vi.fn();
const attemptFindUnique = vi.fn();
const attemptUpsert = vi.fn();
const attemptDeleteMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    loginAttempt: {
      findUnique: (...a: unknown[]) => attemptFindUnique(...a),
      upsert: (...a: unknown[]) => attemptUpsert(...a),
      deleteMany: (...a: unknown[]) => attemptDeleteMany(...a),
    },
  },
}));

const cookieSet = vi.fn();
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
  headers: async () => requestHeaders,
}));

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

import { loginWithPassword } from "@/app/login/actions";
import { LOGIN_MAX_FAILURES_EMAIL } from "@/lib/login-throttle";

const OLD_ENV = { ...process.env };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Запускает действие и возвращает URL редиректа. */
async function run(fields: Record<string, string>): Promise<string> {
  try {
    await loginWithPassword(fd(fields));
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("ожидался redirect, но действие завершилось без него");
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
  requestHeaders = new Headers();
  verifyUserPassword.mockReset();
  userFindFirst.mockReset();
  attemptFindUnique.mockReset();
  attemptUpsert.mockReset();
  attemptDeleteMany.mockReset();
  attemptFindUnique.mockResolvedValue(null);
  attemptUpsert.mockResolvedValue({});
  attemptDeleteMany.mockResolvedValue({ count: 0 });
  userFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("loginWithPassword — троттлинг", () => {
  it("порог достигнут → отказ БЕЗ единого вызова PBKDF2 (защита CPU)", async () => {
    attemptFindUnique.mockResolvedValue({
      failures: LOGIN_MAX_FAILURES_EMAIL,
      firstAt: new Date(),
    });

    const url = await run({ email: "a@b.uz", password: "guess", next: "/" });

    expect(url).toContain("error=throttled");
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("отдельный код ошибки — сотрудник не побежит менять верный пароль", async () => {
    attemptFindUnique.mockResolvedValue({
      failures: LOGIN_MAX_FAILURES_EMAIL + 5,
      firstAt: new Date(),
    });

    const url = await run({ email: "a@b.uz", password: "x", next: "/" });

    expect(url).toContain("error=throttled");
    expect(url).not.toContain("error=login");
  });

  it("неудача записывается в счётчик (иначе порог никогда не наступит)", async () => {
    userFindFirst.mockResolvedValue(null);
    verifyUserPassword.mockResolvedValue(false);

    const url = await run({ email: "a@b.uz", password: "wrong", next: "/" });

    expect(url).toContain("error=login");
    const scopes = attemptUpsert.mock.calls.map((c) => c[0].where.scope_key.scope);
    expect(scopes).toContain("email");
  });

  it("адрес из x-forwarded-for учитывается отдельной областью «ip»", async () => {
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    userFindFirst.mockResolvedValue(null);
    verifyUserPassword.mockResolvedValue(false);

    await run({ email: "a@b.uz", password: "wrong", next: "/" });

    const keys = attemptUpsert.mock.calls.map((c) => c[0].where.scope_key);
    expect(keys).toContainEqual({ scope: "ip", key: "203.0.113.9" });
  });

  it("успешный вход СНИМАЕТ счётчик — иначе блокировка после верного пароля", async () => {
    userFindFirst.mockResolvedValue({
      id: "u1",
      passwordHash: "pbkdf2$1$c2FsdA==$aGFzaA==",
      tokenVersion: 3,
    });
    verifyUserPassword.mockResolvedValue(true);

    const url = await run({ email: "a@b.uz", password: "right", next: "/poisk" });

    expect(url).toBe("/poisk");
    const cleared = attemptDeleteMany.mock.calls.map((c) => c[0].where.scope);
    expect(cleared).toContain("email");
    expect(cookieSet).toHaveBeenCalled();
  });

  it("сбой таблицы троттлинга не запирает склад (fail-open)", async () => {
    attemptFindUnique.mockRejectedValue(new Error("db down"));
    userFindFirst.mockResolvedValue({
      id: "u1",
      passwordHash: "pbkdf2$1$c2FsdA==$aGFzaA==",
      tokenVersion: 1,
    });
    verifyUserPassword.mockResolvedValue(true);

    const url = await run({ email: "a@b.uz", password: "right", next: "/" });

    expect(url).toBe("/");
    expect(cookieSet).toHaveBeenCalled();
  });
});
