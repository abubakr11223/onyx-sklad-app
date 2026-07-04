// Part 1 — auth: parol solishtirish (timing-safe) + HMAC token round-trip.
// DB YO'Q. Web Crypto (globalThis.crypto.subtle) node 20'da mavjud.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAuthedFromCookie,
  signToken,
  verifyPassword,
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
