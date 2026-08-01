// OWN-03 — akkaunt validatsiyasi (SOF, DB YO'Q). Normativ: OWN-03 xavfsizlik.
import { describe, expect, it } from "vitest";
import {
  CREATABLE_ROLES,
  MIN_PASSWORD_LENGTH,
  TOGGLEABLE_ROLES,
  canonicalPhone,
  isCreatableRole,
  isToggleableRole,
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  validateNewAccount,
} from "@/lib/accounts";

describe("isCreatableRole — MANAGER/WAREHOUSE/PARTNER, но НЕ OWNER (OWN-03 + A1)", () => {
  it("MANAGER, WAREHOUSE va PARTNER → true", () => {
    expect(isCreatableRole("MANAGER")).toBe(true);
    expect(isCreatableRole("WAREHOUSE")).toBe(true);
    // A1 (§6.8): дизайнер-партнёр теперь заводится владельцем через эту форму.
    expect(isCreatableRole("PARTNER")).toBe(true);
  });
  it("OWNER → false (bu forma orqali yaratilmaydi — ruxsat oshirish xavfi)", () => {
    expect(isCreatableRole("OWNER")).toBe(false);
  });
  it("noma'lum/bo'sh → false", () => {
    expect(isCreatableRole("")).toBe(false);
    expect(isCreatableRole("SUPERADMIN")).toBe(false);
    expect(isCreatableRole("manager")).toBe(false); // katta-kichik farqi
  });
  it("CREATABLE_ROLES OWNER'ni o'z ichiga olmaydi, ammo PARTNER'ni oladi", () => {
    expect(CREATABLE_ROLES).not.toContain("OWNER");
    expect(CREATABLE_ROLES).toContain("PARTNER");
  });
});

describe("isToggleableRole — changeRole FAQAT MANAGER↔WAREHOUSE (N2)", () => {
  it("MANAGER va WAREHOUSE → true", () => {
    expect(isToggleableRole("MANAGER")).toBe(true);
    expect(isToggleableRole("WAREHOUSE")).toBe(true);
  });
  it("PARTNER → false (ko'tarib bo'lmaydi — ruxsat oshirish xavfi)", () => {
    // A1: PARTNER yaratiladi (CREATABLE), lekin changeRole orqali ko'tarilmaydi.
    expect(isCreatableRole("PARTNER")).toBe(true);
    expect(isToggleableRole("PARTNER")).toBe(false);
  });
  it("OWNER va noma'lum → false", () => {
    expect(isToggleableRole("OWNER")).toBe(false);
    expect(isToggleableRole("")).toBe(false);
    expect(isToggleableRole("SUPERADMIN")).toBe(false);
  });
  it("TOGGLEABLE_ROLES — PARTNER/OWNER yo'q", () => {
    expect(TOGGLEABLE_ROLES).not.toContain("PARTNER");
    expect(TOGGLEABLE_ROLES).not.toContain("OWNER");
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

  it("yaroqli WAREHOUSE + telefon → ok (W11-A: phone majburiy)", () => {
    const res = validateNewAccount({
      ...base,
      role: "WAREHOUSE",
      phone: "+998901234567",
    });
    expect(res.ok).toBe(true);
  });

  it("OWNER roli → rad (error: role) — ruxsat oshirish xavfi yopiq", () => {
    const res = validateNewAccount({ ...base, role: "OWNER" });
    expect(res).toEqual({ ok: false, error: "role" });
  });

  it("yaroqli PARTNER → ok (A1 §6.8: egasi partnyor akkauntini yaratadi)", () => {
    const res = validateNewAccount({ ...base, role: "PARTNER" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.role).toBe("PARTNER");
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

describe("telefon: normalizePhone / isValidPhone / canonicalPhone", () => {
  it("normalizePhone — faqat raqamlar (telegram-webhook bilan BIR XIL)", () => {
    expect(normalizePhone("+998 90 123-45-67")).toBe("998901234567");
    expect(normalizePhone("998901234567")).toBe("998901234567");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
  it("isValidPhone — 9–15 raqam", () => {
    expect(isValidPhone("+998901234567")).toBe(true); // 12
    expect(isValidPhone("901234567")).toBe(true); // 9
    expect(isValidPhone("123")).toBe(false); // qisqa
    expect(isValidPhone("1234567890123456")).toBe(false); // 16 — uzun
    expect(isValidPhone("")).toBe(false);
  });
  it("canonicalPhone — +<raqamlar>", () => {
    expect(canonicalPhone("+998 90 123 45 67")).toBe("+998901234567");
    expect(canonicalPhone("998901234567")).toBe("+998901234567");
    expect(canonicalPhone("")).toBe("");
  });
  it("MATCHING invariant: normalizePhone(canonical) === normalizePhone(raw)", () => {
    // handleContact normalizePhone bo'yicha solishtiradi → panelдан kiritilgan
    // kanonik shakl va Telegram (998…) mos kelishi SHART.
    const raw = "+998 (90) 123-45-67";
    expect(normalizePhone(canonicalPhone(raw))).toBe(normalizePhone(raw));
    expect(normalizePhone(canonicalPhone(raw))).toBe("998901234567");
  });
});

describe("validateNewAccount — telefon (skladchi Telegram bog'lanishi)", () => {
  const base = {
    name: "Дилшод",
    email: "d@example.com",
    password: "password1",
    role: "WAREHOUSE",
  };
  it("W11-A: WAREHOUSE telefonsiz → error: phone (majburiy)", () => {
    expect(validateNewAccount(base)).toEqual({
      ok: false,
      error: "phone",
    });
  });
  it("MANAGER telefonsiz → ok, phone=null (ixtiyoriy)", () => {
    const res = validateNewAccount({ ...base, role: "MANAGER" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.phone).toBeNull();
  });
  it("yaroqli telefon → ok, kanonik +<raqamlar>", () => {
    const res = validateNewAccount({ ...base, phone: "+998 90 123 45 67" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.phone).toBe("+998901234567");
  });
  it("noto'g'ri telefon (qisqa) → error: phone", () => {
    expect(validateNewAccount({ ...base, phone: "123" })).toEqual({
      ok: false,
      error: "phone",
    });
  });
});
