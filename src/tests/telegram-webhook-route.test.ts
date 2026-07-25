// Аудит ТЗ №7 #11 — сам gate маршрута webhook (timingSafeEqual + fail-closed на
// пустом secret) был untested. Регрессия к «unset secret → fail-open в dev» или
// к сравнению без длины пропустит форгeд Telegram-update'ы (account linking,
// magic-link issuance). Мокаем handleUpdate — проверяем, что gate вызывает его
// ТОЛЬКО при валидном secret; на любом ином исходе — 401 и никаких вызовов.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Handler мокаем — важно только, был ли он вызван.
const M = vi.hoisted(() => ({
  handleUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/telegram-webhook", () => ({
  handleUpdate: M.handleUpdate,
}));

// В route.ts импортируется куча вещей (db, telegram, ai-shape, slab-separation),
// но при 401 они не исполняются. Оставляем как есть — на импорт-стадии они
// подхватываются, но без запуска (side-effect'ы нет).

// Сохраняем и восстанавливаем env вокруг каждого теста — секрет мутируем.
const ORIG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const REAL_SECRET = "s3cret-webhook-token";

beforeEach(() => {
  M.handleUpdate.mockClear();
  process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
});
afterEach(() => {
  if (ORIG_SECRET === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = ORIG_SECRET;
});

// Импорт ПОСЛЕ моков (иначе route.ts подхватит настоящий handleUpdate).
import { POST } from "@/app/api/telegram/webhook/route";

function mkReq(opts: {
  secretHeader?: string | null;
  body?: string;
}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secretHeader != null) {
    headers["x-telegram-bot-api-secret-token"] = opts.secretHeader;
  }
  return new Request("https://onyx.test/api/telegram/webhook", {
    method: "POST",
    headers,
    body: opts.body ?? JSON.stringify({ update_id: 1 }),
  });
}

// ═══════════════ Fail-closed: нет secret'а в env ═══════════════

describe("webhook route gate — TELEGRAM_WEBHOOK_SECRET не задан (ТЗ №7 #11)", () => {
  it("env пуст → 401 (fail-closed), handleUpdate НЕ вызывается", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(mkReq({ secretHeader: REAL_SECRET }));

    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });

  it("env — пустая строка → 401 (та же ветка fail-closed)", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "";
    const res = await POST(mkReq({ secretHeader: "" }));

    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ Fail: неверный/отсутствующий заголовок ═══════════════

describe("webhook route gate — неверный секрет (ТЗ №7 #11)", () => {
  it("другой секрет → 401, handleUpdate НЕ вызывается", async () => {
    const res = await POST(mkReq({ secretHeader: "wrong-secret" }));
    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });

  it("заголовок отсутствует → 401, handleUpdate НЕ вызывается", async () => {
    const res = await POST(mkReq({ secretHeader: null }));
    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });

  it("пустая строка в заголовке (secret задан) → 401", async () => {
    const res = await POST(mkReq({ secretHeader: "" }));
    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });

  it("частичное совпадение (короче) → 401 (timing-safe длину не игнорирует)", async () => {
    const res = await POST(mkReq({ secretHeader: REAL_SECRET.slice(0, 5) }));
    expect(res.status).toBe(401);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ Happy path: правильный секрет → handleUpdate вызывается ═══════════════

describe("webhook route gate — правильный секрет (ТЗ №7 #11)", () => {
  it("совпадает → 200 {ok:true}, handleUpdate вызывается РОВНО один раз с parsed update", async () => {
    const res = await POST(mkReq({ secretHeader: REAL_SECRET }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(M.handleUpdate).toHaveBeenCalledTimes(1);
    // Первый аргумент — тело запроса (parsed JSON).
    expect(M.handleUpdate.mock.calls[0][0]).toEqual({ update_id: 1 });
  });

  it("malformed JSON → 400 (не 401) и handleUpdate НЕ вызывается", async () => {
    const res = await POST(mkReq({ secretHeader: REAL_SECRET, body: "not-json{" }));
    expect(res.status).toBe(400);
    expect(M.handleUpdate).not.toHaveBeenCalled();
  });
});
