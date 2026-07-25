// Аудит ТЗ №7 #24 — раньше route api/tg-auth вызывал validateTelegramInitData
// без явного maxAgeSec → работал дефолт 24 ч; для 30-дневной session-cookie это
// слишком широкое окно replay'а initData. Теперь константа TELEGRAM_INIT_DATA_TTL_SEC=3600
// (1 час) и route обязан её передавать. Регрессия сюда → тест провалится.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_INIT_DATA_TTL_SEC } from "@/lib/config";

// Мокаем validate — важно проверить, с какими аргументами он вызван.
const validateMock = vi.hoisted(() => ({
  fn: vi.fn().mockResolvedValue({ ok: false, reason: "expired" }),
}));
vi.mock("@/lib/telegram-webapp", () => ({
  validateTelegramInitData: validateMock.fn,
}));

// db.user.findFirst не должен успеть — validate вернёт !ok на всех тестах.
const dbMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: dbMock.findFirst },
  },
}));

process.env.TELEGRAM_BOT_TOKEN = "999:BOT";

import { POST } from "@/app/api/tg-auth/route";

function mkReq(body: unknown): Request {
  return new Request("https://onyx.test/api/tg-auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  validateMock.fn.mockReset();
  validateMock.fn.mockResolvedValue({ ok: false, reason: "expired" });
  dbMock.findFirst.mockReset();
});

describe("TELEGRAM_INIT_DATA_TTL_SEC — константа (ТЗ №7 #24)", () => {
  it("значение — ровно 3600 (1 час), НЕ 24*3600", () => {
    expect(TELEGRAM_INIT_DATA_TTL_SEC).toBe(3600);
    // Регрессия к дефолту 24 ч ловится напрямую.
    expect(TELEGRAM_INIT_DATA_TTL_SEC).not.toBe(24 * 60 * 60);
  });
});

describe("api/tg-auth POST — передаёт TTL в validateTelegramInitData (ТЗ №7 #24)", () => {
  it("route зовёт validate с (initData, token, now, TELEGRAM_INIT_DATA_TTL_SEC)", async () => {
    const res = await POST(mkReq({ initData: "auth_date=1&hash=abc" }));
    expect(res.status).toBe(401);
    expect(validateMock.fn).toHaveBeenCalledTimes(1);
    const args = validateMock.fn.mock.calls[0];
    expect(args[0]).toBe("auth_date=1&hash=abc"); // initData
    expect(args[1]).toBe("999:BOT"); // bot token
    expect(typeof args[2]).toBe("number"); // now
    // 4-й аргумент — TTL, ровно 3600. Без явной передачи (регрессия) — undefined.
    expect(args[3]).toBe(3600);
  });

  it("невалидный initData → 401 с reason (fail-closed), user НЕ ищется", async () => {
    validateMock.fn.mockResolvedValueOnce({ ok: false, reason: "expired" });
    const res = await POST(mkReq({ initData: "old-data" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body).toEqual({ ok: false, reason: "expired" });
    expect(dbMock.findFirst).not.toHaveBeenCalled();
  });
});
