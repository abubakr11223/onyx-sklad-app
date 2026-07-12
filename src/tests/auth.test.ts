// Part 1 — auth: parol solishtirish (timing-safe) + HMAC token round-trip.
// DB YO'Q. Web Crypto (globalThis.crypto.subtle) node 20'da mavjud.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAuthedFromCookie,
  signMagicLinkToken,
  signSessionToken,
  signToken,
  verifyMagicLinkToken,
  verifyPassword,
  verifySessionToken,
  verifyToken,
} from "@/lib/auth";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.APP_PASSWORD = "onyx2026";
  process.env.AUTH_COOKIE_SECRET = "test-secret-for-vitest-please-ignore";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("verifyPassword", () => {
  it("to'g'ri parol → true", () => {
    expect(verifyPassword("onyx2026")).toBe(true);
  });

  it("noto'g'ri parol → false", () => {
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("timing-safe yo'l: turli uzunliklarni ham to'liq solishtiradi", () => {
    // Prefiks to'g'ri, ammo qisqa/uzun — baribir false (erta chiqib ketmaydi).
    expect(verifyPassword("onyx")).toBe(false);
    expect(verifyPassword("onyx2026extra")).toBe(false);
  });

  it("APP_PASSWORD o'rnatilmagan → false (crash yo'q)", () => {
    delete process.env.APP_PASSWORD;
    expect(verifyPassword("onyx2026")).toBe(false);
  });
});

describe("signToken / verifyToken round-trip", () => {
  it("imzolangan token o'z-o'zini tasdiqlaydi", async () => {
    const token = await signToken();
    expect(token).toContain(".");
    expect(await verifyToken(token)).toBe(true);
  });

  it("buzilgan imzo → false", async () => {
    const token = await signToken();
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifyToken(tampered)).toBe(false);
  });

  it("boshqa payload / shaklsiz token → false", async () => {
    expect(await verifyToken("")).toBe(false);
    expect(await verifyToken("no-dot")).toBe(false);
    expect(await verifyToken("wrong-payload.deadbeef")).toBe(false);
  });

  it("boshqa secret bilan imzolangan token → false", async () => {
    const token = await signToken();
    process.env.AUTH_COOKIE_SECRET = "a-completely-different-secret";
    expect(await verifyToken(token)).toBe(false);
  });

  it("isAuthedFromCookie: yaroqli cookie → true, undefined → false", async () => {
    const token = await signToken();
    expect(await isAuthedFromCookie(token)).toBe(true);
    expect(await isAuthedFromCookie(undefined)).toBe(false);
  });
});

// ───────────────────────── SK-4b: magic-link + session tokenlar ─────────────────────────
// Vaqtga bog'liqlikni yo'qotish uchun aniq nowMs qiymatlari (Date.now() yo'q).
const NOW = 1_700_000_000_000;
const USER_ID = "ckuser000000000000000000"; // cuid — nuqtasiz.

describe("signMagicLinkToken / verifyMagicLinkToken", () => {
  it("round-trip: yaroqli token → { ok, userId }", async () => {
    const token = await signMagicLinkToken(USER_ID, NOW + 60_000);
    const res = await verifyMagicLinkToken(token, NOW);
    expect(res).toEqual({ ok: true, userId: USER_ID });
  });

  it("muddat chegarasi: nowMs === expiry → yaroqli, nowMs > expiry → expired", async () => {
    const token = await signMagicLinkToken(USER_ID, NOW);
    expect(await verifyMagicLinkToken(token, NOW)).toEqual({
      ok: true,
      userId: USER_ID,
    });
    expect(await verifyMagicLinkToken(token, NOW + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("buzilgan imzo → badsig", async () => {
    const token = await signMagicLinkToken(USER_ID, NOW + 60_000);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifyMagicLinkToken(tampered, NOW)).toEqual({
      ok: false,
      reason: "badsig",
    });
  });

  it("shaklsiz token → malformed", async () => {
    expect(await verifyMagicLinkToken("", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyMagicLinkToken("magic.only", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // 4 qism, ammo expiresAtMs raqam emas.
    expect(await verifyMagicLinkToken("magic.u1.notanumber.deadbeef", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // noto'g'ri prefiks (session tokeni magic sifatida qabul QILINMAYDI).
    expect(await verifyMagicLinkToken("session.u1.deadbeef", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("signSessionToken / verifySessionToken", () => {
  it("round-trip: yaroqli token → userId", async () => {
    const token = await signSessionToken(USER_ID);
    expect(await verifySessionToken(token)).toBe(USER_ID);
  });

  it("buzilgan imzo → null", async () => {
    const token = await signSessionToken(USER_ID);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("shaklsiz → null", async () => {
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("no-dot")).toBeNull();
  });
});

describe("prefiks izolatsiyasi (replay yo'q)", () => {
  it("magic token session sifatida tekshirilmaydi (4 qism → null)", async () => {
    const magic = await signMagicLinkToken(USER_ID, NOW + 60_000);
    expect(await verifySessionToken(magic)).toBeNull();
  });

  it("session token magic sifatida tekshirilmaydi (3 qism → malformed)", async () => {
    const session = await signSessionToken(USER_ID);
    const res = await verifyMagicLinkToken(session, NOW);
    expect(res.ok).toBe(false);
  });
});
