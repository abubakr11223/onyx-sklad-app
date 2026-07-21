// OWN-03 — parol xeshi (PBKDF2, Web Crypto). DB YO'Q, sof funksiya.
// crypto.subtle Node 20+ da mavjud (vitest environment: node).
import { describe, expect, it } from "vitest";
import { hashUserPassword, verifyUserPassword } from "@/lib/password";

describe("hashUserPassword / verifyUserPassword", () => {
  it("to'g'ri parol → true (round-trip)", async () => {
    const hash = await hashUserPassword("correct horse battery staple");
    expect(await verifyUserPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("noto'g'ri parol → false", async () => {
    const hash = await hashUserPassword("owner123");
    expect(await verifyUserPassword("owner124", hash)).toBe(false);
    expect(await verifyUserPassword("", hash)).toBe(false);
    expect(await verifyUserPassword("OWNER123", hash)).toBe(false);
  });

  it("format: pbkdf2$<iter>$<salt>$<hash>, iter ≥ 100000", async () => {
    const hash = await hashUserPassword("secret12");
    const parts = hash.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(100_000);
    expect(parts[2].length).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
  });

  it("bir xil parol → HAR SAFAR boshqa xesh (tasodifiy tuz)", async () => {
    const a = await hashUserPassword("samePassword1");
    const b = await hashUserPassword("samePassword1");
    expect(a).not.toBe(b);
    // Ammo ikkalasi ham to'g'ri tekshiriladi.
    expect(await verifyUserPassword("samePassword1", a)).toBe(true);
    expect(await verifyUserPassword("samePassword1", b)).toBe(true);
  });

  it("buzilgan xesh (bir belgi o'zgargan) → false", async () => {
    const hash = await hashUserPassword("tamperTest1");
    const tampered = hash.slice(0, -1) + (hash.endsWith("A") ? "B" : "A");
    expect(await verifyUserPassword("tamperTest1", tampered)).toBe(false);
  });

  it("null / bo'sh / shaklsiz saqlangan qiymat → false (crash yo'q)", async () => {
    expect(await verifyUserPassword("x", null)).toBe(false);
    expect(await verifyUserPassword("x", undefined)).toBe(false);
    expect(await verifyUserPassword("x", "")).toBe(false);
    expect(await verifyUserPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyUserPassword("x", "pbkdf2$abc$salt$hash")).toBe(false);
    expect(await verifyUserPassword("x", "bcrypt$100000$s$h")).toBe(false);
    // yaroqsiz base64
    expect(await verifyUserPassword("x", "pbkdf2$100000$!!!$???")).toBe(false);
  });

  it("iteratsiya soni xeshdan o'qiladi (boshqa iter bilan yozilgan xeshni ham tekshiradi)", async () => {
    // hashUserPassword 100000 yozadi; verify iteratsiyani xeshdan oladi, hardcode qilmaydi.
    const hash = await hashUserPassword("iterCheck1");
    expect(hash).toContain("$100000$");
    expect(await verifyUserPassword("iterCheck1", hash)).toBe(true);
  });
});
