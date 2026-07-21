// OWN-03 — akkaunt validatsiyasi (SOF, DB YO'Q). Normativ: OWN-03 xavfsizlik.
import { describe, expect, it } from "vitest";
import {
  CREATABLE_ROLES,
  MIN_PASSWORD_LENGTH,
  isCreatableRole,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  validateNewAccount,
} from "@/lib/accounts";

describe("isCreatableRole — faqat MANAGER/WAREHOUSE (OWN-03 xavfsizlik)", () => {
  it("MANAGER va WAREHOUSE → true", () => {
    expect(isCreatableRole("MANAGER")).toBe(true);
    expect(isCreatableRole("WAREHOUSE")).toBe(true);
  });
  it("OWNER va PARTNER → false (bu forma orqali yaratilmaydi)", () => {
    expect(isCreatableRole("OWNER")).toBe(false);
    expect(isCreatableRole("PARTNER")).toBe(false);
  });
  it("noma'lum/bo'sh → false", () => {
    expect(isCreatableRole("")).toBe(false);
    expect(isCreatableRole("SUPERADMIN")).toBe(false);
    expect(isCreatableRole("manager")).toBe(false); // katta-kichik farqi
  });
  it("CREATABLE_ROLES ro'yxati OWNER/PARTNER'ni o'z ichiga olmaydi", () => {
    expect(CREATABLE_ROLES).not.toContain("OWNER");
    expect(CREATABLE_ROLES).not.toContain("PARTNER");
  });
});

describe("normalizeEmail / isValidEmail", () => {
  it("trim + lowercase", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("email formati", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("no-at")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isValidPassword — minimal uzunlik", () => {
  it(`< ${MIN_PASSWORD_LENGTH} → false, ≥ → true`, () => {
    expect(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
  });
});

describe("validateNewAccount — to'liq oqim", () => {
  const base = {
    name: "Дилшод",
    email: "dilshod@example.com",
    password: "password1",
    role: "MANAGER",
  };

  it("yaroqli MANAGER → ok + normallashgan qiymatlar", () => {
    const res = validateNewAccount({ ...base, name: "  Дилшод  ", email: " Dilshod@Example.com " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe("Дилшод");
      expect(res.value.email).toBe("dilshod@example.com");
      expect(res.value.role).toBe("MANAGER");
    }
  });

  it("yaroqli WAREHOUSE → ok", () => {
    const res = validateNewAccount({ ...base, role: "WAREHOUSE" });
    expect(res.ok).toBe(true);
  });

  it("OWNER roli → rad (error: role) — ruxsat oshirish xavfi yopiq", () => {
    const res = validateNewAccount({ ...base, role: "OWNER" });
    expect(res).toEqual({ ok: false, error: "role" });
  });

  it("PARTNER roli → rad (error: role)", () => {
    const res = validateNewAccount({ ...base, role: "PARTNER" });
    expect(res).toEqual({ ok: false, error: "role" });
  });

  it("bo'sh ism → error: name", () => {
    expect(validateNewAccount({ ...base, name: "   " })).toEqual({
      ok: false,
      error: "name",
    });
  });

  it("yaroqsiz email → error: email", () => {
    expect(validateNewAccount({ ...base, email: "bad" })).toEqual({
      ok: false,
      error: "email",
    });
  });

  it("qisqa parol → error: password", () => {
    expect(validateNewAccount({ ...base, password: "short" })).toEqual({
      ok: false,
      error: "password",
    });
  });

  it("rol tekshiruvi email/paroldan OLDIN (OWNER + yomon email → role)", () => {
    // Rol allowlist birinchi — noto'g'ri rol hech qachon o'tmaydi.
    expect(validateNewAccount({ name: "X", email: "bad", password: "x", role: "OWNER" })).toEqual({
      ok: false,
      error: "role",
    });
  });
});
