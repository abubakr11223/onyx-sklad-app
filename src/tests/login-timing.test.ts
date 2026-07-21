// Login timing-oracle (MEDIUM): foydalanuvchi TOPILMAGANDA ham bitta dummy PBKDF2
// verify yuritiladi → «login yo'q» va «parol noto'g'ri» yo'llari vaqt jihatidan
// tenglashadi (user-enumeration'ni qiyinlashtiradi). Xato DOIM generic (error=login).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── verifyUserPassword spy (real crypto o'rniga — chaqiruvni kuzatamiz) ──
const verifyUserPassword = vi.fn();
vi.mock("@/lib/password", () => ({
  verifyUserPassword: (...a: unknown[]) => verifyUserPassword(...a),
}));

// ── db mock ──
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

// ── cookie store mock ──
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
}));

// ── redirect: throw so we can assert destination ──
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

const OLD_ENV = { ...process.env };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
  verifyUserPassword.mockReset();
  findFirst.mockReset();
  cookieSet.mockReset();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("loginWithPassword — timing-oracle himoyasi", () => {
  it("foydalanuvchi topilmadi → dummy verify YURITILADI, so'ng generic error=login", async () => {
    findFirst.mockResolvedValue(null);
    verifyUserPassword.mockResolvedValue(false);

    await expect(
      loginWithPassword(fd({ email: "ghost@example.com", password: "secret123" })),
    ).rejects.toThrow(/error=login/);

    // Timing-oracle: aynan bitta dummy verify — parol + well-formed pbkdf2 xesh.
    expect(verifyUserPassword).toHaveBeenCalledTimes(1);
    expect(verifyUserPassword).toHaveBeenCalledWith(
      "secret123",
      expect.stringMatching(/^pbkdf2\$\d+\$[^$]+\$[^$]+$/),
    );
    // Cookie o'rnatilmaydi — login muvaffaqiyatsiz.
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("foydalanuvchi bor, parol noto'g'ri → real verify, xato AYNAN o'sha generic error=login", async () => {
    findFirst.mockResolvedValue({ id: "u1", passwordHash: "pbkdf2$100000$aaaa$bbbb" });
    verifyUserPassword.mockResolvedValue(false);

    await expect(
      loginWithPassword(fd({ email: "real@example.com", password: "wrongpass" })),
    ).rejects.toThrow(/error=login/);

    // Real xesh ustida bitta verify (dummy emas — user topilgan).
    expect(verifyUserPassword).toHaveBeenCalledTimes(1);
    expect(verifyUserPassword).toHaveBeenCalledWith("wrongpass", "pbkdf2$100000$aaaa$bbbb");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("bo'sh email/parol → erta generic error, DB'ga ham bormaydi", async () => {
    await expect(
      loginWithPassword(fd({ email: "", password: "x" })),
    ).rejects.toThrow(/error=login/);
    expect(findFirst).not.toHaveBeenCalled();
    expect(verifyUserPassword).not.toHaveBeenCalled();
  });

  it("to'g'ri parol → sessiya cookie o'rnatiladi (muvaffaqiyat yo'li)", async () => {
    findFirst.mockResolvedValue({ id: "u1", passwordHash: "pbkdf2$100000$aaaa$bbbb" });
    verifyUserPassword.mockResolvedValue(true);

    // Muvaffaqiyatда `next`ga redirect bo'ladi (bu yerda "/").
    await expect(
      loginWithPassword(fd({ email: "real@example.com", password: "rightpass" })),
    ).rejects.toThrow(RedirectError);

    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name] = cookieSet.mock.calls[0];
    expect(name).toBe("onyx_session");
  });
});
