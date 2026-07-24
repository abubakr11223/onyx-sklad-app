// §5.9 — проверка initData Telegram Mini App (подпись HMAC + свежесть).
import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "@/lib/telegram-webapp";

const BOT = "123456:TEST-bot-token";
const enc = new TextEncoder();

async function hmac(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(msg) as unknown as ArrayBuffer,
  );
  return new Uint8Array(sig);
}
const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Собирает валидный initData (с правильным hash) для заданных полей. */
async function makeInitData(fields: Record<string, string>): Promise<string> {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dcs = pairs.join("\n");
  const secret = await hmac(enc.encode("WebAppData"), BOT);
  const hash = hex(await hmac(secret, dcs));
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

const NOW = 1_800_000_000_000; // фикс. время (мс)
const authNow = String(Math.floor(NOW / 1000));

describe("validateTelegramInitData", () => {
  it("валидная подпись + свежий auth_date → ok, telegramId", async () => {
    const initData = await makeInitData({
      auth_date: authNow,
      query_id: "AAA",
      user: JSON.stringify({ id: 555111, first_name: "Ali" }),
    });
    const r = await validateTelegramInitData(initData, BOT, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.telegramId).toBe("555111");
  });

  it("подделанная подпись → badsig", async () => {
    let initData = await makeInitData({
      auth_date: authNow,
      user: JSON.stringify({ id: 1 }),
    });
    // Ломаем hash.
    initData = initData.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    const r = await validateTelegramInitData(initData, BOT, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("badsig");
  });

  it("другой bot token → badsig (нельзя подделать без токена)", async () => {
    const initData = await makeInitData({
      auth_date: authNow,
      user: JSON.stringify({ id: 1 }),
    });
    const r = await validateTelegramInitData(initData, "999:OTHER", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("badsig");
  });

  it("старый auth_date (>24ч) → expired", async () => {
    const oldDate = String(Math.floor(NOW / 1000) - 25 * 60 * 60);
    const initData = await makeInitData({
      auth_date: oldDate,
      user: JSON.stringify({ id: 1 }),
    });
    const r = await validateTelegramInitData(initData, BOT, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("пустой initData / нет токена → malformed / nosecret", async () => {
    expect((await validateTelegramInitData("", BOT, NOW)).ok).toBe(false);
    const r2 = await validateTelegramInitData("x=1", "", NOW);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("nosecret");
  });
});
